import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebatePresenceTopic,
  buildDebateTopic,
  isPayloadAllowedOnTopic,
  outboxPayloadSchema,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';

describe('outbox payload schema', () => {
  test('validates a doorbell payload by kind and version', () => {
    assert({
      given: 'a version 1 doorbell payload naming a known kind',
      should: 'accept it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
      }).success,
      expected: true,
    });
    assert({
      given: 'a payload with an unknown kind',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.exploded',
        ids: [id],
      }).success,
      expected: false,
    });
    assert({
      given: 'a payload stamped with a future version',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 2,
        kind: 'debate.phase-changed',
        ids: [id],
      }).success,
      expected: false,
    });
  });

  test('rejects a doorbell payload carrying anything beyond ids, kind and version', () => {
    assert({
      given: 'a doorbell-shaped payload with an extra field',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
        phase: 'active',
      }).success,
      expected: false,
    });
  });

  test('lets the owner-only inbox family carry a small delta beyond ids, kind and version', () => {
    assert({
      given: 'a notification delta payload for the owner-only inbox family',
      should: 'accept it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'user.notification-delivered',
        ids: [id],
        notificationType: 'debate.forfeit',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }).success,
      expected: true,
    });
  });

  test('accepts the two revocation kinds so the drain never meets an unparseable row', () => {
    assert({
      given: 'session.revoked and access.revoked payloads',
      should: 'both accept',
      actual: [
        outboxPayloadSchema.safeParse({
          version: 1,
          kind: 'session.revoked',
          ids: [id],
        }).success,
        outboxPayloadSchema.safeParse({
          version: 1,
          kind: 'access.revoked',
          ids: [id, otherId],
        }).success,
      ],
      expected: [true, true],
    });
  });

  test('access.revoked requires exactly [actorId, debateId], never a single id', () => {
    assert({
      given: 'an access.revoked payload with only one id',
      should: 'reject it: the actor and the debate topic are both required',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'access.revoked',
        ids: [id],
      }).success,
      expected: false,
    });
  });
});

describe('payload-to-topic-family binding (AC4)', () => {
  test('accepts a payload whose kind belongs to the topic family', () => {
    assert({
      given: "a debate.phase-changed doorbell on the debate's own topic",
      should: 'be allowed',
      actual: isPayloadAllowedOnTopic(buildDebateTopic(id), {
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
      }),
      expected: true,
    });
  });

  test('rejects an owner-only inbox delta delivered on a public debate topic', () => {
    assert({
      given: 'a user.notification-delivered payload on a debate topic',
      should: 'be refused: only debate.phase-changed belongs to that family',
      actual: isPayloadAllowedOnTopic(buildDebateTopic(id), {
        version: 1,
        kind: 'user.notification-delivered',
        ids: [id],
        notificationType: 'debate.forfeit',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }),
      expected: false,
    });
  });

  test('rejects a foreign doorbell kind on the wrong public family', () => {
    assert({
      given: 'a standings.updated doorbell on a debate presence topic',
      should:
        'be refused: the presence topic only allows debate.presence-changed',
      actual: isPayloadAllowedOnTopic(buildDebatePresenceTopic(id), {
        version: 1,
        kind: 'standings.updated',
        ids: [otherId],
      }),
      expected: false,
    });
  });

  test('rejects any payload on a chat topic, since chat delivery is not built yet', () => {
    assert({
      given: 'a debate.phase-changed doorbell on the (unbuilt) chat topic',
      should: 'be refused: debate:chat allows no kind yet',
      actual: isPayloadAllowedOnTopic(`debate:${id}:chat`, {
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
      }),
      expected: false,
    });
  });
});
