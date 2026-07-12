import { createExecutionContext, createMessageBatch, env, getQueueResult, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { createDestination, getDestination } from "../src/db/repo.js";

describe("queue consumer", () => {
  it("acks and drops messages referencing a deleted/unknown destination", async () => {
    const batch = createMessageBatch("logpush-syslog-queue", [
      {
        id: "1",
        timestamp: new Date(),
        attempts: 1,
        body: {
          destinationId: "does-not-exist",
          dataset: "http_requests",
          record: { ClientIP: "203.0.113.9" },
          enqueuedAt: new Date().toISOString(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(false);
    expect(result.explicitAcks).toEqual(["1"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("retries and records a failure when transport='vpc' has no SYSLOG_VPC binding", async () => {
    const destination = await createDestination(env.DB, {
      name: "Unreachable VPC dest",
      host: "10.0.0.99",
      port: 514,
      protocol: "tcp",
      transport: "vpc",
      frame: "rfc6587",
      format: "rfc3164",
      facility: 16,
      tls: false,
      dataset: "http_requests",
      mappingId: null,
      syslogHostname: "cloudflare",
      enabled: true,
    });

    const batch = createMessageBatch("logpush-syslog-queue", [
      {
        id: "2",
        timestamp: new Date(),
        attempts: 1,
        body: {
          destinationId: destination.id,
          dataset: "http_requests",
          record: { ClientIP: "203.0.113.9" },
          enqueuedAt: new Date().toISOString(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["2"]);
  });

  it("skips disabled destinations without attempting delivery", async () => {
    const destination = await createDestination(env.DB, {
      name: "Disabled dest",
      host: "10.0.0.5",
      port: 514,
      protocol: "tcp",
      transport: "direct",
      frame: "rfc6587",
      format: "rfc3164",
      facility: 16,
      tls: false,
      dataset: "http_requests",
      mappingId: null,
      syslogHostname: "cloudflare",
      enabled: false,
    });

    const batch = createMessageBatch("logpush-syslog-queue", [
      {
        id: "3",
        timestamp: new Date(),
        attempts: 1,
        body: {
          destinationId: destination.id,
          dataset: "http_requests",
          record: {},
          enqueuedAt: new Date().toISOString(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["3"]);
  });

  it("acks malformed messages instead of retrying forever", async () => {
    const batch = createMessageBatch("logpush-syslog-queue", [
      { id: "4", timestamp: new Date(), attempts: 1, body: { not: "a queue message" } },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await waitOnExecutionContext(ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["4"]);
  });
});
