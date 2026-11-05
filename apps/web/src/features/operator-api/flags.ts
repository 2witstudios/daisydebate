import {
  authorize,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { OperatorCrypto } from '@daisy/auth/operator-signature';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
  flagStateCommandSchema,
  flagOverrideCommandSchema,
  type FlagChange,
  type FlagCommandAction,
} from '@daisy/protocol/flags';
import { operatorLimits } from '@daisy/protocol/operator';
import { flagCatalogue } from '../flags/catalogue';
import { decideFlagChange } from '../flags/change';

export function mayControlFlags(
  principal: AuthorizationPrincipal,
  capability: FlagCommandAction | 'flag.command.read',
) {
  return authorize({
    principal,
    capability,
    resource: { kind: 'flag_control' },
    context: { account: null },
  }).allow;
}

/** Closed resource operations on the private signed listener only. */
export async function changeFlag(
  deps: {
    readonly store: Pick<Database, 'runFlagCommand'>;
    readonly crypto: OperatorCrypto;
    readonly nextId: () => string;
    readonly nowMs: () => number;
  },
  principal: AuthorizationPrincipal,
  route: 'setFlagState' | 'setFlagOverride',
  key: string,
  request: { readonly body: Uint8Array; readonly signedAtMs: number },
) {
  const entry = flagCatalogue.find((candidate) => candidate.key === key);
  if (!entry) throw createAppError('NOT_FOUND');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(request.body));
  } catch {
    throw createAppError('VALIDATION');
  }
  const command = (
    route === 'setFlagState'
      ? flagStateCommandSchema
      : flagOverrideCommandSchema
  ).safeParse(body);
  if (!command.success) throw createAppError('VALIDATION');
  const change: FlagChange =
    'state' in command.data
      ? { action: 'flag.state.update', state: command.data.state }
      : {
          action: 'flag.override.update',
          accountId: command.data.accountId,
          override: command.data.override,
        };
  if (
    principal.kind !== 'operator_service' ||
    !mayControlFlags(principal, change.action)
  )
    throw createAppError('AUTHORIZATION');
  return deps.store.runFlagCommand({
    commandId: command.data.commandId,
    serviceId: principal.serviceId,
    operatorRef: principal.operatorRef,
    adminAuditHead: command.data.adminAuditHead,
    key,
    change,
    requestDigest: deps.crypto.sha3Hex(
      JSON.stringify([
        principal.serviceId,
        principal.operatorRef,
        key,
        change,
        command.data.expectedRevision,
      ]),
    ),
    nextId: deps.nextId,
    live: () => deps.nowMs() <= request.signedAtMs + operatorLimits.skewMs,
    authorize: () => mayControlFlags(principal, change.action),
    decide: (revision, now) =>
      decideFlagChange({
        entry,
        change,
        revision,
        expectedRevision: command.data.expectedRevision,
        now,
      }),
  });
}
