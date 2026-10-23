import { assertRejects } from '@daisy/errors/testing';
import type { RoundProjection } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  adjudicationCommand,
  requireAttendanceTarget,
  requireResolutionProjection,
  type AttendanceResolution,
} from './attendance-adjudication';

setupRitewayBun();

const ruleSegments = [
  { key: 'AC', type: 'speech' },
  { key: 'CX', type: 'cross_ex' },
  { key: 'NC', type: 'speech' },
  { key: 'AR', type: 'speech' },
];
const segments = [
  { id: 'ac', type: 'speech', rulesSegmentKey: 'AC' },
  { id: 'cx', type: 'cross_ex', rulesSegmentKey: 'CX' },
  { id: 'nc', type: 'speech', rulesSegmentKey: 'NC' },
  { id: 'ar', type: 'speech', rulesSegmentKey: 'AR' },
];
const resolution = (
  overrides: Partial<AttendanceResolution> = {},
): AttendanceResolution => ({
  segmentId: 'ac',
  decision: 'attended',
  effectiveDeadline: '2026-10-22T12:00:00.000Z',
  settledHorizon: '2026-10-22T12:00:05.000Z',
  projection: null,
  ...overrides,
});
const projection = {} as RoundProjection;

test('attendance resolves the earliest unadjudicated speech before the last one', async () => {
  assert({
    given: 'no adjudicated speech, then the first speech adjudicated',
    should: 'target the first, then the next speech, skipping cross-ex',
    actual: [
      requireAttendanceTarget(
        { ruleSegments, segments, finalizedSegmentIds: [] },
        { segmentId: 'ac' },
      ).id,
      requireAttendanceTarget(
        { ruleSegments, segments, finalizedSegmentIds: ['ac'] },
        { segmentId: 'nc' },
      ).id,
    ],
    expected: ['ac', 'nc'],
  });
  for (const [label, finalizedSegmentIds, segmentId] of [
    ['an out-of-order segment', [], 'nc'],
    ['the final speech', ['ac', 'nc'], 'ar'],
    ['an already adjudicated speech', ['ac'], 'ac'],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse as an ordering invariant',
      actual: () =>
        requireAttendanceTarget(
          { ruleSegments, segments, finalizedSegmentIds },
          { segmentId },
        ),
      code: 'INVARIANT',
    });
});

test('only a forfeit or abandonment carries an engine projection', async () => {
  assert({
    given: 'a projected forfeit and abandonment and unprojected attendance',
    should: 'admit each',
    actual: [
      requireResolutionProjection(
        resolution({ decision: 'forfeit', projection }),
      ),
      requireResolutionProjection(
        resolution({ decision: 'abandoned', projection }),
      ),
      requireResolutionProjection(resolution({ decision: 'attended' })),
      requireResolutionProjection(resolution({ decision: 'none' })),
    ],
    expected: [undefined, undefined, undefined, undefined],
  });
  for (const candidate of [
    resolution({ decision: 'forfeit' }),
    resolution({ decision: 'abandoned' }),
    resolution({ decision: 'attended', projection }),
    resolution({ decision: 'none', projection }),
  ])
    await assertRejects({
      given: `a ${candidate.decision} resolution ${candidate.projection ? 'with' : 'without'} a projection`,
      should: 'refuse as a lifecycle invariant',
      actual: () => requireResolutionProjection(candidate),
      code: 'INVARIANT',
    });
});

test('the adjudication command binds Round, segment and decision', () => {
  const command = adjudicationCommand('round', 'ac', resolution());
  assert({
    given: 'the same decision with another horizon, and another decision',
    should:
      'keep the digest for the same decision and change it for another one',
    actual: {
      result: command.result,
      hex: /^[0-9a-f]{64}$/.test(command.payloadDigest),
      sameDecision:
        adjudicationCommand(
          'round',
          'ac',
          resolution({ settledHorizon: '2026-10-22T12:00:09.000Z' }),
        ).payloadDigest === command.payloadDigest,
      otherDecision:
        adjudicationCommand('round', 'ac', resolution({ decision: 'none' }))
          .payloadDigest === command.payloadDigest,
      otherSegment:
        adjudicationCommand('round', 'nc', resolution()).payloadDigest ===
        command.payloadDigest,
    },
    expected: {
      result: {
        segmentId: 'ac',
        decision: 'attended',
        effectiveDeadline: '2026-10-22T12:00:00.000Z',
        settledHorizon: '2026-10-22T12:00:05.000Z',
      },
      hex: true,
      sameDecision: true,
      otherDecision: false,
      otherSegment: false,
    },
  });
});
