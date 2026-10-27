import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { dmRequestFrame } from './social-request';
import {
  channelId,
  now,
  input,
  pair,
  request,
  channelRow,
} from './social-request.test-support';
setupRitewayBun();

// screenDmRequest: convergence, then the pre-spend refusals (DEC-251).
for (const state of ['pending', 'accepted'])
  test(`the screen converges on an existing ${state} pair without replacing authority`, async () => {
    const { client, queries } = fakeSql([[request(state)]]);
    const frame = dmRequestFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    );
    assert({
      given: `an existing ${state} DM`,
      should:
        'return the durable channel without spending a social request, writing a ledger row, creating channels or renewing pair state',
      actual: [
        await frame.screenDmRequest(now),
        queries.map((entry) => entry.query.split(/\s/)[0]),
        queries.some((entry) => entry.query.includes('insert')),
      ],
      expected: [{ channelId, state }, ['select'], false],
    });
  });
/** The screen over no DM yet, the peer's declines blocking or not. */
const screenWithoutDm = (blocked: boolean) => {
  const { client, queries } = fakeSql([[], [{ blocked }]]);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  const readDeclines = () =>
    queries.some((entry) => entry.query.includes('messaging_social_declines'));
  return { screen: () => frame.screenDmRequest(now), readDeclines };
};
test('the screen answers null for a new request, having read the decline block', async () => {
  const { screen, readDeclines } = screenWithoutDm(false);
  assert({
    given: 'no DM yet and no decline block',
    should: 'answer null to commit, after reading the decline block',
    actual: [await screen(), readDeclines()],
    expected: [null, true],
  });
});
test('the screen refuses a decline-blocked new request as a block', async () => {
  const { screen, readDeclines } = screenWithoutDm(true);
  await assertRejects({
    given: 'no DM yet and the peer’s declines blocking the requester',
    should: 'refuse it as a block is refused',
    actual: screen,
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused screen',
    should: 'have read the decline block',
    actual: readDeclines(),
    expected: true,
  });
});
/** The screen over a declined DM on a channel in `lifecycle`. */
const screenDeclined = (lifecycle: string, blocked: boolean) => {
  const { client, queries } = fakeSql([
    [request('declined', new Date(now))],
    [channelRow(lifecycle)],
    [{ blocked }],
  ]);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  const order = () =>
    queries.map((entry) =>
      entry.query.includes('messaging_social_declines')
        ? 'declines'
        : /"messaging_channels".*for update$/s.test(entry.query)
          ? 'channel'
          : entry.query.includes('"messaging_dm_pairs"')
            ? 'pair'
            : entry.query,
    );
  return { screen: () => frame.screenDmRequest(now), order };
};
test('the screen answers null for a declined DM on an active channel, after checking it and the declines', async () => {
  const { screen, order } = screenDeclined('active', false);
  assert({
    given: 'a declined DM on an active channel, with no decline block',
    should:
      'answer null to commit, reading the pair, then locking the channel row for update, then the declines',
    actual: [await screen(), order()],
    expected: [null, ['pair', 'channel', 'declines']],
  });
});
for (const [lifecycle, blocked, reads] of [
  ['archived', false, ['pair', 'channel']],
  ['active', true, ['pair', 'channel', 'declines']],
] as const)
  test(`the screen refuses a declined DM before spending: ${lifecycle} channel, decline block ${blocked}`, async () => {
    const { screen, order } = screenDeclined(lifecycle, blocked);
    await assertRejects({
      given: `a declined DM asked again on an ${lifecycle} channel, decline block ${blocked}`,
      should: 'refuse it as a block is refused',
      actual: screen,
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the refused screen',
      should: 'stop at the first refusal',
      actual: order(),
      expected: [...reads],
    });
  });
