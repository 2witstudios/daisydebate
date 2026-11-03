import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialPlaybackQuality,
  nextPlaybackQuality,
  playbackReport,
  type PlaybackEvent,
} from './playback-quality';

setupRitewayBun();

const run = (events: readonly PlaybackEvent[]) =>
  events.reduce(nextPlaybackQuality, initialPlaybackQuality);

describe('playback quality', () => {
  test('nothing played', () => {
    assert({
      given: 'a viewing that never reached its first frame',
      should: 'report nothing',
      actual: playbackReport(
        run([
          { type: 'requested', atMs: 0 },
          { type: 'stalled', atMs: 10 },
        ]),
        5000,
      ),
      expected: null,
    });
  });

  test('startup, rebuffering and watch time', () => {
    assert({
      given: 'a start after 800 ms, one 500 ms stall and a higher rendition',
      should: 'report each measure, closing the open stretch at the end',
      actual: playbackReport(
        run([
          { type: 'requested', atMs: 1000 },
          { type: 'playing', atMs: 1800 },
          { type: 'height', height: 480 },
          { type: 'stalled', atMs: 2800 },
          { type: 'playing', atMs: 3300 },
          { type: 'height', height: 720 },
        ]),
        4300,
      ),
      expected: {
        startup_ms: 800,
        rebuffer_ms: 500,
        watched_ms: 2000,
        height: 720,
      },
    });
  });

  test('a refused autoplay', () => {
    assert({
      given: 'autoplay refused and the viewer pressing play much later',
      should: 'measure startup from the press',
      actual: playbackReport(
        run([
          { type: 'requested', atMs: 0 },
          { type: 'requested', atMs: 30_000 },
          { type: 'playing', atMs: 30_400 },
        ]),
        30_400,
      )?.startup_ms,
      expected: 400,
    });
  });

  test('a pause is neither stall nor watching', () => {
    assert({
      given: 'a viewer pausing for a minute',
      should: 'count no stall and no watching for it',
      actual: playbackReport(
        run([
          { type: 'requested', atMs: 0 },
          { type: 'playing', atMs: 100 },
          { type: 'paused', atMs: 1100 },
        ]),
        61_100,
      ),
      expected: {
        startup_ms: 100,
        rebuffer_ms: 0,
        watched_ms: 1000,
        height: 0,
      },
    });
  });
});
