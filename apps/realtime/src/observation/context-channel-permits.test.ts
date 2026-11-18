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
      floorRoundOf: reads.floorRoundOf ?? (async () => null),
      readRoundYouth: reads.readRoundYouth ?? (async () => false),
      readYouthRecordingPeople:
        reads.readYouthRecordingPeople ?? (async () => ({ debaters: [] })),
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

test("a Youth Round's linked adult is asked again with the Round's linked adults", async () => {
  const asked: string[] = [];
  const youthSeen: unknown[] = [];
  const allowed = {
    status: 'allowed' as const,
    partition: 'p',
    disclosureRevision: 1,
    minimumContentRevision: 0,
    validUntil: 1,
  };
  const actual = await evaluate(
    {
      roundFloorChannelCohortAuthority: (async (input: {
        readonly youth?: unknown;
      }) => {
        youthSeen.push(input.youth ?? null);
        return input.youth ? [allowed] : [{ status: 'denied' }];
      }) as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
      floorRoundOf: async () => 'r'.repeat(24),
      readRoundYouth: async () => true,
      readYouthRecordingPeople: async () => ({
        debaters: [
          {
            actorId: 'd'.repeat(24),
            userId: 'v'.repeat(24),
            linkedAdultActorIds: [principals[0]!.actorId],
          },
        ],
      }),
    },
    asked,
  );
  assert({
    given:
      'a floor that names the viewer nowhere, on a Youth Round they are linked to',
    should:
      'ask the floor again with the linked adults and answer its decision (ADR 0155)',
    actual: [actual, youthSeen, asked],
    expected: [
      [allowed],
      [null, { linkedAdultActorIds: [principals[0]!.actorId] }],
      ['floor', 'floor'],
    ],
  });
});

test('a viewer the floor refuses on any other Round is not asked again', async () => {
  const asked: string[] = [];
  const actual = await evaluate(
    {
      roundFloorChannelCohortAuthority: (async () => [
        { status: 'denied' },
      ]) as unknown as RealtimeAuthorityReads['roundFloorChannelCohortAuthority'],
      floorRoundOf: async () => 'r'.repeat(24),
      readRoundYouth: async () => false,
    },
    asked,
  );
  assert({
    given: 'a refused viewer on a Round that is not a Youth one',
    should: 'keep the refusal and read nobody’s links',
    actual: [actual, asked],
    expected: [[{ status: 'denied' }], ['floor']],
  });
});
