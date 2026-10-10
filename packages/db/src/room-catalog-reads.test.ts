import { assert, setupRitewayBun, test } from 'riteway/bun';
import { foundationDefinition } from './reference-formats';
import {
  caller,
  room,
  accountFact,
} from './room-command-operations.test-support';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

test('Room catalog joins only current public definitions to active presets', async () => {
  const account = accountFact();
  const { database } = createTestDatabase([
    [account],
    [account],
    [[room.formatId, 'Foundation', 1, foundationDefinition]],
    [],
  ]);

  const catalog = await database.listRoomCatalogSources(
    caller,
    (fact) => fact?.member === true,
  );

  assert({
    given: 'an authorized member and a current public format without presets',
    should: 'return the current definition with an empty active preset list',
    actual: catalog.map(({ id, version, presets }) => [id, version, presets]),
    expected: [[room.formatId, 1, []]],
  });
});
test('Room create-receipt read preserve collection and command authority', async () => {
  const account = accountFact();
  const receipt = createTestDatabase([[account], [account], [], []]);
  const absent = await receipt.database.readRoomCreateReceipt({
    caller,
    commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
    payloadDigest: 'c'.repeat(64),
    authorize: (fact) => fact?.member === true,
  });

  assert({
    given: 'a member with one visible Room and no matching create receipt',
    should: 'return no absent receipt',
    actual: absent,
    expected: null,
  });
});
test('Room bot catalog includes current actor eligibility facts', async () => {
  const account = accountFact();
  const availableBotId = 'c6a4e2f8h1j3k5m7n9p2r4t6';
  const unavailableBotId = 'c2a4e6f8h1j3k5m7n9p2r4t6';
  const { database } = createTestDatabase([
    [account],
    [account],
    [[availableBotId], [unavailableBotId]],
    [[availableBotId, 'bot', null, null, null, 'Debater']],
    [[unavailableBotId, 'bot', null, null, null, null]],
  ]);

  const bots = await database.listRoomBots(
    caller,
    (fact) => fact?.member === true,
  );

  assert({
    given: 'a current bot catalog with one configured and one unconfigured bot',
    should: 'preserve the bot identity and expose eligibility as a fact',
    actual: bots.map(({ actorId, label, eligible }) => [
      actorId,
      label,
      eligible,
    ]),
    expected: [
      [availableBotId, 'Debater', true],
      [unavailableBotId, '', false],
    ],
  });
});
