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
  date: '2026-11-02',
  visibility: 'unlisted',
  media: {
    state: 'watch',
    playlistHref: '/api/recordings/rec/playback/master.m3u8',
    durationMs: 60_000,
    gaps: [],
    unrecorded: [],
    speeches: [],
  },
  transcript: null,
  result: null,
  downloadHref: null,
  removal: null,
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
      ['processing', 'being prepared'],
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
});
