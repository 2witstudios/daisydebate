import { assert, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpointFor, twoSides } from '@daisy/protocol';
import { roundIncidentNotice } from './notice';
setupRitewayBun();

const since = '2026-11-03T10:00:00.000Z';
const fields = {
  since,
  cause: 'room_retired',
  resume_point: null,
} as const;
const HELD =
  "Daisy's media server failed. Your time is safe. Resuming when everyone is back.";
const until = Date.parse('2026-11-03T10:00:30.000Z');
const resuming = {
  ...emptyRuntimeCheckpointFor({ sides: twoSides }),
  incident: {
    ...fields,
    phase: 'resuming',
    until: new Date(until).toISOString(),
  },
} as const;

test('what a held Round says', () => {
  const table: readonly [string, unknown, unknown][] = [
    ['an unreadable checkpoint', roundIncidentNotice(null, 0), null],
    [
      'no incident',
      roundIncidentNotice(emptyRuntimeCheckpointFor({ sides: twoSides }), 0),
      null,
    ],
    [
      'a pause',
      roundIncidentNotice(
        {
          ...emptyRuntimeCheckpointFor({ sides: twoSides }),
          incident: { ...fields, phase: 'paused' },
        },
        until,
      ),
      { held: HELD, resumesInSeconds: null },
    ],
    [
      'the countdown, part of a second in',
      roundIncidentNotice(resuming, until - 4_200),
      { held: HELD, resumesInSeconds: 5 },
    ],
    [
      'the countdown over, before the server has said so',
      roundIncidentNotice(resuming, until),
      null,
    ],
  ];
  for (const [given, actual, expected] of table)
    assert({
      given,
      should: 'say only what is true now',
      actual,
      expected,
    });
});
