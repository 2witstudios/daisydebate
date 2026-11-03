import { moderationCommands } from '@daisy/protocol/moderation';
import { matchOperatorRoute } from '@daisy/protocol/operator';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  auditedModeration,
  moderationCall,
  moderationNotice,
  type ModerationRequest,
} from './actions';

setupRitewayBun();

const targetId = 't'.repeat(24);
const envelope = { commandId: 'c'.repeat(24), adminAuditHead: 'a'.repeat(64) };
const requests: readonly ModerationRequest[] = [
  { action: 'report.resolve', targetId, outcome: 'dismissed' },
  { action: 'broadcast.stop', targetId, reason: 'technical' },
  { action: 'broadcast.chat_slow_mode.update', targetId, seconds: 30 },
  { action: 'recording.takedown', targetId, reason: 'legal_request' },
  { action: 'chat_message.remove', targetId },
  { action: 'account.audience_ban.update', targetId, state: 'banned' },
];

describe('A moderation request', () => {
  test('each one is a route the API has and a body it accepts', () => {
    assert({
      given: 'every action',
      should: 'name a PUT route and parse as that action’s closed command',
      actual: requests.map((request) => {
        const call = moderationCall(request, envelope);
        return (
          matchOperatorRoute('PUT', call.path)?.id === targetId &&
          moderationCommands[request.action].safeParse(call.body).success
        );
      }),
      expected: requests.map(() => true),
    });
  });

  test('each outcome reads as one closed notice', () => {
    assert({
      given: 'applied, unchanged, not found, refused and unknown',
      should: 'say which',
      actual: [
        moderationNotice({ kind: 'ok', value: { v: 1, outcome: 'applied' } }),
        moderationNotice({ kind: 'ok', value: { v: 1, outcome: 'unchanged' } }),
        moderationNotice({ kind: 'rejected', code: 'NOT_FOUND' }),
        moderationNotice({ kind: 'rejected', code: 'CONFLICT' }),
        moderationNotice({ kind: 'unknown' }),
      ],
      expected: ['applied', 'unchanged', 'not_found', 'refused', 'unknown'],
    });
  });

  test('the audit records only the closed outcome', () => {
    assert({
      given: 'an answer, a refusal and silence',
      should: 'record each without any content',
      actual: [
        auditedModeration({ kind: 'ok', value: { v: 1, outcome: 'applied' } }),
        auditedModeration({ kind: 'rejected', code: 'NOT_FOUND' }),
        auditedModeration({ kind: 'unknown' }),
      ],
      expected: ['applied', 'rejected:NOT_FOUND', 'unknown'],
    });
  });
});
