import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import type { RealtimeAuthorityReads } from '@daisy/db';
import { channelMessagesResource } from './channel-messages';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const viewer = (n: number) => ({
  actorId: `a${n}`.padEnd(24, 'a'),
  userId: `u${n}`.padEnd(24, 'u'),
  sessionId: `s${n}`.padEnd(24, 's'),
});
const resource = (
  cohort: RealtimeAuthorityReads['messagingChannelCohortAuthority'],
) => {
  const reads = {
    messagingChannelCohortAuthority: cohort,
  } as RealtimeAuthorityReads;
  return channelMessagesResource({
    owner: null,
    authority: { admission: reads, renewal: reads },
    clock: { now: () => '2026-10-28T12:00:00.000Z' },
    now: () => 0,
    readingPolicy: () => undefined,
  });
};

test('a deleted channel denies every viewer in the cohort', async () => {
  const definition = resource(async () => {
    throw createAppError('NOT_FOUND');
  });
  assert({
    given: 'a cohort read for a channel that no longer exists',
    should: 'deny each viewer rather than report an outage',
    actual: await definition.evaluatePermits({
      id: channelId,
      principals: [viewer(1), viewer(2)],
      lane: 'renewal',
    }),
    expected: [{ status: 'denied' }, { status: 'denied' }],
  });
});

test('an infrastructure failure is not a denial', async () => {
  const definition = resource(async () => {
    throw createAppError('INFRASTRUCTURE');
  });
  let code = '';
  try {
    await definition.evaluatePermits({
      id: channelId,
      principals: [viewer(1)],
      lane: 'admission',
    });
  } catch (error) {
    code = (error as { code?: string }).code ?? '';
  }
  assert({
    given: 'a cohort read that fails',
    should:
      'propagate so the node reports unavailable and keeps unexpired permits',
    actual: code,
    expected: 'INFRASTRUCTURE',
  });
});

test('one cohort read per evaluation, on the requested lane', async () => {
  const calls: string[] = [];
  const reads = (lane: string) =>
    ({
      messagingChannelCohortAuthority: async (input: {
        viewers: readonly unknown[];
      }) => {
        calls.push(`${lane}:${input.viewers.length}`);
        return [];
      },
    }) as unknown as RealtimeAuthorityReads;
  const definition = channelMessagesResource({
    owner: null,
    authority: { admission: reads('admission'), renewal: reads('renewal') },
    clock: { now: () => '2026-10-28T12:00:00.000Z' },
    now: () => 0,
    readingPolicy: () => undefined,
  });
  await definition.evaluatePermits({
    id: channelId,
    principals: [viewer(1), viewer(2), viewer(3)],
    lane: 'renewal',
  });
  await definition.evaluatePermits({
    id: channelId,
    principals: [viewer(4)],
    lane: 'admission',
  });
  assert({
    given: 'a renewal batch of three viewers and an admission of one',
    should: 'issue exactly one cohort read each, on its own lane',
    actual: calls,
    expected: ['renewal:3', 'admission:1'],
  });
});
