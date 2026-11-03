import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { archiveEntries, type ArchiveRound } from './archive';
import { account, nowMs, visitor } from './fixture.test-support';

setupRitewayBun();

const row: ArchiveRound = {
  id: 'round',
  title: 'Semifinal',
  resolution: 'Resolved: x',
  competitionType: 'ranked',
  visibility: 'public',
  hostActorId: 'host',
  completedAtMs: nowMs,
  seatedActorIds: ['aff', 'neg'],
  release: { releasedThroughMs: Number.MAX_SAFE_INTEGER, stopped: false },
  status: 'ready',
  durationMs: 1_800_000,
  hasTranscript: true,
  outcome: 'affirmative',
  debaters: [
    { role: 'affirmative', label: 'ada' },
    { role: 'negative', label: 'lin' },
  ],
};
const entries = (over: Partial<ArchiveRound>, viewer = visitor) =>
  archiveEntries({ rows: [{ ...row, ...over }], nextBefore: null }, viewer);

describe('archiveEntries', () => {
  test('a ranked Recording for the audience', () => {
    assert({
      given: 'a released ranked Recording',
      should: 'show its facts and result, but no visibility of its own',
      actual: entries({}),
      expected: [
        {
          roundId: 'round',
          href: '/recordings/round',
          title: 'Semifinal',
          ranked: true,
          date: '2026-11-02',
          length: '30 min',
          aff: '@ada',
          neg: '@lin',
          result: 'Affirmative wins',
          media: 'watch',
          transcript: true,
          ownVisibility: null,
        },
      ],
    });
  });

  test('never leaks what the store should have filtered', () => {
    assert({
      given: 'a private Round a store bug returned to a stranger',
      should: 'drop the row',
      actual: entries({ visibility: 'private' }, account('stranger')),
      expected: [],
    });
    assert({
      given: 'a ranked Round behind the watermark',
      should: 'drop the row',
      actual: entries({ release: { releasedThroughMs: null, stopped: false } }),
      expected: [],
    });
    const [casual] = entries({ competitionType: 'casual' });
    assert({
      given: 'a public casual Recording',
      should: 'show it with no result and no transcript link',
      actual: [casual?.result, casual?.transcript],
      expected: [null, false],
    });
    assert({
      given: 'a public casual Round with no video',
      should: 'not be listed for a stranger',
      actual: entries({ competitionType: 'casual', status: null }),
      expected: [],
    });
  });

  test('own history shows every state honestly', () => {
    const [own] = entries(
      {
        competitionType: 'casual',
        visibility: 'private',
        status: 'failed',
        durationMs: null,
        outcome: null,
      },
      account('neg'),
    );
    assert({
      given: 'a debater own private Round whose capture failed',
      should:
        'list it as failed with no length, and no winner rather than a draw',
      actual: [own?.media, own?.length, own?.ownVisibility, own?.result],
      expected: ['failed', null, 'private', 'No winner'],
    });
  });
});
