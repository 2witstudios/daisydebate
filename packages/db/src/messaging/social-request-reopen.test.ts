import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { dmRequestFrame } from './social-request';
import {
  actorId,
  peerId,
  channelId,
  now,
  input,
  pair,
  command,
  request,
} from './social-request.test-support';
setupRitewayBun();
const channelRow = (lifecycle: string, changeVersion = 4, revision = 2) => [
  channelId,
  'dm',
  'social.dm',
  1,
  lifecycle,
  null,
  0,
  changeVersion,
  revision,
  new Date(now),
];
test('a cooled down closed DM reopens the durable channel and invalidates current authority rather than allocating a replacement', async () => {
  const { client, queries } = fakeSql([
    [request('declined', new Date('2026-10-09T17:00:00Z'))],
    [[0, 0]],
    [channelRow('active')],
    [],
    [[1, '9']],
    [],
    [{ lowActorId: actorId, highActorId: peerId }],
    [[2, '9']],
    [],
    [[3, '9']],
    [],
    [],
    [],
  ]);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  const result = await frame.commitDmRequest({
    ...command,
    channelId: 'n'.repeat(24),
  });
  const write = queries.find((entry) =>
    entry.query.startsWith('update "messaging_dm_pairs"'),
  );
  assert({
    given: 'a closed active DM beyond cooldown',
    should:
      'reuse its channel, clear decision time, replace introduction, and advance authority exactly once',
    actual: [
      result,
      queries.some((entry) =>
        entry.query.startsWith('insert into "messaging_channels"'),
      ),
      write?.params.includes(command.introduction),
      queries
        .filter((entry) =>
          entry.query.startsWith('update "messaging_channels"'),
        )
        .map((entry) => entry.params.slice(0, 2)),
    ],
    expected: [{ channelId, state: 'pending' }, false, true, [[5, 3]]],
  });
});
for (const channel of [
  null,
  channelRow('archived'),
  channelRow('active', Number.MAX_SAFE_INTEGER),
])
  test(`closed request cannot reopen ${channel === null ? 'absent' : channel[4]} exhausted=${channel?.[7] === Number.MAX_SAFE_INTEGER}`, async () => {
    const { client, queries } = fakeSql([
      [request('cancelled', new Date('2026-10-09T17:00:00Z'))],
      [[0, 0]],
      channel ? [channel] : [],
    ]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    await assertRejects({
      given: 'absent/archived channel or exhausted authority counter',
      should: 'refuse reopening before any mutation',
      actual: () => frame.commitDmRequest(command),
      code:
        channel?.[7] === Number.MAX_SAFE_INTEGER ? 'CONFLICT' : 'AUTHORIZATION',
    });
    assert({
      given: 'the refusal',
      should: 'perform no durable writes',
      actual: queries.every((entry) => entry.query.startsWith('select')),
      expected: true,
    });
  });
test('admitted request discovery returns only current channel/state or absence', async () => {
  const { client } = fakeSql([[request('pending')], []]);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  assert({
    given: 'a pair with then without a durable request',
    should: 'project no introduction or actor associations through discovery',
    actual: [await frame.readDmRequest(), await frame.readDmRequest()],
    expected: [{ channelId, state: 'pending' }, null],
  });
});
