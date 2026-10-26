import type { MatchHistoryEntry, MemberProfile } from '@daisy/protocol';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ProfilePage } from './profile-page';

setupRitewayBun();

const entry = (overrides: Partial<MatchHistoryEntry>): MatchHistoryEntry => ({
  roundId: 'r'.repeat(24),
  completedAt: '2026-10-20T12:00:00.000Z',
  resolution: 'This house would ban homework',
  side: 'affirmative',
  opponents: [{ kind: 'human', label: 'debater-b' }],
  result: 'win',
  forfeit: false,
  judges: 'ai',
  visibility: 'public',
  ...overrides,
});

const profile = (overrides: Partial<MemberProfile> = {}): MemberProfile => ({
  version: 1,
  username: 'debater-a',
  memberSince: '2026-09-14T00:00:00.000Z',
  me: false,
  record: { wins: 3, losses: 1, draws: 0 },
  history: [entry({})],
  nextBefore: null,
  ...overrides,
});

const render = (value: MemberProfile, paged = false) =>
  renderToString(h(ProfilePage, { profile: value, paged }));

describe('ProfilePage', () => {
  test('someone else’s profile', () => {
    const html = render(profile());
    assert({
      given: 'a member seen by someone else',
      should:
        'name them once with their join month and record, list the Round with a link, and offer no edit link or rating',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('>@debater-a<'),
        html.includes('Member since September 2026'),
        html.includes('aria-label="Record"'),
        html.includes('Draws'),
        html.includes(`href="/rounds/${'r'.repeat(24)}"`),
        html.includes('href="/profile/debater-b"'),
        html.includes('>Won<'),
        html.includes('AI judge'),
        html.includes('Edit profile'),
        /rating|elo/i.test(html),
      ],
      expected: [
        1,
        true,
        true,
        true,
        false,
        true,
        true,
        true,
        true,
        false,
        false,
      ],
    });
  });

  test('your own profile', () => {
    const html = render(
      profile({
        me: true,
        history: [entry({ visibility: 'private', result: 'no-ruling' })],
      }),
    );
    assert({
      given: 'the owner, with a private Round nobody ruled on',
      should:
        'mark it as theirs, offer Edit profile, and show the Round as private with no ruling',
      actual: [
        html.includes('>You<'),
        html.includes('Edit profile'),
        html.includes('>private<'),
        html.includes('>No ruling<'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('results and opponents', () => {
    const html = render(
      profile({
        record: { wins: 0, losses: 1, draws: 1 },
        history: [
          entry({
            roundId: 'a'.repeat(24),
            result: 'loss',
            forfeit: true,
            opponents: [
              { kind: 'bot', label: 'Socrates' },
              { kind: 'human', label: null },
            ],
          }),
          entry({ roundId: 'b'.repeat(24), result: 'draw', judges: 'mixed' }),
        ],
      }),
    );
    assert({
      given: 'a forfeited loss against a bot and a former member, and a draw',
      should:
        'show draws in the record, the forfeit, the AI opponent and the former member',
      actual: [
        html.includes('Draws'),
        html.includes('>Lost<'),
        html.includes('By forfeit'),
        html.includes('Socrates (AI)'),
        html.includes('Former member'),
        html.includes('AI and human judges'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('pages', () => {
    const first = render(profile({ nextBefore: 'c'.repeat(24) }));
    const older = render(profile({ history: [] }), true);
    assert({
      given: 'a first page with older Rounds, and an older page with none',
      should:
        'link to the older page, then back to the newest and say there are no older Rounds',
      actual: [
        first.includes(`href="/profile/debater-a?before=${'c'.repeat(24)}"`),
        first.includes('Newest rounds'),
        older.includes('href="/profile/debater-a"'),
        older.includes('No older rounds.'),
        older.includes('Older rounds'),
      ],
      expected: [true, false, true, true, false],
    });
  });

  test('empty histories', () => {
    assert({
      given: 'no listed Rounds, for a visitor and for the owner',
      should: 'say there are no public Rounds, or none yet',
      actual: [
        render(profile({ history: [] })).includes('No public rounds yet.'),
        render(profile({ history: [], me: true })).includes(
          'You have no completed rounds yet.',
        ),
      ],
      expected: [true, true],
    });
  });
});
