import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureSessionInterrupted } from '../src/capture-session-history';
import { withBoundedRound } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

const START = Date.parse('2026-11-03T10:00:00.000Z');
const at = (ms: number) => new Date(START + ms);
const segment = {
  startedAt: at(0),
  endedAt: null,
  durationMs: 240_000,
  returnedMs: 0,
};

test('a room lost inside an incident is excused, and one outside it is not', async () => {
  const table: readonly [string, number, boolean][] = [
    ['deleted before the resume point', 19_000, true],
    ['deleted after the last confirmed audio, before detection', 22_000, false],
    ['deleted during the hold', 40_000, false],
    ['deleted after the Round resumed', 80_000, true],
  ];
  for (const [given, deletedAt, expected] of table)
    await withBoundedRound(async (fixture, run, roundId) => {
      const sessionId = createId();
      await fixture.insert('media_sessions', {
        id: sessionId,
        round_id: roundId,
        room_name: createId(),
      });
      await fixture.insert('round_incidents', {
        id: createId(),
        round_id: roundId,
        cause: 'room_retired',
        resume_point: at(20_000),
        detected_at: at(25_000),
        resumed_at: at(60_000),
      });
      await fixture.insert('media_vendor_mutations', {
        id: createId(),
        session_id: sessionId,
        epoch: 1,
        kind: 'delete',
        payload: {},
        dispatched_at: at(deletedAt),
        settled_at: at(deletedAt + 100),
        outcome: 'succeeded',
      });
      assert({
        given: `a vendor room ${given}`,
        should: expected ? 'read as interrupted' : 'be excused',
        actual: await run((tx) =>
          captureSessionInterrupted(tx as never, sessionId, segment),
        ),
        expected,
      });
    });
});

test('an incident still open excuses what happens during it', async () => {
  await withBoundedRound(async (fixture, run, roundId) => {
    const sessionId = createId();
    await fixture.insert('media_sessions', {
      id: sessionId,
      round_id: roundId,
      room_name: createId(),
    });
    await fixture.insert('round_incidents', {
      id: createId(),
      round_id: roundId,
      cause: 'vendor_unreachable',
      detected_at: at(25_000),
    });
    await fixture.insert('media_vendor_mutations', {
      id: createId(),
      session_id: sessionId,
      epoch: 1,
      kind: 'delete',
      payload: {},
      dispatched_at: at(40_000),
      settled_at: at(40_100),
      outcome: 'succeeded',
    });
    assert({
      given: 'an open incident with no resume point',
      should: 'excuse a room lost after it was detected',
      actual: await run((tx) =>
        captureSessionInterrupted(tx as never, sessionId, segment),
      ),
      expected: false,
    });
  });
});
