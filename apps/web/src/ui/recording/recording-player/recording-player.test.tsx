import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingMediaPanel } from '../../../features/recording/history';
import { RecordingPlayer } from './recording-player';
import {
  clockTime,
  gapCopy,
  lostGaps,
  privateGaps,
} from './recording-player-copy';

setupRitewayBun();

const media: Extract<RecordingMediaPanel, { state: 'watch' }> = {
  state: 'watch',
  playlistHref: '/api/recordings/rec/playback/master.m3u8',
  durationMs: 600_000,
  gaps: [],
  unrecorded: [],
  speeches: [],
};
const everyReason = (
  [
    'capture_restart',
    'private_phase',
    'between_speeches',
    'room_rotation',
    'not_public',
  ] as const
).map((reason, index) => ({
  startMs: index * 1000,
  endMs: index * 1000 + 500,
  reason,
}));
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
      given: 'each kind of debate lost',
      should: 'name it plainly',
      actual: [
        said({
          gaps: [{ startMs: 60_000, endMs: 65_000, reason: 'room_rotation' }],
        }).includes('1:00 to 1:05: the room changed over'),
        said({
          gaps: [{ startMs: 60_000, endMs: 70_000, reason: 'not_public' }],
        }).includes('1:00 to 1:10: not known to be public, so left out'),
      ],
      expected: [true, true],
    });
    assert({
      given: 'only the slate between speeches',
      should: 'list nothing as missing',
      actual: said({
        gaps: [
          { startMs: 60_000, endMs: 71_500, reason: 'between_speeches' },
          { startMs: 180_000, endMs: 191_500, reason: 'between_speeches' },
        ],
      }).includes('not recorded'),
      expected: false,
    });
    const prep = said({
      gaps: [
        { startMs: 0, endMs: 5000, reason: 'private_phase' },
        { startMs: 721_000, endMs: 870_000, reason: 'private_phase' },
      ],
    });
    assert({
      given: 'private phases and nothing lost',
      should: 'say they are kept private, never that they were not recorded',
      actual: [
        prep.includes('not recorded'),
        prep.includes(
          'Kept private by design, so not shown: 0:00 to 0:05, 12:01 to 14:30',
        ),
      ],
      expected: [false, true],
    });
    const both = said({
      gaps: [
        { startMs: 0, endMs: 5000, reason: 'private_phase' },
        { startMs: 60_000, endMs: 71_500, reason: 'between_speeches' },
        { startMs: 90_000, endMs: 120_000, reason: 'capture_restart' },
      ],
    });
    assert({
      given: 'a restart beside a private phase and a turnover',
      should: 'list only the restart as not recorded',
      actual: [
        both.includes('Parts of this debate were not recorded'),
        both.includes('1:30 to 2:00: recording stopped and restarted'),
        both.includes('1:00 to 1:11'),
        both.includes('Kept private by design, so not shown: 0:00 to 0:05'),
      ],
      expected: [true, true, false, true],
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
      given: 'a lost stretch',
      should: 'say it in words',
      actual: gapCopy({ startMs: 0, endMs: 1000, reason: 'capture_restart' }),
      expected: '0:00 to 0:01: recording stopped and restarted',
    });
    assert({
      given: 'every reason',
      should: 'sort each as lost, private or a slate between speeches',
      actual: [
        lostGaps(everyReason).map((gap) => gap.reason),
        privateGaps(everyReason).map((gap) => gap.reason),
      ],
      expected: [
        ['capture_restart', 'room_rotation', 'not_public'],
        ['private_phase'],
      ],
    });
  });
});
