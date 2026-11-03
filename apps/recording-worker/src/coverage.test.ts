import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { coverageOf, type CapturedPiece } from './coverage';

setupRitewayBun();

const piece = (
  attempt: number,
  startedAtMs: number,
  durationMs: number,
): CapturedPiece => ({
  attempt,
  path: `${attempt}.mp4`,
  startedAtMs,
  durationMs,
  hasAudio: true,
});

describe('coverageOf', () => {
  test('one attempt is the whole video, with no gap', () => {
    const only = piece(1, 5000, 60_000);
    assert({
      given: 'one attempt',
      should: 'start video time at its first frame',
      actual: coverageOf([only]),
      expected: {
        capturedFromMs: 5000,
        durationMs: 60_000,
        parts: [{ kind: 'media', piece: only }],
        gaps: [],
      },
    });
  });

  test('a restart is an explicit gap of its real length', () => {
    const first = piece(1, 0, 10_000);
    const second = piece(2, 40_000, 20_000);
    assert({
      given: 'a crash with 30 s lost, reported out of order',
      should: 'keep attempt order and state the gap in video time',
      actual: coverageOf([second, first]),
      expected: {
        capturedFromMs: 0,
        durationMs: 60_000,
        parts: [
          { kind: 'media', piece: first },
          { kind: 'gap', durationMs: 30_000 },
          { kind: 'media', piece: second },
        ],
        gaps: [{ startMs: 10_000, endMs: 40_000, reason: 'capture_restart' }],
      },
    });
  });

  test('a lost attempt leaves its stretch as part of the gap', () => {
    assert({
      given: 'attempts 1 and 3 with attempt 2 unreadable',
      should: 'cover the whole stretch between them',
      actual: coverageOf([piece(1, 0, 10_000), piece(3, 70_000, 5000)])?.gaps,
      expected: [{ startMs: 10_000, endMs: 70_000, reason: 'capture_restart' }],
    });
  });

  test('clocks that disagree never reorder or overlap the video', () => {
    assert({
      given: 'an attempt seeming to start before the last ended',
      should: 'follow it, with no gap claimed',
      actual: (() => {
        const coverage = coverageOf([
          piece(1, 0, 10_000),
          piece(2, 9000, 5000),
        ]);
        return [coverage?.durationMs, coverage?.gaps];
      })(),
      expected: [15_000, []],
    });
  });

  test('nothing captured is not a video', () => {
    assert({
      given: 'no readable attempt',
      should: 'say so',
      actual: coverageOf([]),
      expected: null,
    });
  });
});

test('a stretch a lapse touches is stated as that, and any other as a restart', () => {
  const piece = (attempt: number, startedAtMs: number) => ({
    attempt,
    path: `/${attempt}`,
    startedAtMs,
    durationMs: 10_000,
    hasAudio: true,
  });
  const reasons = coverageOf(
    [piece(1, 0), piece(1, 40_000), piece(2, 80_000)],
    [{ fromMs: 12_000, toMs: 35_000 }],
  )?.gaps.map((gap) => gap.reason);
  assert({
    given: 'two stretches missing, one holding a lapse',
    should: 'name each for what it is, in order',
    actual: reasons,
    expected: ['control_lapse', 'capture_restart'],
  });
});
