/**
 * Decompress the request body if it is gzip-encoded (Logpush always sends
 * gzip-compressed NDJSON batches by default).
 */
export function decompressIfNeeded(request: Request): ReadableStream<Uint8Array> {
  const encoding = request.headers.get("Content-Encoding") ?? "";
  const body = request.body;
  if (!body) {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  }
  if (encoding.includes("gzip")) {
    return body.pipeThrough(new DecompressionStream("gzip"));
  }
  return body;
}

/**
 * Stream-parse newline-delimited JSON without buffering the entire payload
 * into memory at once (Logpush batches can be tens of MB).
 */
export async function* parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          const parsed = tryParseJson(line);
          if (parsed !== undefined) yield parsed;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
    const rest = buffer.trim();
    if (rest.length > 0) {
      const parsed = tryParseJson(rest);
      if (parsed !== undefined) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function tryParseJson(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
