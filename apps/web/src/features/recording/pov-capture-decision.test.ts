import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  decidePovCapture,
  povSeatsOf,
  type PovCaptureFacts,
} from './pov-capture-decision';

setupRitewayBun();

const capture = {
  source: { kind: 'own_capture' as const },
  startedAt: '2026-11-03T12:00:00.000Z',
  attempts: [
    { attempt: 1, egressId: 'c1', startedAt: '2026-11-03T12:00:00.000Z' },
  ],
};
const NOW = Date.parse('2026-11-03T12:10:00.000Z');
const LIVE = { kind: 'active', id: 'e1' } as const;

const facts = (over: Partial<PovCaptureFacts> = {}): PovCaptureFacts => ({
  nowMs: NOW,
  lifecycle: { status: 'capturing', capture },
  roundEnded: false,
  phase: { kind: 'public' },
  egressId: null,
  egress: { kind: 'none' },
  startedAtMs: null,
  observerSubscribed: true,
  revocationFailures: 0,
  present: true,
  ...over,
});

describe('povSeatsOf', () => {
  test('a hidden human judge is never captured, by construction', () => {
    assert({
      given: 'a human debater, a bot debater, a human judge and an AI judge',
      should: 'choose the debaters alone, with a camera only for the human',
      actual: povSeatsOf([
        { roundParticipantId: 'a', role: 'affirmative', kind: 'human' },
        { roundParticipantId: 'n', role: 'negative', kind: 'bot' },
        { roundParticipantId: 'j', role: 'judge', kind: 'human' },
        { roundParticipantId: 'k', role: 'judge', kind: 'bot' },
      ]),
      expected: [
        { roundParticipantId: 'a', camera: true },
        { roundParticipantId: 'n', camera: false },
      ],
    });
  });
});

describe('decidePovCapture', () => {
  test('starts only in public, only for someone in the room', () => {
    assert({
      given: 'public and present; public and absent; private and present',
      should: 'start only the first',
      actual: [
        decidePovCapture(facts()),
        decidePovCapture(facts({ present: false })),
        decidePovCapture(facts({ phase: { kind: 'private' } })),
      ],
      expected: [[{ type: 'start-pov' }], [], []],
    });
  });
  test('a republish needs nothing, and a departure or crash starts the next attempt', () => {
    assert({
      given:
        'a running Egress in public; a dead one, just started; a dead one, long started',
      should: 'leave the first, wait on the second, start the third',
      actual: [
        decidePovCapture(
          facts({ egressId: 'e1', egress: LIVE, startedAtMs: 0 }),
        ),
        decidePovCapture(
          facts({
            egressId: 'e1',
            egress: { kind: 'failed', id: 'e1' },
            startedAtMs: NOW - 9000,
          }),
        ),
        decidePovCapture(
          facts({
            egressId: 'e1',
            egress: { kind: 'complete' },
            startedAtMs: NOW - 10_000,
          }),
        ),
      ],
      expected: [[], [], [{ type: 'start-pov' }]],
    });
  });
  test('a private phase obeys the one privacy rule', () => {
    const running = { egressId: 'e1', egress: LIVE, startedAtMs: 0 };
    assert({
      given:
        'entering private; revoked and private; revocation failed; public again; dead in private',
      should:
        'revoke, say it again, stop, restore, and confirm with no Egress left',
      actual: [
        decidePovCapture(facts({ ...running, phase: { kind: 'private' } })),
        decidePovCapture(
          facts({
            ...running,
            phase: { kind: 'private' },
            observerSubscribed: false,
          }),
        ),
        decidePovCapture(
          facts({
            ...running,
            phase: { kind: 'private' },
            revocationFailures: 1,
          }),
        ),
        decidePovCapture(facts({ ...running, observerSubscribed: false })),
        decidePovCapture(
          facts({
            egressId: 'e1',
            egress: { kind: 'complete' },
            startedAtMs: 0,
            phase: { kind: 'private' },
          }),
        ),
      ],
      expected: [
        [{ type: 'revoke-observer' }],
        [{ type: 'reassert-revocation' }],
        [{ type: 'stop-pov', id: 'e1' }],
        [{ type: 'restore-observer' }],
        [{ type: 'revoke-observer' }],
      ],
    });
  });
  test('a dead Egress revoked in private starts fresh in public, not restored', () => {
    assert({
      given: 'a revoked POV whose Egress ended, back in public',
      should: 'start the next attempt',
      actual: decidePovCapture(
        facts({
          egressId: 'e1',
          egress: { kind: 'complete' },
          startedAtMs: 0,
          observerSubscribed: false,
        }),
      ),
      expected: [{ type: 'start-pov' }],
    });
  });
  test('the Round over, or the Recording taken down, captures nothing more', () => {
    const taken = {
      status: 'taken_down',
      takenDownAt: '2026-11-03T12:05:00.000Z',
      held: null,
    } as const;
    assert({
      given:
        'a running Egress as the Round ends; one under a takedown; none left',
      should: 'stop each, and close once nothing runs',
      actual: [
        decidePovCapture(facts({ egress: LIVE, roundEnded: true })),
        decidePovCapture(facts({ egress: LIVE, lifecycle: taken })),
        decidePovCapture(facts({ roundEnded: true })),
      ],
      expected: [
        [{ type: 'stop-pov', id: 'e1' }],
        [{ type: 'stop-pov', id: 'e1' }],
        [{ type: 'close-pov' }],
      ],
    });
  });
  test('a POV that will not stop never holds the Recording back for long', () => {
    const ended = {
      status: 'processing',
      capture: { ...capture, endedAt: '2026-11-03T12:08:00.000Z' },
    } as const;
    assert({
      given: 'an Egress still running just inside the grace, then at its end',
      should: 'keep stopping, then close as well',
      actual: [
        decidePovCapture(
          facts({ egress: LIVE, lifecycle: ended, nowMs: NOW - 1 }),
        ),
        decidePovCapture(facts({ egress: LIVE, lifecycle: ended })),
      ],
      expected: [
        [{ type: 'stop-pov', id: 'e1' }],
        [{ type: 'stop-pov', id: 'e1' }, { type: 'close-pov' }],
      ],
    });
  });
});
