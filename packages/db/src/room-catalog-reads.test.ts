import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { foundationDefinition, oneOnOneRoomConfig } from './reference-formats';
import { caller, accountFact } from './room-command-operations.test-support';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

test('Room catalog lists role-bearing formats at their canonical presets', async () => {
  const account = accountFact();
  // Select column order as listRoomCatalogSources declares it.
  const formatRow = [
    'value',
    'Value',
    1,
    'standard',
    null,
    [],
    'value daisy',
    2,
    foundationDefinition,
    null,
    null,
  ];
  const { database, queries } = createTestDatabase([
    [account],
    [formatRow],
    [['value', 4, 1, oneOnOneRoomConfig]],
  ]);
  const catalog = await database.listRoomCatalogSources(
    caller,
    (fact) => fact?.member === true,
  );
  assert({
    given: 'an authorized member and one standard with its current preset',
    should: 'return the format with its role and canonical preset',
    actual: catalog.map(({ id, version, role, preset }) => [
      id,
      version,
      role,
      preset.version,
    ]),
    expected: [['value', 1, 'standard', 4]],
  });
  assert({
    given: 'the read',
    should:
      'list only formats with a catalog role, never private or role-null ones',
    actual: /catalog_role" is not null/.test(queries[1]?.query ?? ''),
    expected: true,
  });
});
test('Room catalog refuses a listed format with no current preset', async () => {
  const account = accountFact();
  const { database } = createTestDatabase([
    [account],
    [
      [
        'value',
        'Value',
        1,
        'standard',
        null,
        [],
        '',
        2,
        foundationDefinition,
        null,
        null,
      ],
    ],
    [],
  ]);
  await assertRejects({
    given: 'a role-bearing format without a current preset',
    should: 'refuse as an invariant rather than invent a config',
    actual: () =>
      database.listRoomCatalogSources(caller, (fact) => fact?.member === true),
    code: 'INVARIANT',
  });
});
test('Room create-receipt read preserve collection and command authority', async () => {
  const account = accountFact();
  const receipt = createTestDatabase([[], [account], [account], []]);
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
