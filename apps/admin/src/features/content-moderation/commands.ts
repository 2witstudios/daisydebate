import { appendAudit } from '../../audit/store';
import {
  authorizeOperator,
  currentApprovalPolicy,
  deniedDetail,
} from '../../authorization/authorize-operator';
import { findOperator } from '../../auth/store';
import type { CommandDeps } from '../accounts/commands';
import {
  auditedModeration,
  contentModerationCall,
  contentModerationNotice,
  type ContentModerationNotice,
  type ContentModerationRequest,
} from './actions';

/** The target an audit row names, when it is an account. */
const auditedUser = (request: ContentModerationRequest) =>
  request.action === 'account.audience_ban.update' ? request.targetId : null;

/**
 * One moderation command (WATCH-7): authorized against the operator row read
 * now, its intent audited before anything is signed, and the audit head sent
 * as the cross-database anchor. These commands set a state, and the page's
 * form keeps its command id, so resubmitting after an unknown outcome replays
 * the same receipt; a repeat from a fresh page answers `unchanged`.
 */
export async function submitModeration(
  deps: CommandDeps,
  input: {
    readonly operatorId: string;
    readonly commandId: string;
    readonly request: ContentModerationRequest;
  },
): Promise<ContentModerationNotice> {
  const { operatorId, commandId, request } = input;
  const row = await findOperator(deps.db, operatorId);
  const decision = row
    ? authorizeOperator({
        operator: {
          id: row.id,
          role: row.role as 'owner' | 'operator',
          disabled: row.disabledAt !== null,
          revision: row.revision,
        },
        action: 'content_moderation.update',
        policy: currentApprovalPolicy,
      })
    : ({ allowed: false, reason: 'disabled' } as const);
  const targetUserId = auditedUser(request);
  if (!decision.allowed) {
    await deps.db.transaction((tx) =>
      appendAudit(tx, {
        id: deps.ids.next(),
        kind: 'access.denied',
        operatorId,
        commandId: null,
        targetUserId: null,
        outcome: null,
        detail: deniedDetail(decision.reason),
        at: deps.clock.now(),
      }),
    );
    return 'denied';
  }
  const intent = await deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      kind: 'command.intent',
      operatorId,
      commandId,
      targetUserId,
      // The action and its target id: closed, and names no person's content.
      outcome: `${request.action}:${request.targetId}`,
      detail: null,
      at: deps.clock.now(),
    }),
  );
  const { path, body } = contentModerationCall(request, {
    commandId,
    adminAuditHead: intent.hash,
  });
  const call = await deps.client.moderate(operatorId, path, body);
  await deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      kind: 'command.outcome',
      operatorId,
      commandId,
      targetUserId,
      outcome: auditedModeration(call),
      detail: null,
      at: deps.clock.now(),
    }),
  );
  return contentModerationNotice(call);
}
