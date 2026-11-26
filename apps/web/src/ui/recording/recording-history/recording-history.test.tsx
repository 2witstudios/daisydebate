import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import type { RecordingHistoryScreen } from '../../../features/recording/history';
import { RecordingHistory } from './recording-history';

setupRitewayBun();

const screen: Extract<RecordingHistoryScreen, { kind: 'history' }> = {
  kind: 'history',
  roundId: 'round',
  title: 'Semifinal',
  resolution: 'Resolved: x',
  ranked: false,
  ladder: null,
  youth: false,
  date: '2026-11-02',
  visibility: 'unlisted',
  deletesOn: null,
  media: {
    state: 'watch',
    playlistHref: '/api/recordings/rec/playback/master.m3u8',
    durationMs: 60_000,
    lost: [],
    keptPrivate: [],
    unrecorded: [],
    speeches: [],
  },
  transcript: null,
  result: null,
  downloadHref: null,
  premiumOffer: null,
  removal: null,
  reportTarget: {
    targetKind: 'recording',
    targetId: 'rec',
    label: 'Report this recording',
  },
};
const noop = () => undefined;
const router = {
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
  bfcacheId: 'recording',
};
const render = (over: Partial<typeof screen> = {}) =>
  renderAccessible(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(RecordingHistory, { screen: { ...screen, ...over }, notice: null }),
    ),
  );
/**
 * The player is a `<video>`, which has no role; its Speed choice renders only
 * beside it, so the Speed combobox stands for the player.
 */
const player = (view: AccessibleView) => view.has('combobox', /^Speed/);
/** The form a control posts, for its action and its hidden fields. */
const formOf = (control: Element) => control.closest('form') as HTMLFormElement;

describe('RecordingHistory', () => {
  test('shows the player only for ready media', () => {
    assert({
      given: 'ready media',
      should: 'show the player',
      actual: player(render()),
      expected: true,
    });
    for (const [state, text] of [
      ['failed', 'could not be saved'],
      ['not_recorded', 'not recorded'],
      ['removed', 'no longer available'],
      ['withheld', 'being held back'],
    ] as const) {
      const view = render({ media: { state } });
      assert({
        given: `media ${state}`,
        should: 'state it and show no player',
        actual: [
          view
            .names('heading', { level: 2 })
            .some((heading) => heading.includes(text)),
          player(view),
        ],
        expected: [true, false],
      });
    }
  });

  test('shows each panel on its own permission', () => {
    const none = render();
    assert({
      given: 'a viewer with only the video',
      should: 'show no transcript, result, download or removal',
      actual: [
        none.has('region', 'Transcript'),
        none.has('region', 'Result'),
        none.has('link', 'Download video'),
        none.has('button', 'Remove recording'),
      ],
      expected: [false, false, false, false],
    });
  });

  test('searches the transcript on its Recording page', () => {
    const view = render({
      transcript: { q: 'opening', revision: 1, coverageNote: null, rows: [] },
    });
    const search = view.within('region', 'Transcript');
    assert({
      given: 'a viewer with transcript access and a search query',
      should: 'submit only the search query to this Recording page',
      actual: [
        search.attribute('search', 'Search the transcript', 'action'),
        search.attribute('search', 'Search the transcript', 'method'),
        search.attribute('searchbox', 'Search the transcript', 'name'),
        search.attribute('searchbox', 'Search the transcript', 'value'),
      ],
      expected: ['/recordings/round', 'get', 'q', 'opening'],
    });
  });

  test('states the limits of a download and of removal', () => {
    const view = render({
      downloadHref: '/api/recordings/rec/download',
      removal: { recordingId: 'rec', version: 4 },
    });
    const removal = formOf(view.get('button', 'Remove recording'));
    const version = removal.elements.namedItem('version') as HTMLInputElement;
    assert({
      given: 'a subscriber who is a participant',
      should: 'say a copy is beyond Daisy, and post removal with its version',
      actual: [
        view
          .within('region', 'Download')
          .textContent()
          .includes('A copy you download is outside Daisy'),
        removal.getAttribute('action'),
        removal.getAttribute('method'),
        version.value,
        removal.textContent?.includes('The whole recording'),
      ],
      expected: [true, '/api/recordings/rec/removal', 'post', '4', true],
    });
  });

  test('never calls a tie anything but what it is', () => {
    const view = render({ result: { headline: 'No winner', ballots: [] } });
    assert({
      given: 'no winner',
      should: 'not say draw',
      actual: [
        view.within('region', 'Result').textContent().includes('No winner'),
        /draw/i.test(view.textContent()),
      ],
      expected: [true, false],
    });
  });
  test('says how far a video being prepared really is', () => {
    const view = render({
      media: {
        state: 'processing',
        preparation: {
          stage: 'building',
          delayed: true,
          progress: { step: 'uploading', done: 3, total: 9 },
        },
      },
    });
    assert({
      given: 'a late build part way through saving',
      should: 'state the real figures and the delay, with no player',
      actual: [
        view.has('heading', 'The video is being prepared'),
        view.text('status').includes('Saving the video: 3 of 9 files'),
        view.textContent().includes('taking longer than it should'),
        player(view),
      ],
      expected: [true, true, true, false],
    });
  });
});

describe('RecordingHistory, a Youth Round (ADR 0161)', () => {
  const youth = () =>
    render({
      ranked: true,
      visibility: 'public',
      ladder: { style: 'freestyle', division: 'youth' },
      youth: true,
      removal: { recordingId: 'rec', version: 4 },
    });

  test('shares and reads as an Open Round does', () => {
    assert({
      given: 'a ranked Youth Round on a public Room',
      should:
        'name no ladder, say anyone can replay it, offer its link, and show no Private badge or Share publicly',
      actual: [
        youth().within('banner').textContent().includes('Youth – Freestyle'),
        youth()
          .within('region', 'Sharing')
          .textContent()
          .includes('Anyone can replay it'),
        youth().within('region', 'Sharing').textContent().includes('Copy link'),
        youth().textContent().includes('Share publicly'),
        youth().textContent().includes('Private'),
      ],
      expected: [false, true, true, false, false],
    });
  });

  test('offers Take down in place of Remove', () => {
    assert({
      given: 'a youth debater or linked adult',
      should: 'offer the takedown for everyone',
      actual: [
        formOf(youth().get('button', 'Take down')).textContent?.includes(
          'Take down this recording',
        ),
        youth().has('checkbox', 'Take it down for everyone'),
        youth().has('button', 'Remove recording'),
      ],
      expected: [true, true, false],
    });
  });
});

describe('the Recording page’s Premium offer', () => {
  test('an unrecorded casual Round offers recording under the empty video', () => {
    const view = render({
      media: { state: 'not_recorded' },
      premiumOffer: 'record',
    });
    const text = view.textContent();
    assert({
      given: 'a debater on their own casual Round that was not recorded',
      should:
        'say it was not recorded, offer Premium to record the next one, and leave a way on',
      actual: [
        text.includes('This debate was not recorded'),
        text.includes('Watch your next one back'),
        view.attribute('link', 'Get Premium', 'href'),
        view.has('button', 'Not now'),
        view.has('region', 'Download'),
      ],
      expected: [true, true, '/premium', true, false],
    });
  });

  test('a free account sees the download control, and no panel until it reaches', () => {
    const view = render({ premiumOffer: 'download' });
    assert({
      given: 'a free account that may watch a ready video',
      should:
        'show a Download video button that is not a download link, with no panel yet',
      actual: [
        view.within('region', 'Download').has('button', 'Download video'),
        view.has('link', 'Download video'),
        view.has('link', 'Get Premium'),
      ],
      expected: [true, false, false],
    });
  });

  test('a page with no offer shows no Premium prompt', () => {
    const view = render({ media: { state: 'not_recorded' } });
    assert({
      given: 'an unrecorded Round with no offer for this viewer',
      should: 'show neither a panel nor a download control',
      actual: [view.has('link', 'Get Premium'), view.has('region', 'Download')],
      expected: [false, false],
    });
  });
});
