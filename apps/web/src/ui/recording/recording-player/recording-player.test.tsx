import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingMediaPanel } from '../../../features/recording/history';
import { RecordingPlayer } from './recording-player';
import { clockTime, gapCopy } from './recording-player-copy';

setupRitewayBun();

const media: Extract<RecordingMediaPanel, { state: 'watch' }> = {
  state: 'watch',
  playlistHref: '/api/recordings/rec/playback/master.m3u8',
  durationMs: 600_000,
  gaps: [],
  unrecorded: [],
  speeches: [],
};
const render = (over: Partial<typeof media> = {}) =>
  renderToString(h(RecordingPlayer, { media: { ...media, ...over } }));

describe('RecordingPlayer', () => {
  test('is the one player, labelled, with native controls and a speed choice', () => {
    const html = render();
    assert({
      given: 'a Recording',
      should: 'offer the browser controls, a label and speed',
      actual: [
        html.includes('controls'),
        html.includes('playsInline') || html.includes('playsinline'),
        html.includes('aria-label="Recording of this debate"'),
        html.includes('Speed'),
        html.includes('2x'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('states what the video does not hold', () => {
    assert({
      given: 'no gap',
      should: 'not raise the question',
      actual: render().includes('not recorded'),
      expected: false,
    });
    assert({
      given: 'a capture restart',
      should: 'name when and why',
      actual: render({
        gaps: [{ startMs: 60_000, endMs: 90_000, reason: 'capture_restart' }],
      }).includes('1:00 to 1:30: recording stopped and restarted'),
      expected: true,
    });
    const said = (over: Parameters<typeof render>[0]) =>
      render(over).replaceAll('&#x27;', "'");
    assert({
      given: 'each kind of stretch the video shows as something else',
      should: 'name it plainly',
      actual: [
        said({
          gaps: [{ startMs: 0, endMs: 5000, reason: 'private_phase' }],
        }).includes('0:00 to 0:05: a private part of the debate'),
        said({
          gaps: [{ startMs: 60_000, endMs: 65_000, reason: 'room_rotation' }],
        }).includes('1:00 to 1:05: the room changed over'),
      ],
      expected: [true, true],
    });
    assert({
      given: 'debate before and after the video',
      should: 'say how much is missing and why, with no gap in sight',
      actual: [
        said({
          unrecorded: [
            { part: 'start', durationMs: 30_000, reason: 'late_start' },
          ],
        }).includes(
          'The first 0:30 of the debate is not in this video: recording started late',
        ),
        said({
          unrecorded: [
            { part: 'end', durationMs: 90_000, reason: 'ended_early' },
          ],
        }).includes(
          'The last 1:30 of the debate is not in this video: recording ended early',
        ),
        said({
          unrecorded: [
            { part: 'end', durationMs: 60_000, reason: 'broadcast_stopped' },
          ],
        }).includes(
          'The last 1:00 of the debate is not in this video: the broadcast was stopped',
        ),
      ],
      expected: [true, true, true],
    });
  });
  test('lists the speech timeline as controls that seek', () => {
    const html = render({
      speeches: [{ speaker: 'Avery', startMs: 15_000, endMs: 75_000 }],
    });
    assert({
      given: 'one speech',
      should: 'render a labelled timeline with a real button',
      actual: [
        html.includes('aria-label="Speech timeline"'),
        html.includes('<button'),
        html.includes('Avery'),
        html.includes('0:15 to 1:15'),
      ],
      expected: [true, true, true, true],
    });
  });
});

describe('copy', () => {
  test('reads time as a person would', () => {
    assert({
      given: 'times under and over an hour',
      should: 'format each',
      actual: [clockTime(5000), clockTime(3_725_000)],
      expected: ['0:05', '1:02:05'],
    });
    assert({
      given: 'each reason',
      should: 'say it in words',
      actual: gapCopy({ startMs: 0, endMs: 1000, reason: 'private_phase' }),
      expected: '0:00 to 0:01: a private part of the debate',
    });
  });
});
