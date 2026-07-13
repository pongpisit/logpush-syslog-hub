// Plain TypeScript mirrors of the Worker's data shapes (../../src/shared/schemas.ts).
// Duplicated here (rather than imported directly) so this Vite app's build
// stays isolated from the Worker's tsconfig/module graph.
// Keep in sync with ../../src/shared/schemas.ts if you change these shapes.

export type Transport = "vpc" | "direct";
export type Frame = "rfc6587" | "newline";
export type SyslogFormat = "rfc3164" | "rfc5424";

export interface MappingRule {
  cefKey: string;
  label?: string;
  sourceField?: string;
  staticValue?: string;
}

export interface Mapping {
  id: string;
  name: string;
  dataset: string;
  rules: MappingRule[];
  createdAt?: string;
  updatedAt?: string;
}

export type MappingInput = Omit<Mapping, "id" | "createdAt" | "updatedAt">;

export interface Destination {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: "tcp";
  transport: Transport;
  frame: Frame;
  format: SyslogFormat;
  facility: number;
  tls: boolean;
  includeRaw: boolean;
  dataset: string;
  mappingId: string | null;
  syslogHostname: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type DestinationInput = Omit<Destination, "id" | "createdAt" | "updatedAt">;

export interface DestinationStatus {
  destinationId: string;
  lastError: string | null;
  lastSuccess: string | null;
  eventsForwarded: number;
  eventsDropped: number;
  updatedAt: string;
}
