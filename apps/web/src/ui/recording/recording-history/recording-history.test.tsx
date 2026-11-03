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
  povDownloads: [],
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

  test('offers each debater apart, labels low quality and names what is missing', () => {
    const html = render({
      downloadHref: '/api/recordings/rec/download',
      povDownloads: [
        {
          state: 'ready',
          name: '@ada',
          quality: '360p',
          videoHref: '/video-href',
          audioHref: '/audio-href',
        },
        {
          state: 'ready',
          name: 'Bot',
          quality: null,
          videoHref: null,
          audioHref: '/bot-audio-href',
        },
        { state: 'missing', name: 'Negative' },
      ],
    } as never);
    assert({
      given: 'a video at 360p, a voice alone and a missing debater',
      should: 'link plainly, say why it is 360p, and state the missing one',
      actual: [
        html.includes('href="/video-href"'),
        html.includes('href="/audio-href"'),
        html.includes('href="/bot-audio-href"'),
        html.includes('360p: this device could not send more'),
        html.includes('Negative: not available for this recording'),
      ],
      expected: [true, true, true, true, true],
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
