import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { dmRequestFrame } from './social-request';
import { contactReactions } from '../contact-composition';
import {
  channelId,
  now,
  input,
  pair,
  request,
  channelRow,
} from './social-request.test-support';
setupRitewayBun();

// The real scoped authorization read is proven in messaging-request.integration.ts.
const screenOver = (
  script: Parameters<typeof fakeSql>[0],
  authorized = true,
) => {
  const { client, queries } = fakeSql(script);
  const frame = dmRequestFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {
      if (!authorized) throw createAppError('AUTHORIZATION');
    },
    contactReactions.relations,
  );
  const order = () =>
    queries.map((entry) =>
      /"messaging_channels".*for update$/s.test(entry.query)
        ? `channel:${String(entry.params[0])}`
        : entry.query.includes('"messaging_dm_pairs"')
          ? 'pair'
          : entry.query,
    );
  return { screen: () => frame.screenDmRequest(), order };
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
test('the screen answers null after authorization admits a new request', async () => {
  const { screen, order } = screenOver([[]]);
  assert({
    given: 'authorization admitted the request and there is no DM yet',
    should: 'answer null to commit after reading the pair',
    actual: [await screen(), order()],
    expected: [null, ['pair']],
  });
});
test('the screen stops when current request authorization refuses', async () => {
  const { screen, order } = screenOver([], false);
  await assertRejects({
    given: 'authorization refusing the current request',
    should: 'refuse as a block is refused',
    actual: screen,
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused screen',
    should: 'leave pair, channel and budget unchanged',
    actual: order(),
    expected: [],
  });
});
const screenDeclined = (lifecycle: string) =>
  screenOver([[request('declined', new Date(now))], [channelRow(lifecycle)]]);
test('the screen locks an active channel before allowing a declined DM to reopen', async () => {
  const { screen, order } = screenDeclined('active');
  assert({
    given: 'authorization allows a declined DM on an active channel',
    should: 'read the pair and lock its channel, then answer null to commit',
    actual: [await screen(), order()],
    expected: [null, ['pair', lockedChannel]],
  });
});
test('the screen refuses to reopen an archived channel before spending', async () => {
  const { screen, order } = screenDeclined('archived');
  await assertRejects({
    given: 'a declined DM asked again on an archived channel',
    should: 'refuse as a block is refused',
    actual: screen,
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused screen',
    should: 'stop after the channel refusal',
    actual: order(),
    expected: ['pair', lockedChannel],
  });
});
