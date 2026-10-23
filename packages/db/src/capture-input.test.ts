import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureClipSchema,
  captureReadSchema,
  parseCapture,
} from './capture-input';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const identity = {
  roundId: id('a'),
  sessionId: id('b'),
  workerId: id('c'),
  epoch: 1,
};
const clip = {
  ...identity,
  segmentId: id('d'),
  roundParticipantId: id('e'),
  trackId: 'track',
  startOffsetMs: 0,
  durationMs: 100,
  text: 'Spoken words',
  before: '2026-10-22T12:00:00.000Z',
  after: '2026-10-22T12:00:00.200Z',
};

test('a paged capture read names its segment and version with any cursor', async () => {
  assert({
    given: 'an unpaged read and a cursor with its segment and version',
    should: 'parse both',
    actual: [
      parseCapture(captureReadSchema, identity),
      parseCapture(captureReadSchema, {
        ...identity,
        segmentId: id('d'),
        expectedVersion: 0,
        afterIntervalId: id('f'),
      }).afterIntervalId,
    ],
    expected: [identity, id('f')],
  });
  await assertRejects({
    given: 'a cursor without the version it pages',
    should: 'refuse as invalid capture input',
    actual: () =>
      parseCapture(captureReadSchema, {
        ...identity,
        segmentId: id('d'),
        afterIntervalId: id('f'),
      }),
    code: 'VALIDATION',
  });
});

test('a clip needs visible text, a bounded duration and no extra fields', async () => {
  assert({
    given: 'a well-formed clip',
    should: 'parse it unchanged',
    actual: parseCapture(captureClipSchema, clip),
    expected: clip,
  });
  for (const [label, raw] of [
    ['whitespace-only text', { ...clip, text: '   ' }],
    ['a zero duration', { ...clip, durationMs: 0 }],
    [
      'a second-precision timestamp',
      { ...clip, before: '2026-10-22T12:00:00Z' },
    ],
    ['an undeclared field', { ...clip, speaker: 'host' }],
    ['an epoch beyond int32', { ...clip, epoch: 2 ** 31 }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse as invalid capture input',
      actual: () => parseCapture(captureClipSchema, raw),
      code: 'VALIDATION',
    });
});
