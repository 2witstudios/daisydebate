import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import type { RealtimeAuthorityReads } from '@daisy/db';
import { evaluateContextChannelPermits } from './context-channel-permits';

setupRitewayBun();
const principals = [
  {
    actorId: 'a'.repeat(24),
    userId: 'u'.repeat(24),
    sessionId: 's'.repeat(24),
  },
];
const absent = async () => {
  throw createAppError('NOT_FOUND');
};
const evaluate = (reads: Partial<RealtimeAuthorityReads>, asked: string[]) =>
  evaluateContextChannelPermits({
    reads: {
      roundFloorChannelCohortAuthority: async (...args: unknown[]) => {
        asked.push('floor');
        return (
          reads.roundFloorChannelCohortAuthority as unknown as (
            ...args: unknown[]
          ) => Promise<unknown>
        )(...args);
      },
      roomCommunityChannelCohortAuthority: async (...args: unknown[]) => {
        asked.push('room');
        return (
          reads.roomCommunityChannelCohortAuthority as unknown as (
            ...args: unknown[]
          ) => Promise<unknown>
        )(...args);
      },
    } as unknown as RealtimeAuthorityReads,
    id: 'c'.repeat(24),
    principals,
    clock: { now: () => '2026-11-12T00:00:00.000Z' },
    now: () => 0,
  });
const granted = [{ status: 'denied' as const, by: 'owner' }];

test('a channel the floor answers for is never offered to the Room', async () => {
  const asked: string[] = [];
  const actual = await evaluate(
    {
      roundFloorChannelCohortAuthority: (async () =>
        granted) as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
      roomCommunityChannelCohortAuthority:
        absent as unknown as RealtimeAuthorityReads['roomCommunityChannelCohortAuthority'],
    },
    asked,
  );
  assert({
    given: 'a floor channel',
    should: 'return the floor’s own decisions and ask no other owner',
    actual: [actual, asked],
    expected: [granted, ['floor']],
  });
});

test('a channel the floor does not own is the Room’s to answer for', async () => {
  const asked: string[] = [];
  const actual = await evaluate(
    {
      roundFloorChannelCohortAuthority:
        absent as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
      roomCommunityChannelCohortAuthority: (async () =>
        granted) as unknown as RealtimeAuthorityReads['roomCommunityChannelCohortAuthority'],
    },
    asked,
  );
  assert({
    given: 'a Room chat channel',
    should: 'return the Room’s decisions after the floor says it is not its',
    actual: [actual, asked],
    expected: [granted, ['floor', 'room']],
  });
});

test('a channel no owner lets be observed denies every viewer', async () => {
  const asked: string[] = [];
  const actual = await evaluate(
    {
      roundFloorChannelCohortAuthority:
        absent as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
      roomCommunityChannelCohortAuthority:
        absent as unknown as RealtimeAuthorityReads['roomCommunityChannelCohortAuthority'],
    },
    asked,
  );
  assert({
    given:
      'a channel neither owner finds, such as a Room chat whose Room started',
    should: 'deny each viewer rather than report an outage',
    actual: [actual, asked],
    expected: [[{ status: 'denied' }], ['floor', 'room']],
  });
});

test('an owner’s infrastructure failure is not a denial', async () => {
  let code = '';
  try {
    await evaluate(
      {
        roundFloorChannelCohortAuthority:
          absent as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
        roomCommunityChannelCohortAuthority: (async () => {
          throw createAppError('INFRASTRUCTURE');
        }) as unknown as RealtimeAuthorityReads['roomCommunityChannelCohortAuthority'],
      },
      [],
    );
  } catch (error) {
    code = (error as { code?: string }).code ?? '';
  }
  assert({
    given: 'a Room authority read that fails',
    should: 'propagate so unexpired permits are kept',
    actual: code,
    expected: 'INFRASTRUCTURE',
  });
});
