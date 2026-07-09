// Plain TypeScript mirrors of the API's data shapes (apps/api/src/shared/schemas.ts).
// Duplicated here (rather than imported from a shared workspace package) so
// this app has no pnpm-workspace dependency and can be deployed standalone
// from this subdirectory via the Cloudflare "Deploy to Cloudflare" button.
// Keep in sync with apps/api/src/shared/schemas.ts if you change these shapes.

export type Transport = "vpc" | "direct";
export type Frame = "rfc6587" | "newline";

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
