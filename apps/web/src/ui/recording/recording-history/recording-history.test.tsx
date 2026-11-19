import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
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
  youth: null,
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
  removal: null,
  reportTarget: {
    targetKind: 'recording',
    targetId: 'rec',
    label: 'Report this recording',
  },
};
const render = (over: Partial<typeof screen> = {}) =>
  renderToString(
    h(RecordingHistory, { screen: { ...screen, ...over }, notice: null }),
  );

describe('RecordingHistory', () => {
  test('shows the player only for ready media', () => {
    assert({
      given: 'ready media',
      should: 'show the player',
      actual: render().includes('<video'),
      expected: true,
    });
    for (const [state, text] of [
      ['failed', 'could not be saved'],
      ['not_recorded', 'not recorded'],
      ['removed', 'no longer available'],
      ['withheld', 'being held back'],
    ] as const) {
      const html = render({ media: { state } });
      assert({
        given: `media ${state}`,
        should: 'state it and show no player',
        actual: [html.includes(text), html.includes('<video')],
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
        'Transcript',
        'Result',
        'Download video',
        'Remove recording',
      ].map((text) => none.includes(text)),
      expected: [false, false, false, false],
    });
  });

  test('states the limits of a download and of removal', () => {
    const html = render({
      downloadHref: '/api/recordings/rec/download',
      removal: { recordingId: 'rec', version: 4 },
    });
    assert({
      given: 'a subscriber who is a participant',
      should: 'say a copy is beyond Daisy, and post removal with its version',
      actual: [
        html.includes('A copy you download is outside Daisy'),
        html.includes('action="/api/recordings/rec/removal"'),
        html.includes('name="version" value="4"'),
        html.includes('The whole recording'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('never calls a tie anything but what it is', () => {
    const html = render({ result: { headline: 'No winner', ballots: [] } });
    assert({
      given: 'no winner',
      should: 'not say draw',
      actual: [html.includes('No winner'), /draw/i.test(html)],
      expected: [true, false],
    });
  });
  test('says how far a video being prepared really is', () => {
    const html = render({
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
        html.includes('being prepared'),
        html.includes('Saving the video: 3 of 9 files'),
        html.includes('taking longer than it should'),
        html.includes('<video'),
      ],
      expected: [true, true, true, false],
    });
  });
});

describe('RecordingHistory, a Youth Round (PYL-5)', () => {
  const youth = render({
    ranked: true,
    visibility: 'public',
    ladder: { style: 'freestyle', division: 'youth' },
    youth: {
      debaters: [
        { actorId: 'maya', name: '@maya', released: true },
        { actorId: 'jules', name: '@jules', released: false },
      ],
      releasesComplete: false,
      public: false,
      viewerDebated: true,
      shareable: true,
      videoForOfficials: false,
    },
    removal: { recordingId: 'rec', version: 4 },
  });

  test('is private, with no link to copy', () => {
    assert({
      given: 'a Youth Round on a public Room',
      should: 'name no ladder, say it is private, and offer no copy link',
      actual: [
        !/<header[\s\S]*?Youth – Freestyle[\s\S]*?<\/header>/.test(youth),
        youth.includes(
          'visible to the debaters, judges and their coaches or parents',
        ),
        youth.includes('Copy link'),
        youth.includes('Anyone can replay it'),
      ],
      expected: [true, true, false, false],
    });
  });

  test('names the missing release and keeps Share publicly closed', () => {
    assert({
      given: 'one youth debater without a release',
      should: 'name them and disable Share publicly',
      actual: [
        youth.includes('@jules has no media release yet.'),
        /<button(?=[^>]*\sdisabled="")[^>]*>(?:(?!<\/button>).)*Share publicly<\/button>/s.test(
          youth,
        ),
      ],
      expected: [true, true],
    });
  });

  test('offers Take down in place of Remove', () => {
    assert({
      given: 'a youth debater or linked adult',
      should: 'offer the takedown for everyone',
      actual: [
        youth.includes('Take down this recording'),
        youth.includes('Take it down for everyone'),
        youth.includes('Remove recording'),
      ],
      expected: [true, true, false],
    });
  });

  test('with every release, still waits for the publishing flag', () => {
    const released = renderToString(
      h(RecordingHistory, {
        screen: {
          ...screen,
          ranked: true,
          youth: {
            debaters: [{ actorId: 'maya', name: '@maya', released: true }],
            releasesComplete: true,
            public: false,
            viewerDebated: true,
            shareable: true,
            videoForOfficials: false,
          },
        },
        notice: null,
      }),
    );
    assert({
      given: 'every youth debater released, the flag closed',
      should: 'say sharing is not open yet',
      actual: released.includes('Sharing Youth recordings is not open yet.'),
      expected: true,
    });
  });

  const shared = (youth: {
    readonly releasesComplete: boolean;
    readonly public: boolean;
    readonly viewerDebated: boolean;
    readonly shareable?: boolean;
    readonly videoForOfficials?: boolean;
  }) =>
    renderToString(
      h(RecordingHistory, {
        screen: {
          ...screen,
          ranked: true,
          youth: {
            debaters: [{ actorId: 'maya', name: '@maya', released: true }],
            shareable: true,
            videoForOfficials: false,
            ...youth,
          },
        },
        notice: null,
        youthPublishing: true,
        share: async () => {},
      }),
    );

  test('with every release and publishing open (ADR 0151)', () => {
    assert({
      given: 'a debater of the Round',
      should: 'offer Share publicly as a form',
      actual: /<form[^>]*>.*Share publicly/s.test(
        shared({ releasesComplete: true, public: false, viewerDebated: true }),
      ),
      expected: true,
    });
    assert({
      given: 'a linked adult who did not debate',
      should: 'leave Share publicly disabled and say who can share',
      actual: shared({
        releasesComplete: true,
        public: false,
        viewerDebated: false,
      }).includes('A debater in this Round can share it.'),
      expected: true,
    });
    assert({
      given:
        'a casual Youth Round that is not public, or not recorded for everyone (ADR 0157)',
      should: 'keep Share publicly closed and say why',
      actual: (() => {
        const page = shared({
          releasesComplete: true,
          public: false,
          viewerDebated: true,
          shareable: false,
        });
        return [
          page.includes(
            'Only a public Round recorded for everyone can be shared.',
          ),
          /<form[^>]*>.*Share publicly/s.test(page),
        ];
      })(),
      expected: [true, false],
    });
    assert({
      given: 'a casual Youth Round whose host kept the video for its judges',
      should: 'say only the judges watch it, not that its debaters can',
      actual: (() => {
        const page = shared({
          releasesComplete: true,
          public: false,
          viewerDebated: true,
          shareable: false,
          videoForOfficials: true,
        });
        return [
          page.includes(
            'the video is for the judges and moderators until it is deleted',
          ),
          page.includes('visible to the debaters, judges'),
        ];
      })(),
      expected: [true, false],
    });
    assert({
      given: 'a Recording already shared',
      should: 'say it is public on Watch',
      actual: shared({
        releasesComplete: true,
        public: true,
        viewerDebated: true,
      }).includes('on Watch. It comes'),
      expected: true,
    });
  });
});
