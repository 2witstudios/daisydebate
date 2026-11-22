import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialMediaPass,
  nextMediaPass,
  mediaPassCompletion,
  mediaPassReply,
  mediaPassObservation,
  initiallyCleaned,
} from './reconcile-outcome';
import { createMediaWorld } from '../media-world.test-support';
setupRitewayBun();
describe('media pass outcome', () => {
  test('a closing fault retains the primary pass failure and its identity', () => {
    const primary = Error('initial read failed');
    const closing = Error('closing read failed');
    const failed = nextMediaPass(initialMediaPass(), {
      type: 'pass-failed',
      error: primary,
      expected: false,
    });
    const closed = nextMediaPass(failed, {
      type: 'closing-failed',
      error: closing,
    });
    const reply = mediaPassReply(closed);
    assert({
      given: 'a pass failure followed by a closing read failure',
      should:
        'defer using the original error rather than replace it or mark the pass clean',
      actual: {
        kind: reply.kind,
        original: 'error' in reply && reply.error === primary,
        clean: mediaPassCompletion(closed).clean,
      },
      expected: { kind: 'defer', original: true, clean: false },
    });
  });
  test('an unacknowledged reconciliation keeps its callback failure separate from infrastructure', () => {
    const callback = Error('token issue failed');
    const reconciled = nextMediaPass(initialMediaPass(), {
      type: 'room-result',
      result: { settled: false },
    });
    const held = nextMediaPass(reconciled, {
      type: 'held-result',
      result: { kind: 'failed', error: callback },
    });
    const reply = mediaPassReply(held);
    assert({
      given: 'settled=false and the callback executed under the lease failed',
      should:
        'finish unclean and throw the callback error without classifying it as a pass fault',
      actual: {
        kind: reply.kind,
        original: 'error' in reply && reply.error === callback,
        clean: mediaPassCompletion(held).clean,
      },
      expected: { kind: 'held-failed', original: true, clean: false },
    });
  });
  test('own refusal, infrastructure race and unread fault carry distinct caller and incident meaning', () => {
    const world = createMediaWorld();
    const seeded = nextMediaPass(initialMediaPass(), {
      type: 'snapshot',
      state: world.snapshot(),
    });
    const error = Error('refused');
    const own = nextMediaPass(seeded, {
      type: 'room-result',
      result: { refused: error },
    });
    const raced = nextMediaPass(seeded, {
      type: 'pass-failed',
      error,
      expected: true,
    });
    const failed = nextMediaPass(seeded, {
      type: 'pass-failed',
      error,
      expected: false,
    });
    const ownReply = mediaPassReply(own);
    assert({
      given:
        'an admission refusal versus another operation’s expected race and a real unread fault',
      should:
        'return only the caller’s own cause and report unreachable only for the fault',
      actual: {
        own: ownReply.kind === 'return' && ownReply.refusal === error,
        raced: mediaPassReply(raced).kind,
        observations: [own, raced, failed].map(
          (state) => mediaPassObservation(state)?.observation.kind,
        ),
      },
      expected: {
        own: true,
        raced: 'return',
        observations: ['unread', 'unread', 'unreachable'],
      },
    });
  });
  test('absence proof changes cleanliness without erasing initial cleanup history or room evidence', () => {
    const world = createMediaWorld();
    const proof = {
      sessionId: world.sessionId,
      owner: 'worker',
      epoch: 1,
      mutationHorizon: 2,
    };
    let state = nextMediaPass(initialMediaPass(), {
      type: 'snapshot',
      state: world.snapshot(),
    });
    state = nextMediaPass(state, {
      type: 'room-read',
      read: { vendor: { kind: 'absent' }, observation: { kind: 'unread' } },
    });
    const started = nextMediaPass(state, {
      type: 'cleanup-started',
      phase: 'initial',
    });
    const proven = nextMediaPass(started, { type: 'cleanup-completed', proof });
    const fault = nextMediaPass(started, {
      type: 'pass-failed',
      error: Error('delete failed'),
      expected: false,
    });
    assert({
      given:
        'initial cleanup before and after verified absence, then an initial cleanup fault',
      should:
        'derive clean only from proof and retain the initial-attempt distinction',
      actual: {
        clean: [started, proven, fault].map(
          (value) => mediaPassCompletion(value).clean,
        ),
        proof: mediaPassCompletion(proven).absenceProof === proof,
        initial: initiallyCleaned(fault),
        observation: mediaPassObservation(fault)?.observation.kind,
        seen: mediaPassCompletion(proven).seen,
      },
      expected: {
        clean: [false, true, false],
        proof: true,
        initial: true,
        observation: 'unread',
        seen: { kind: 'absent' },
      },
    });
    const reconciled = nextMediaPass(state, {
      type: 'room-result',
      result: { settled: true },
    });
    const closing = nextMediaPass(reconciled, {
      type: 'cleanup-started',
      phase: 'closing',
    });
    const closed = nextMediaPass(closing, { type: 'cleanup-completed', proof });
    assert({
      given:
        'a previously clean pass whose closing uncertainty cleanup has no proof yet',
      should:
        'stay unclean until absence is proven, without inventing an initial cleanup attempt',
      actual: [
        mediaPassCompletion(closing).clean,
        mediaPassCompletion(closed).clean,
        initiallyCleaned(closed),
      ],
      expected: [false, true, false],
    });
  });
});
