import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  operatorCommandReceiptSchema,
  operatorLimits,
} from '@daisy/protocol/operator';
import type { Tx } from './tx';

/** The bound, then one id at a time, as a beta access command does (ADR 0079). */
export async function commandGate(tx: Tx, commandId: string) {
  await tx.execute(
    sql.raw(`set local statement_timeout = ${operatorLimits.commandBoundMs}`),
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId}, 59079))`,
  );
}

export async function storedResult(
  tx: Tx,
  commandId: string,
  requestDigest: string,
) {
  const [receipt] = (await tx.execute(sql`select request_digest, result
    from operator_command_receipts where command_id = ${commandId}`)) as unknown as {
    request_digest: string;
    result: unknown;
  }[];
  if (!receipt) return null;
  if (receipt.request_digest !== requestDigest)
    throw createAppError('CONFLICT');
  return receipt.result;
}

export async function writeReceipt(
  tx: Tx,
  input: {
    readonly commandId: string;
    readonly serviceId: string;
    readonly operatorRef: string;
    readonly requestDigest: string;
    readonly adminAuditHead: string;
  },
  targetUserId: string | null,
  body: unknown,
) {
  const receipt = operatorCommandReceiptSchema.parse(body);
  await tx.execute(sql`insert into operator_command_receipts
      (command_id, service_id, operator_ref, action, target_user_id,
       request_digest, result, admin_audit_head)
    values (${input.commandId}, ${input.serviceId}, ${input.operatorRef},
      ${receipt.action}, ${targetUserId},
      ${input.requestDigest}, ${JSON.stringify(receipt.result)}::text::jsonb, ${input.adminAuditHead})`);
}
