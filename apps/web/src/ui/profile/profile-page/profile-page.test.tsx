import type { MatchHistoryEntry } from '@daisy/protocol/member-profile';
import type { ProfileView } from '../../../features/profile/read-profile';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { ProfilePage } from './profile-page';

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

const nothingShown = {
  profileId: null,
  displayName: null,
  bio: null,
  photoId: null,
};

const profile = (overrides: Partial<ProfileView> = {}): ProfileView => ({
  version: 1,
  username: 'debater-a',
  memberSince: '2026-09-14T00:00:00.000Z',
  closed: false,
  me: false,
  record: { wins: 3, losses: 1 },
  history: [entry({})],
  nextBefore: null,
  shown: nothingShown,
  premium: false,
  ...overrides,
});

const render = (value: ProfileView, paged = false) =>
  renderAccessible(h(ProfilePage, { profile: value, paged }));

/** Whether a piece of the page reads exactly this text. */
const shows = (view: AccessibleView, text: string) =>
  view.all('generic').some((element) => element.textContent === text);

/** The sources of the page's decorative images (the avatar photo). */
const photos = (view: AccessibleView) =>
  view.all('presentation').map((image) => image.getAttribute('src'));

const title = 'This house would ban homework';

describe('ProfilePage', () => {
  test('a history row opens the page its reader may open', () => {
    const roundId = 'r'.repeat(24);
    const own = render(profile({ me: true })).attribute('link', title, 'href');
    const stranger = render(profile()).attribute('link', title, 'href');
    assert({
      given: 'their own row, and a stranger\u2019s row',
      should: 'link the seat to the Round, and the stranger to its public page',
      actual: [own, stranger],
      expected: [`/rounds/${roundId}`, `/watch/${roundId}`],
    });
  });

  test('no Round in the history names a ladder (ADR 0162)', () => {
    const text = render(
      profile({
        history: [
          entry({
            roundId: 'a'.repeat(24),
            ladder: { style: 'freestyle', division: 'youth' },
          }),
          entry({ roundId: 'b'.repeat(24) }),
        ],
      }),
    ).textContent();
    assert({
      given: 'a ranked Youth Round and a casual Round in the history',
      should: 'chip neither row with a ladder',
      actual: [
        text.includes('Youth – Freestyle'),
        text.includes('Open – Freestyle'),
      ],
      expected: [false, false],
    });
  });

  test('someone else’s profile', () => {
    const view = render(profile());
    const text = view.textContent();
    assert({
      given: 'a member seen by someone else',
      should:
        'name them once with their join month and record, list the Round with a link, and offer no edit link or rating',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.has('heading', '@debater-a', { level: 1 }),
        text.includes('Member since September 2026'),
        view.has('region', 'Record'),
        text.includes('No ruling'),
        view.attribute('link', title, 'href'),
        view.attribute('link', '@debater-b', 'href'),
        shows(view, 'Won'),
        text.includes('AI judge'),
        text.includes('Edit profile'),
        /rating|elo/i.test(text),
      ],
      expected: [
        1,
        true,
        true,
        true,
        false,
        `/watch/${'r'.repeat(24)}`,
        '/profile/debater-b',
        true,
        true,
        false,
        false,
      ],
    });
  });

  test('your own profile', () => {
    const view = render(
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
        shows(view, 'You'),
        view.attribute('link', 'Edit profile', 'href'),
        shows(view, 'private'),
        shows(view, 'No ruling'),
      ],
      expected: [true, '/settings#profile', true, true],
    });
  });

  test('results and opponents', () => {
    const view = render(
      profile({
        record: { wins: 0, losses: 1 },
        history: [
          entry({
            roundId: 'a'.repeat(24),
            result: 'loss',
            forfeit: true,
            opponents: [
              { kind: 'bot', label: 'Socrates', closed: false },
              { kind: 'human', label: 'gone-debater', closed: true },
            ],
          }),
          entry({
            roundId: 'b'.repeat(24),
            result: 'no-ruling',
            judges: 'mixed',
          }),
        ],
      }),
    );
    assert({
      given:
        'a forfeited loss against a bot and a closed account, and no ruling',
      should:
        'show no ruling, the forfeit, the AI opponent and the closed account by name',
      actual: [
        view.textContent().includes('No ruling'),
        shows(view, 'Lost'),
        view.textContent().includes('By forfeit'),
        view.textContent().includes('Socrates (AI)'),
        view.has('link', '@gone-debater'),
        view.textContent().includes('@gone-debater (closed)'),
        view.textContent().includes('AI and human judges'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('the public profile', () => {
    const photoId = 'f'.repeat(24);
    const view = render(
      profile({
        shown: {
          profileId: 'p'.repeat(24),
          displayName: 'Ada Byron',
          bio: 'Negative, always.',
          photoId,
        },
      }),
    );
    const handle = view
      .all('paragraph')
      .find((paragraph) => paragraph.textContent === '@debater-a');
    assert({
      given: 'a member with a display name, bio and published photo',
      should:
        'head the page with the display name, keep @username beneath it, and show the bio and the large photo',
      actual: [
        view.has('heading', 'Ada Byron', { level: 1 }),
        handle !== undefined &&
          Boolean(
            view
              .get('heading', 'Ada Byron', { level: 1 })
              .compareDocumentPosition(handle) & 4,
          ),
        handle !== undefined,
        view.textContent().includes('Negative, always.'),
        photos(view),
      ],
      expected: [
        true,
        true,
        true,
        true,
        [`/api/profile-photos/${photoId}/512`],
      ],
    });
  });

  test('reports', () => {
    const reports = h('p', null, 'REPORTS');
    const shows = (value: ProfileView) =>
      renderAccessible(
        h(ProfilePage, { profile: value, paged: false, reports }),
      )
        .textContent()
        .includes('REPORTS');
    assert({
      given: 'report controls for someone else, the owner and a closed account',
      should: 'show them only toward a live account that is not the viewer’s',
      actual: [
        shows(profile()),
        shows(profile({ me: true })),
        shows(profile({ closed: true })),
      ],
      expected: [true, false, false],
    });
  });

  test('a closed account', () => {
    const view = render(
      profile({
        closed: true,
        shown: {
          profileId: 'p'.repeat(24),
          displayName: 'Ada Byron',
          bio: 'Negative, always.',
          photoId: 'f'.repeat(24),
        },
      }),
    );
    assert({
      given: 'a closed account seen by anyone',
      should:
        'keep its username and public record, mark it closed, and show no display name, bio or photo',
      actual: [
        view.has('heading', '@debater-a', { level: 1 }),
        shows(view, 'Closed'),
        view.textContent().includes('This account is closed'),
        view.textContent().includes('Member since'),
        view.has('region', 'Record'),
        view.attribute('link', title, 'href'),
        view.textContent().includes('Ada Byron'),
        view.textContent().includes('Negative, always.'),
        photos(view),
      ],
      expected: [
        true,
        true,
        true,
        false,
        true,
        `/watch/${'r'.repeat(24)}`,
        false,
        false,
        [],
      ],
    });
  });

  test('pages', () => {
    const first = render(profile({ nextBefore: 'c'.repeat(24) })).within(
      'navigation',
      'Match history pages',
    );
    const firstPages = [
      first.attribute('link', 'Older rounds', 'href') ===
        `/profile/debater-a?before=${'c'.repeat(24)}`,
      first.textContent().includes('Newest rounds'),
    ];
    const older = render(profile({ history: [] }), true);
    const pages = older.within('navigation', 'Match history pages');
    assert({
      given: 'a first page with older Rounds, and an older page with none',
      should:
        'link to the older page, then back to the newest and say there are no older Rounds',
      actual: [
        ...firstPages,
        pages.attribute('link', 'Newest rounds', 'href') ===
          '/profile/debater-a',
        older.textContent().includes('No older rounds.'),
        pages.textContent().includes('Older rounds'),
      ],
      expected: [true, false, true, true, false],
    });
  });

  test('empty histories', () => {
    assert({
      given: 'no listed Rounds, for a visitor and for the owner',
      should: 'say there are no public Rounds, or none yet',
      actual: [
        render(profile({ history: [] }))
          .textContent()
          .includes('No public rounds yet.'),
        render(profile({ history: [], me: true }))
          .textContent()
          .includes('You have no completed rounds yet.'),
      ],
      expected: [true, true],
    });
  });

  test('someone live in a public Round', () => {
    const live = renderAccessible(
      h(ProfilePage, {
        profile: profile(),
        paged: false,
        liveRound: { href: '/watch/their-round', title: 'Friday night' },
      }),
    );
    assert({
      given: 'a member live in a public Round',
      should: 'lead to it',
      actual: live.attribute('link', 'Watch live: Friday night', 'href'),
      expected: '/watch/their-round',
    });
  });
});

describe('the Premium mark on a profile', () => {
  test('beside the name of a member who holds Premium, and nobody else', () => {
    const render = (premium: boolean) =>
      renderAccessible(
        h(ProfilePage, {
          paged: false,
          profile: profile({
            premium,
            history: [],
            nextBefore: null,
            shown: nothingShown,
          }),
        } as never),
      );
    assert({
      given: 'a profile whose member holds Premium, and one who does not',
      should: 'show an image named Premium only on the first',
      actual: [
        render(true).has('img', 'Premium'),
        render(false).has('img', 'Premium'),
      ],
      expected: [true, false],
    });
  });
});
