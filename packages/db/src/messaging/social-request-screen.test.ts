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
/**
 * The screen over scripted driver answers. `order()` names each query: the
 * pair read, the channel row locked for update (with the id it binds), and
 * the declines read; anything else appears as its own SQL.
 */
const screenOver = (script: Parameters<typeof fakeSql>[0]) => {
  const { client, queries } = fakeSql(script);
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
          ? `channel:${String(entry.params[0])}`
          : entry.query.includes('"messaging_dm_pairs"')
            ? 'pair'
            : entry.query,
    );
  return { screen: () => frame.screenDmRequest(now), order };
};
const lockedChannel = `channel:${channelId}`;
for (const state of ['pending', 'accepted'])
  test(`the screen converges on an existing ${state} pair without replacing authority`, async () => {
    const { screen, order } = screenOver([[request(state)]]);
    assert({
      given: `an existing ${state} DM`,
      should:
        'return the durable channel after reading the pair only: no budget, ledger, channel or pair write',
      actual: [await screen(), order()],
      expected: [{ channelId, state }, ['pair']],
    });
  });
test('the screen answers null for a new request, having read the decline block', async () => {
  const { screen, order } = screenOver([[], [{ blocked: false }]]);
  assert({
    given: 'no DM yet and no decline block',
    should: 'answer null to commit, after reading the pair and the declines',
    actual: [await screen(), order()],
    expected: [null, ['pair', 'declines']],
  });
});
test('the screen refuses a decline-blocked new request as a block', async () => {
  const { screen, order } = screenOver([[], [{ blocked: true }]]);
  await assertRejects({
    given: 'no DM yet and the peer’s declines blocking the requester',
    should: 'refuse it as a block is refused',
    actual: screen,
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused screen',
    should: 'have read the pair and the declines',
    actual: order(),
    expected: ['pair', 'declines'],
  });
});
/** The screen over a declined DM on a channel in `lifecycle`. */
const screenDeclined = (lifecycle: string, blocked: boolean) =>
  screenOver([
    [request('declined', new Date(now))],
    [channelRow(lifecycle)],
    [{ blocked }],
  ]);
test('the screen answers null for a declined DM on an active channel, after checking it and the declines', async () => {
  const { screen, order } = screenDeclined('active', false);
  assert({
    given: 'a declined DM on an active channel, with no decline block',
    should:
      'answer null to commit, reading the pair, then locking that DM’s channel row for update, then the declines',
    actual: [await screen(), order()],
    expected: [null, ['pair', lockedChannel, 'declines']],
  });
});
for (const [lifecycle, blocked, reads] of [
  ['archived', false, ['pair', lockedChannel]],
  ['active', true, ['pair', lockedChannel, 'declines']],
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
