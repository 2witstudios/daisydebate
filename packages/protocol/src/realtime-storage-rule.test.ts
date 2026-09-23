import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebateChatTopic,
  buildDebatePresenceTopic,
  buildDebateTopic,
  buildStandingsTopic,
  buildUserInboxTopic,
  isPayloadAllowedOnTopic,
  isPayloadStorableOnTopic,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const otherId = 'm8q3w1z7c5n6b4d2k2v9x0f4';

describe('storage-side family rule (plan revision 4.11, RT-2.1c AC3)', () => {
  const inbox = buildUserInboxTopic(id);

  test('accepts the three control kinds as storable on the inbox family', () => {
    assert({
      given:
        'session.revoked, access.revoked and actor.presence-preference-changed on user:inbox',
      should: 'each be storable',
      actual: [
        isPayloadStorableOnTopic(inbox, {
          version: 1,
          kind: 'session.revoked',
          ids: [id],
        }),
        isPayloadStorableOnTopic(inbox, {
          version: 1,
          kind: 'access.revoked',
          ids: [id, otherId],
        }),
        isPayloadStorableOnTopic(inbox, {
          version: 1,
          kind: 'actor.presence-preference-changed',
          ids: [id],
        }),
      ],
      expected: [true, true, true],
    });
  });

  test('still stores the ordinary inbox delta kind alongside the control kinds', () => {
    assert({
      given: 'a user.notification-delivered delta on user:inbox',
      should: 'be storable, as it always was',
      actual: isPayloadStorableOnTopic(inbox, {
        version: 1,
        kind: 'user.notification-delivered',
        ids: [id],
        notificationType: 'debate.forfeit',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }),
      expected: true,
    });
  });

  test('never lets a control kind be delivered as an event on the inbox, even though it is storable there', () => {
    assert({
      given:
        'the same three control kinds tested against isPayloadAllowedOnTopic on the one topic where they are storable',
      should:
        'be refused by the delivery-side rule: control rows are never forwarded as event',
      actual: [
        isPayloadAllowedOnTopic(inbox, {
          version: 1,
          kind: 'session.revoked',
          ids: [id],
        }),
        isPayloadAllowedOnTopic(inbox, {
          version: 1,
          kind: 'access.revoked',
          ids: [id, otherId],
        }),
        isPayloadAllowedOnTopic(inbox, {
          version: 1,
          kind: 'actor.presence-preference-changed',
          ids: [id],
        }),
      ],
      expected: [false, false, false],
    });
  });

  test('refuses every control kind delivered as an event on a non-inbox topic too', () => {
    assert({
      given: 'the three control kinds tested against a public debate topic',
      should:
        'be refused: control kinds are never a delivery-side kind anywhere',
      actual: [
        isPayloadAllowedOnTopic(buildDebateTopic(id), {
          version: 1,
          kind: 'session.revoked',
          ids: [id],
        }),
        isPayloadAllowedOnTopic(buildDebateTopic(id), {
          version: 1,
          kind: 'access.revoked',
          ids: [id, otherId],
        }),
        isPayloadAllowedOnTopic(buildDebateTopic(id), {
          version: 1,
          kind: 'actor.presence-preference-changed',
          ids: [id],
        }),
      ],
      expected: [false, false, false],
    });
  });

  test('refuses the two doorbell kinds as storable on the inbox: the widening is control kinds only', () => {
    assert({
      given:
        'debate.phase-changed and standings.updated tested against isPayloadStorableOnTopic on user:inbox',
      should:
        'both be refused: storageFamilyPayloadKinds widens user:inbox by the three control kinds, not by every kind',
      actual: [
        isPayloadStorableOnTopic(inbox, {
          version: 1,
          kind: 'debate.phase-changed',
          ids: [id],
        }),
        isPayloadStorableOnTopic(inbox, {
          version: 1,
          kind: 'standings.updated',
          ids: [id],
        }),
      ],
      expected: [false, false],
    });
  });

  test('refuses each control kind as storable on every family the rule does not widen', () => {
    const nonInboxTopics = [
      buildDebateTopic(id),
      buildDebatePresenceTopic(id),
      buildDebateChatTopic(id),
      buildStandingsTopic('2026'),
    ];
    const controlKindPayloads = [
      { version: 1, kind: 'session.revoked', ids: [id] },
      { version: 1, kind: 'access.revoked', ids: [id, otherId] },
      { version: 1, kind: 'actor.presence-preference-changed', ids: [id] },
    ];
    assert({
      given:
        'each of the three control kinds tested against debate, debate:presence, debate:chat and standings',
      should:
        'be refused on every one: only user:inbox is widened to accept control kinds',
      actual: nonInboxTopics.flatMap((topic) =>
        controlKindPayloads.map((payload) =>
          isPayloadStorableOnTopic(topic, payload),
        ),
      ),
      expected: nonInboxTopics.flatMap(() =>
        controlKindPayloads.map(() => false),
      ),
    });
  });

  test('still refuses every other family the storage-side rule does not widen', () => {
    assert({
      given:
        'a debate.phase-changed doorbell tested against both rules on its own topic',
      should: 'agree: storage and delivery are identical outside user:inbox',
      actual: [
        isPayloadStorableOnTopic(buildDebateTopic(id), {
          version: 1,
          kind: 'debate.phase-changed',
          ids: [id],
        }),
        isPayloadStorableOnTopic(buildDebatePresenceTopic(id), {
          version: 1,
          kind: 'debate.phase-changed',
          ids: [id],
        }),
      ],
      expected: [true, false],
    });
  });
});
