import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgePanel, readProfile, type ProfileStore } from './read-profile';

setupRitewayBun();

const member = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  username: 'debater-a',
  memberSince: '2026-09-01T00:00:00.000Z',
};
const roundId = 'r'.repeat(24);
const row = {
  roundId,
  completedAt: '2026-10-26T12:00:00.000Z',
  resolution: 'This house would ban homework',
  visibility: 'public',
  outcome: 'negative',
  role: 'affirmative',
  forfeit: true,
  seats: [
    { role: 'affirmative', kind: 'human', label: 'debater-a' },
    { role: 'affirmative', kind: 'human', label: 'teammate' },
    { role: 'negative', kind: 'bot', label: 'Socrates' },
    { role: 'negative', kind: 'human', label: null },
    { role: 'judge', kind: 'bot', label: 'Judge bot' },
  ],
} as const;

/** A store over one member; records each record and history read it is asked for. */
const storeFor = (found: typeof member | null) => {
  const reads: unknown[] = [];
  const recordReads: unknown[] = [];
  const store: ProfileStore = {
    readMember: async () => found,
    readRecordGroups: async (input) => {
      recordReads.push(input);
      return [
        {
          status: 'completed',
          outcome: 'affirmative',
          role: 'affirmative',
          rounds: 2,
        },
        { status: 'completed', outcome: null, role: 'negative', rounds: 1 },
      ];
    },
    readMatchHistory: async (input) => {
      reads.push(input);
      return { rows: [row], nextBefore: roundId };
    },
  };
  return { store, reads, recordReads };
};

describe('readProfile', () => {
  test('a visitor reading a member', async () => {
    const { store, reads, recordReads } = storeFor(member);
    const profile = await readProfile(store, {
      username: 'debater-a',
      viewerUserId: null,
      query: {},
    });
    assert({
      given: 'a visitor and a member with a forfeited loss against a team',
      should:
        'tally public Rounds only, read public Rounds only and list the opposing seats from the member’s side',
      actual: {
        me: profile?.me,
        record: profile?.record,
        recordRead: recordReads[0],
        read: reads[0],
        entry: profile?.history[0],
        nextBefore: profile?.nextBefore,
      },
      expected: {
        me: false,
        record: { wins: 2, losses: 0, draws: 0 },
        recordRead: { actorId: member.actorId, publicOnly: true },
        read: {
          actorId: member.actorId,
          publicOnly: true,
          before: null,
          limit: 20,
        },
        entry: {
          roundId,
          completedAt: row.completedAt,
          resolution: row.resolution,
          side: 'affirmative',
          opponents: [
            { kind: 'bot', label: 'Socrates' },
            { kind: 'human', label: null },
          ],
          result: 'loss',
          forfeit: true,
          judges: 'ai',
          visibility: 'public',
        },
        nextBefore: roundId,
      },
    });
  });

  test('the member reading their own profile', async () => {
    const { store, reads, recordReads } = storeFor(member);
    const profile = await readProfile(store, {
      username: 'debater-a',
      viewerUserId: member.userId,
      query: { before: roundId },
    });
    assert({
      given: 'the member themself, asking for an older page',
      should:
        'mark it as theirs, count every Round and read every Round before the cursor',
      actual: [profile?.me, recordReads[0], reads[0]],
      expected: [
        true,
        { actorId: member.actorId, publicOnly: false },
        {
          actorId: member.actorId,
          publicOnly: false,
          before: roundId,
          limit: 20,
        },
      ],
    });
  });

  test('a name no member holds', async () => {
    const { store, reads } = storeFor(null);
    assert({
      given: 'a username with no live member',
      should: 'read nothing more and answer null',
      actual: [
        await readProfile(store, {
          username: 'nobody',
          viewerUserId: null,
          query: {},
        }),
        reads.length,
      ],
      expected: [null, 0],
    });
  });
});

describe('judgePanel', () => {
  test('who ruled', () => {
    const seat = (role: string, kind: 'human' | 'bot') => ({ role, kind });
    assert({
      given: 'no judges, AI judges, human judges, and both',
      should: 'name the panel, ignoring debater seats',
      actual: [
        judgePanel([seat('affirmative', 'bot')]),
        judgePanel([seat('judge', 'bot'), seat('negative', 'human')]),
        judgePanel([seat('judge', 'human'), seat('affirmative', 'bot')]),
        judgePanel([seat('judge', 'human'), seat('judge', 'bot')]),
      ],
      expected: ['none', 'ai', 'human', 'mixed'],
    });
  });
});
