import type {
  Destination,
  DestinationInput,
  DestinationStatus,
  Mapping,
  MappingInput,
  MappingRule,
} from "@logpush-syslog-hub/shared";

interface DestinationRow {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  transport: string;
  frame: string;
  dataset: string;
  mapping_id: string | null;
  syslog_hostname: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface MappingRow {
  id: string;
  name: string;
  dataset: string;
  rules: string;
  created_at: string;
  updated_at: string;
}

interface DestinationStatusRow {
  destination_id: string;
  last_error: string | null;
  last_success: string | null;
  events_forwarded: number;
  events_dropped: number;
  updated_at: string;
}

function rowToDestination(row: DestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    protocol: "tcp",
    transport: row.transport === "vpc" ? "vpc" : "direct",
    frame: row.frame === "newline" ? "newline" : "rfc6587",
    dataset: row.dataset,
    mappingId: row.mapping_id,
    syslogHostname: row.syslog_hostname,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMapping(row: MappingRow): Mapping {
  let rules: MappingRule[] = [];
  try {
    rules = JSON.parse(row.rules);
  } catch {
    rules = [];
  }
  return {
    id: row.id,
    name: row.name,
    dataset: row.dataset,
    rules,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStatus(row: DestinationStatusRow): DestinationStatus {
  return {
    destinationId: row.destination_id,
    lastError: row.last_error,
    lastSuccess: row.last_success,
    eventsForwarded: row.events_forwarded,
    eventsDropped: row.events_dropped,
    updatedAt: row.updated_at,
  };
}

export async function listDestinations(db: D1Database): Promise<Destination[]> {
  const { results } = await db
    .prepare("SELECT * FROM destinations ORDER BY created_at DESC")
    .all<DestinationRow>();
  return results.map(rowToDestination);
}

export async function listEnabledDestinationsForDataset(
  db: D1Database,
  dataset: string,
): Promise<Destination[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM destinations WHERE enabled = 1 AND (dataset = ?1 OR dataset = 'all')",
    )
    .bind(dataset)
    .all<DestinationRow>();
  return results.map(rowToDestination);
}

export async function getDestination(
  db: D1Database,
  id: string,
): Promise<Destination | null> {
  const row = await db
    .prepare("SELECT * FROM destinations WHERE id = ?1")
    .bind(id)
    .first<DestinationRow>();
  return row ? rowToDestination(row) : null;
}

export async function createDestination(
  db: D1Database,
  input: DestinationInput,
): Promise<Destination> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO destinations
        (id, name, host, port, protocol, transport, frame, dataset, mapping_id, syslog_hostname, enabled)
       VALUES (?1, ?2, ?3, ?4, 'tcp', ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      id,
      input.name,
      input.host,
      input.port,
      input.transport,
      input.frame,
      input.dataset,
      input.mappingId,
      input.syslogHostname,
      input.enabled ? 1 : 0,
    )
    .run();
  await db
    .prepare("INSERT INTO destination_status (destination_id) VALUES (?1)")
    .bind(id)
    .run();
  const created = await getDestination(db, id);
  if (!created) throw new Error("Failed to read back created destination");
  return created;
}

export async function updateDestination(
  db: D1Database,
  id: string,
  input: DestinationInput,
): Promise<Destination | null> {
  const result = await db
    .prepare(
      `UPDATE destinations SET
        name = ?2, host = ?3, port = ?4, transport = ?5, frame = ?6,
        dataset = ?7, mapping_id = ?8, syslog_hostname = ?9, enabled = ?10,
        updated_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(
      id,
      input.name,
      input.host,
      input.port,
      input.transport,
      input.frame,
      input.dataset,
      input.mappingId,
      input.syslogHostname,
      input.enabled ? 1 : 0,
    )
    .run();
  if (result.meta.changes === 0) return null;
  return getDestination(db, id);
}

export async function deleteDestination(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM destinations WHERE id = ?1").bind(id).run();
  return result.meta.changes > 0;
}

export async function listMappings(db: D1Database): Promise<Mapping[]> {
  const { results } = await db
    .prepare("SELECT * FROM mappings ORDER BY created_at DESC")
    .all<MappingRow>();
  return results.map(rowToMapping);
}

export async function getMapping(db: D1Database, id: string): Promise<Mapping | null> {
  const row = await db
    .prepare("SELECT * FROM mappings WHERE id = ?1")
    .bind(id)
    .first<MappingRow>();
  return row ? rowToMapping(row) : null;
}

export async function getMappingByDataset(
  db: D1Database,
  dataset: string,
): Promise<Mapping | null> {
  const row = await db
    .prepare("SELECT * FROM mappings WHERE dataset = ?1 ORDER BY created_at ASC LIMIT 1")
    .bind(dataset)
    .first<MappingRow>();
  return row ? rowToMapping(row) : null;
}

export async function createMapping(db: D1Database, input: MappingInput): Promise<Mapping> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO mappings (id, name, dataset, rules) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, input.name, input.dataset, JSON.stringify(input.rules))
    .run();
  const created = await getMapping(db, id);
  if (!created) throw new Error("Failed to read back created mapping");
  return created;
}

export async function updateMapping(
  db: D1Database,
  id: string,
  input: MappingInput,
): Promise<Mapping | null> {
  const result = await db
    .prepare(
      `UPDATE mappings SET name = ?2, dataset = ?3, rules = ?4, updated_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(id, input.name, input.dataset, JSON.stringify(input.rules))
    .run();
  if (result.meta.changes === 0) return null;
  return getMapping(db, id);
}

export async function deleteMapping(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM mappings WHERE id = ?1").bind(id).run();
  return result.meta.changes > 0;
}

export async function listDestinationStatuses(db: D1Database): Promise<DestinationStatus[]> {
  const { results } = await db
    .prepare("SELECT * FROM destination_status")
    .all<DestinationStatusRow>();
  return results.map(rowToStatus);
}

export async function recordDeliverySuccess(db: D1Database, destinationId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE destination_status SET
        last_success = datetime('now'), last_error = NULL,
        events_forwarded = events_forwarded + 1, updated_at = datetime('now')
       WHERE destination_id = ?1`,
    )
    .bind(destinationId)
    .run();
}

export async function recordDeliveryFailure(
  db: D1Database,
  destinationId: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE destination_status SET
        last_error = ?2, events_dropped = events_dropped + 1, updated_at = datetime('now')
       WHERE destination_id = ?1`,
    )
    .bind(destinationId, error.slice(0, 500))
    .run();
}
