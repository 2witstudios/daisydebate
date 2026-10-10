import {
  clientMessageSchema,
  closeCodeTable,
  type CloseCodeReason,
} from '@daisy/protocol';

export type FirstMessageRejection = {
  readonly code: number;
  readonly reason: CloseCodeReason;
};

/** The protocol's close code for a reason: the table is the one authority. */
export const closeFor = (reason: CloseCodeReason): FirstMessageRejection => {
  const entry = closeCodeTable.find((row) => row.reason === reason);
  if (!entry) throw new Error(`No close code for ${reason}`);
  return { code: entry.code, reason: entry.reason };
};
const AUTH_FAILED = closeFor('auth_failed');
const PROTOCOL_UNSUPPORTED = closeFor('protocol_unsupported');

/**
 * ADR 0031 §6, §11: evaluates a socket's first inbound frame. An unparseable
 * frame, or any message before `hello`, returns the documented rejection.
 * A valid hello returns its ticket to the socket authentication boundary,
 * which consumes it and checks the durable session before sending ready.
 */
export function evaluateFirstMessage(
  raw: string,
): FirstMessageRejection | { readonly ticket: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return PROTOCOL_UNSUPPORTED;
  }
  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) return PROTOCOL_UNSUPPORTED;
  return result.data.type === 'hello'
    ? { ticket: result.data.ticket }
    : AUTH_FAILED;
}
