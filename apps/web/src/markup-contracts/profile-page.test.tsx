import type { MatchHistoryEntry } from '@daisy/protocol/member-profile';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ProfilePage } from '../ui/profile/profile-page/profile-page';

setupRitewayBun();

const entry = (overrides: Partial<MatchHistoryEntry>): MatchHistoryEntry => ({
  roundId: 'r'.repeat(24),
  completedAt: '2026-10-20T12:00:00.000Z',
  resolution: 'This house would ban homework',
  side: 'affirmative',
  opponents: [{ kind: 'human', label: 'debater-b', closed: false }],
  result: 'win',
  forfeit: false,
  judges: 'ai',
  visibility: 'public',
  ladder: null,
  ...overrides,
});

/**
 * A ladder chip was a plum-toned badge with no role or name of its own; only
 * its colour class shows whether one is drawn (ADR 0162).
 */
describe('ProfilePage markup', () => {
  test('no Round in the history names a ladder', () => {
    const html = renderMarkup(
      h(ProfilePage, {
        paged: false,
        profile: {
          version: 1,
          username: 'debater-a',
          memberSince: '2026-09-14T00:00:00.000Z',
          closed: false,
          me: false,
          record: { wins: 3, losses: 1 },
          history: [
            entry({
              roundId: 'a'.repeat(24),
              ladder: { style: 'freestyle', division: 'youth' },
            }),
            entry({ roundId: 'b'.repeat(24) }),
          ],
          nextBefore: null,
          shown: {
            profileId: null,
            displayName: null,
            bio: null,
            photoId: null,
          },
        },
      }),
    );
    assert({
      given: 'a ranked Youth Round and a casual Round in the history',
      should: 'draw no plum ladder chip on either row',
      actual: html.includes('text-hue-plum'),
      expected: false,
    });
  });
});
