import { GENERIC_FALLBACK_RULES, QueueMessageSchema } from "../shared/index.js";
import { getDestination, getMapping, recordDeliveryFailure, recordDeliverySuccess } from "../db/repo.js";
import { buildCefMessage } from "../services/cef.js";
import { sendSyslogMessage, SyslogDeliveryError, type VpcNetworkBinding } from "../services/syslog.js";

function getVpcBinding(env: Env): VpcNetworkBinding | undefined {
  return (env as unknown as Record<string, unknown>)["SYSLOG_VPC"] as VpcNetworkBinding | undefined;
}

/**
 * Queue consumer: reads one enqueued (destination, record) delivery per
 * message, formats CEF, and sends it over TCP. Failed messages are retried
 * by the Queue up to `max_retries` (see wrangler.jsonc), then routed to the
 * dead-letter queue.
 */
export async function queue(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const vpcBinding = getVpcBinding(env);

  for (const msg of batch.messages) {
    const parsed = QueueMessageSchema.safeParse(msg.body);
    if (!parsed.success) {
      console.error("Dropping malformed queue message", parsed.error.issues);
      msg.ack();
      continue;
    }

    const { destinationId, dataset, record } = parsed.data;

    try {
      const destination = await getDestination(env.DB, destinationId);
      if (!destination || !destination.enabled) {
        msg.ack();
        continue;
      }

      const mapping = destination.mappingId ? await getMapping(env.DB, destination.mappingId) : null;
      const rules = mapping?.rules ?? GENERIC_FALLBACK_RULES;

      const message = buildCefMessage({
        dataset,
        record,
        rules,
        syslogHostname: destination.syslogHostname,
        format: destination.format,
        facility: destination.facility,
      });

      await sendSyslogMessage(destination, message, vpcBinding);
      await recordDeliverySuccess(env.DB, destination.id);
      msg.ack();
    } catch (err) {
      const errorMessage =
        err instanceof SyslogDeliveryError || err instanceof Error
          ? err.message
          : "Unknown delivery error";
      console.error(`Syslog delivery failed for destination ${destinationId}:`, errorMessage);
      await recordDeliveryFailure(env.DB, destinationId, errorMessage).catch(() => undefined);
      msg.retry();
    }
  }
}
