import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingMediaPanel } from '../features/recording/history';
import { renderMarkup } from '../test-support/rendered/markup';
import { RecordingPlayer } from '../ui/recording/recording-player/recording-player';

setupRitewayBun();

const media: Extract<RecordingMediaPanel, { state: 'watch' }> = {
  state: 'watch',
  playlistHref: '/api/recordings/rec/playback/master.m3u8',
  durationMs: 600_000,
  lost: [],
  keptPrivate: [],
  unrecorded: [],
  speeches: [],
};

/**
 * The player is a native `<video>`, which has no ARIA role, so its label and
 * its browser controls cannot be asked for by role and name.
 */
describe('RecordingPlayer markup', () => {
  test('is the one player, labelled, with native controls', () => {
    const html = renderMarkup(h(RecordingPlayer, { media }));
    const video = html.match(/<video [^>]*>/)?.[0] ?? '';
    assert({
      given: 'a Recording',
      should: 'offer the browser controls, inline playback and a label',
      actual: [
        /\scontrols(?:=""|\s|>)/.test(video),
        /\splaysinline(?:=""|\s|>)/i.test(video),
        video.includes('aria-label="Recording of this debate"'),
      ],
      expected: [true, true, true],
    });
  });
});
