import type {
  Destination,
  DestinationInput,
  DestinationStatus,
  Mapping,
  MappingInput,
} from "./types.js";

const API_BASE_KEY = "lsh:apiBase";
const ADMIN_SECRET_KEY = "lsh:adminSecret";

export function getSettings(): { apiBase: string; adminSecret: string } {
  return {
    apiBase: localStorage.getItem(API_BASE_KEY) ?? "",
    adminSecret: localStorage.getItem(ADMIN_SECRET_KEY) ?? "",
  };
}

export function saveSettings(apiBase: string, adminSecret: string): void {
  localStorage.setItem(API_BASE_KEY, apiBase.replace(/\/+$/, ""));
  localStorage.setItem(ADMIN_SECRET_KEY, adminSecret);
}

export function clearSettings(): void {
  localStorage.removeItem(API_BASE_KEY);
  localStorage.removeItem(ADMIN_SECRET_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiBase, adminSecret } = getSettings();
  if (!apiBase) throw new ApiError("API base URL is not configured", 0);

  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSecret}`,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = (body && (body.error as string)) || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  bindings: { db: boolean; queue: boolean };
}

export async function getHealth(): Promise<HealthResponse> {
  const { apiBase } = getSettings();
  const res = await fetch(`${apiBase}/health`);
  if (!res.ok) throw new ApiError("Health check failed", res.status);
  return res.json();
}

export const listDestinations = () =>
  request<{ destinations: Destination[] }>("/admin/destinations").then((r) => r.destinations);

export const createDestination = (input: DestinationInput) =>
  request<{ destination: Destination }>("/admin/destinations", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => r.destination);

export const updateDestination = (id: string, input: DestinationInput) =>
  request<{ destination: Destination }>(`/admin/destinations/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((r) => r.destination);

export const deleteDestination = (id: string) =>
  request<void>(`/admin/destinations/${id}`, { method: "DELETE" });

export const listMappings = () =>
  request<{ mappings: Mapping[] }>("/admin/mappings").then((r) => r.mappings);

export const createMapping = (input: MappingInput) =>
  request<{ mapping: Mapping }>("/admin/mappings", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => r.mapping);

export const updateMapping = (id: string, input: MappingInput) =>
  request<{ mapping: Mapping }>(`/admin/mappings/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((r) => r.mapping);

export const deleteMapping = (id: string) =>
  request<void>(`/admin/mappings/${id}`, { method: "DELETE" });

export const listStatuses = () =>
  request<{ statuses: DestinationStatus[] }>("/admin/status").then((r) => r.statuses);

export const testSend = (destinationId: string) =>
  request<{ ok: boolean; message: string; error?: string }>("/admin/test-send", {
    method: "POST",
    body: JSON.stringify({ destinationId }),
  });
