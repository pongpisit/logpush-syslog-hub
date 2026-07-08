import { z } from "zod";

/**
 * A single field-mapping rule: how one CEF extension key is populated.
 * Exactly one of `sourceField` or `staticValue` should be set.
 */
export const MappingRuleSchema = z
  .object({
    cefKey: z.string().min(1).max(64),
    label: z.string().max(64).optional(),
    sourceField: z.string().min(1).max(128).optional(),
    staticValue: z.string().max(256).optional(),
  })
  .refine((rule) => Boolean(rule.sourceField) || Boolean(rule.staticValue), {
    message: "Either sourceField or staticValue must be set",
  });
export type MappingRule = z.infer<typeof MappingRuleSchema>;

export const MappingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  dataset: z.string().min(1).max(64),
  rules: z.array(MappingRuleSchema).max(64),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Mapping = z.infer<typeof MappingSchema>;

export const MappingInputSchema = MappingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type MappingInput = z.infer<typeof MappingInputSchema>;

export const TransportSchema = z.enum(["vpc", "direct"]);
export type Transport = z.infer<typeof TransportSchema>;

export const FrameSchema = z.enum(["rfc6587", "newline"]);
export type Frame = z.infer<typeof FrameSchema>;

export const DestinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal("tcp").default("tcp"),
  transport: TransportSchema.default("direct"),
  frame: FrameSchema.default("rfc6587"),
  dataset: z.string().min(1).max(64),
  mappingId: z.string().min(1).nullable(),
  syslogHostname: z.string().min(1).max(255).default("cloudflare"),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const DestinationInputSchema = DestinationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type DestinationInput = z.infer<typeof DestinationInputSchema>;

export const DestinationStatusSchema = z.object({
  destinationId: z.string(),
  lastError: z.string().nullable(),
  lastSuccess: z.string().nullable(),
  eventsForwarded: z.number().int().nonnegative(),
  eventsDropped: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type DestinationStatus = z.infer<typeof DestinationStatusSchema>;

/**
 * A Logpush record is dataset-dependent (different field sets per dataset),
 * so we validate it loosely as a flat JSON object and rely on mapping rules
 * to pull out only the fields that matter.
 */
export const LogpushRecordSchema = z.record(z.string(), z.unknown());
export type LogpushRecord = z.infer<typeof LogpushRecordSchema>;

export const QueueMessageSchema = z.object({
  destinationId: z.string().min(1),
  dataset: z.string().min(1),
  record: LogpushRecordSchema,
  enqueuedAt: z.string(),
});
export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const TestSendInputSchema = z.object({
  destinationId: z.string().min(1),
  record: LogpushRecordSchema.optional(),
});
export type TestSendInput = z.infer<typeof TestSendInputSchema>;
