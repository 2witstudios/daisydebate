import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { twoSides } from '@daisy/protocol/seats';
import { archiveEntries, recordOfferDue, type ArchiveRound } from './archive';
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
  recordingPolicy: 'released',
  officialActorIds: [],
  release: { releasedThroughMs: Number.MAX_SAFE_INTEGER, stop: 'none' },
  status: 'ready',
  durationMs: 1_800_000,
  hasTranscript: true,
  sides: twoSides,
  outcome: { kind: 'winner', side: 'affirmative' },
  debaters: [
    { seat: { kind: 'side', side: 'affirmative', slot: 0 }, label: 'ada' },
    { seat: { kind: 'side', side: 'negative', slot: 0 }, label: 'lin' },
  ],
};
const entries = (over: Partial<ArchiveRound>, viewer = visitor) =>
  archiveEntries(
    { rows: [{ ...row, ...over }], nextBefore: null },
    viewer,
    nowMs,
  );

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
          seats: ['@ada', '@lin'],
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
      actual: entries({ release: { releasedThroughMs: null, stop: 'none' } }),
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

  test('video the page holds back is not offered here', () => {
    const [held] = entries({
      release: {
        releasedThroughMs: Number.MAX_SAFE_INTEGER,
        stop: 'media_withheld',
      },
    });
    assert({
      given: 'a ranked Recording whose Broadcast was stopped, for the audience',
      should: 'list it as withheld with no length, keeping its text and result',
      actual: [held?.media, held?.length, held?.transcript, held?.result],
      expected: ['withheld', null, true, 'Affirmative wins'],
    });
    const [own] = entries(
      { release: { releasedThroughMs: null, stop: 'media_withheld' } },
      account('neg'),
    );
    assert({
      given: 'the same Recording for a debater who sat in it',
      should: 'still offer the video and its length',
      actual: [own?.media, own?.length],
      expected: ['watch', '30 min'],
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

describe('recordOfferDue', () => {
  test('only an own unrecorded casual Round under My debates', () => {
    const own = {
      ranked: false,
      media: 'not_recorded',
      ownVisibility: 'private',
    } as const;
    assert({
      given:
        'such a Round under My debates, under All, and My debates holding only a ranked, a recorded or another member’s Round',
      should: 'be due only for the first',
      actual: [
        recordOfferDue('mine', [own]),
        recordOfferDue('all', [own]),
        recordOfferDue('mine', [{ ...own, ranked: true }]),
        recordOfferDue('mine', [{ ...own, media: 'watch' }]),
        recordOfferDue('mine', [{ ...own, ownVisibility: null }]),
        recordOfferDue('mine', []),
      ],
      expected: [true, false, false, false, false, false],
    });
  });
});
