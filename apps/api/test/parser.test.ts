import { describe, expect, it } from "vitest";
import { decompressIfNeeded, parseNdjsonStream } from "../src/services/parser.js";

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("parseNdjsonStream", () => {
  it("parses multiple NDJSON lines", async () => {
    const stream = streamFromString('{"a":1}\n{"a":2}\n{"a":3}\n');
    const results = await collect(parseNdjsonStream(stream));
    expect(results).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("parses a final line without a trailing newline", async () => {
    const stream = streamFromString('{"a":1}\n{"a":2}');
    const results = await collect(parseNdjsonStream(stream));
    expect(results).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips blank lines and malformed JSON", async () => {
    const stream = streamFromString('{"a":1}\n\nnot-json\n{"a":2}\n');
    const results = await collect(parseNdjsonStream(stream));
    expect(results).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("handles lines split across chunk boundaries", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"a":'));
        controller.enqueue(encoder.encode('1}\n{"a":2}\n'));
        controller.close();
      },
    });
    const results = await collect(parseNdjsonStream(stream));
    expect(results).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns nothing for an empty stream", async () => {
    const stream = streamFromString("");
    const results = await collect(parseNdjsonStream(stream));
    expect(results).toEqual([]);
  });
});

describe("decompressIfNeeded", () => {
  it("passes through the body unchanged when not gzip-encoded", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: '{"a":1}\n',
    });
    const stream = decompressIfNeeded(request);
    const text = await new Response(stream).text();
    expect(text).toBe('{"a":1}\n');
  });

  it("decompresses a gzip-encoded body", async () => {
    const original = '{"a":1}\n{"a":2}\n';
    const gzipStream = streamFromString(original).pipeThrough(new CompressionStream("gzip"));
    const gzipBytes = new Uint8Array(await new Response(gzipStream).arrayBuffer());

    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "Content-Encoding": "gzip" },
      body: gzipBytes,
    });
    const stream = decompressIfNeeded(request);
    const text = await new Response(stream).text();
    expect(text).toBe(original);
  });
});
