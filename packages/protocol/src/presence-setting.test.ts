import { assert, setupRitewayBun, test } from 'riteway/bun';
import { presenceSettingSchema } from './presence-setting';
import {
  isPayloadDeliverableOnTopic,
  isPayloadStorableOnTopic,
} from './realtime-payloads';
import { ONLINE_TOPIC, parseTopic } from './topics';
setupRitewayBun();

test('the chosen status command', () => {
  const parse = (value: unknown) =>
    presenceSettingSchema.safeParse(value).success;
  assert({
    given: 'a choice, a derived status, and a choice naming another member',
    should: 'accept only the choice',
    actual: [
      parse({ version: 1, status: 'busy' }),
      parse({ version: 1, status: 'round' }),
      parse({ version: 1, status: 'busy', username: 'ada' }),
    ],
    expected: [true, false, false],
  });
});

test('the online topic is one closed name', () => {
  assert({
    given: 'the one topic, and any other key',
    should: 'parse only the one',
    actual: [parseTopic(ONLINE_TOPIC), parseTopic('online:anyone')],
    expected: [{ family: 'online' }, undefined],
  });
});

test('nothing may be stored on the online topic', () => {
  assert({
    given: 'a doorbell row aimed at the online topic',
    should: 'be refused: rings are never outbox rows',
    actual: isPayloadStorableOnTopic(ONLINE_TOPIC, {
      kind: 'messaging.inbox.changed',
    }),
    expected: false,
  });
});

test('a challenge doorbell rings only on an inbox', () => {
  const inbox = `user:${'a'.repeat(24)}:inbox`;
  assert({
    given: 'the challenge doorbell on an inbox and on the online topic',
    should: 'store and deliver on the inbox alone',
    actual: [
      isPayloadDeliverableOnTopic(inbox, { kind: 'challenge.changed' }),
      isPayloadStorableOnTopic(ONLINE_TOPIC, { kind: 'challenge.changed' }),
    ],
    expected: [true, false],
  });
});
