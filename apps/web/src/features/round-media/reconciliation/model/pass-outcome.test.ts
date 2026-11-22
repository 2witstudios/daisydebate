import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialMediaPass,
  nextMediaPass,
  mediaPassCompletion,
  mediaPassReply,
  mediaPassObservation,
  initiallyCleaned,
} from './pass-outcome';
import { createMediaWorld } from '../../media-world.test-support';
setupRitewayBun();
const snapshotPass = () =>
  nextMediaPass(initialMediaPass(), {
    type: 'snapshot',
    state: createMediaWorld().snapshot(),
  });
const readPass = () =>
  nextMediaPass(snapshotPass(), {
    type: 'room-read',
    read: {
      vendor: { kind: 'absent' },
      observation: {
        kind: 'room',
        captureListed: false,
        seatsListed: false,
        speakerHeard: null,
      },
    },
  });
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
    const reconciled = nextMediaPass(readPass(), {
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
    const own = nextMediaPass(readPass(), {
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
        observations: ['room', 'unread', 'unreachable'],
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
    const held = nextMediaPass(reconciled, {
      type: 'held-result',
      result: { kind: 'succeeded' },
    });
    const closing = nextMediaPass(held, {
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
  test('unread completion events cannot certify a clean pass', () => {
    const unread = initialMediaPass();
    const occupied = nextMediaPass(unread, { type: 'occupied-call' });
    const reconciled = nextMediaPass(unread, {
      type: 'room-result',
      result: { settled: true },
    });
    assert({
      given:
        'occupied-call and acknowledged-room events before any snapshot or room read',
      should: 'ignore the invalid events and never certify cleanliness',
      actual: [occupied, reconciled].map((value) => ({
        clean: mediaPassCompletion(value).clean,
        seen: mediaPassCompletion(value).seen,
      })),
      expected: [
        { clean: false, seen: null },
        { clean: false, seen: null },
      ],
    });
  });
  test('later body events cannot erase the first pass fault', () => {
    const original = Error('original');
    const failed = nextMediaPass(initialMediaPass(), {
      type: 'pass-failed',
      error: original,
      expected: false,
    });
    const later = nextMediaPass(failed, {
      type: 'room-result',
      result: { settled: true },
    });
    const reply = mediaPassReply(later);
    assert({
      given:
        'a terminal pass fault followed by a later acknowledged room result',
      should: 'keep the original failure and unclean result',
      actual: {
        reply: reply.kind,
        original: 'error' in reply && reply.error === original,
        clean: mediaPassCompletion(later).clean,
      },
      expected: { reply: 'defer', original: true, clean: false },
    });
  });

  test('terminal faults ignore every later body event while closing proof preserves the cause', () => {
    const original = Error('first');
    const failed = nextMediaPass(snapshotPass(), {
      type: 'pass-failed',
      error: original,
      expected: false,
    });
    const events = [
      { type: 'snapshot', state: createMediaWorld().snapshot() },
      {
        type: 'room-read',
        read: { vendor: { kind: 'absent' }, observation: { kind: 'unread' } },
      },
      { type: 'cleanup-started', phase: 'initial' },
      { type: 'occupied-call' },
      { type: 'room-result', result: { settled: true } },
      { type: 'room-result', result: { lost: true } },
      { type: 'room-result', result: { refused: Error('later refusal') } },
      { type: 'held-result', result: { kind: 'succeeded' } },
      { type: 'pass-failed', error: Error('later fault'), expected: false },
      { type: 'pass-failed', error: Error('later race'), expected: true },
    ] as const;
    const ignored = events.map(
      (event) => nextMediaPass(failed, event) === failed,
    );
    const closing = nextMediaPass(failed, {
      type: 'cleanup-started',
      phase: 'closing',
    });
    const proven = nextMediaPass(closing, {
      type: 'cleanup-completed',
      proof: {
        sessionId: 'session',
        owner: 'worker',
        epoch: 1,
        mutationHorizon: 2,
      },
    });
    const reply = mediaPassReply(proven);
    assert({
      given:
        'a terminal fault followed by any body event, then successful closing cleanup',
      should:
        'ignore body results and preserve the original failure despite proven absence',
      actual: {
        ignored,
        cause: 'error' in reply && reply.error === original,
        clean: mediaPassCompletion(proven).clean,
      },
      expected: { ignored: events.map(() => true), cause: true, clean: false },
    });
  });
  test('only an occupied room read can complete the occupied-call branch', () => {
    const vendor = {
      kind: 'read',
      sid: 'room',
      empty: false,
      captureListed: false,
      answered: true,
    } as const;
    const occupied = nextMediaPass(snapshotPass(), {
      type: 'room-read',
      read: { vendor, observation: { kind: 'unread' } },
    });
    const empty = nextMediaPass(snapshotPass(), {
      type: 'room-read',
      read: {
        vendor: { ...vendor, empty: true },
        observation: { kind: 'unread' },
      },
    });
    assert({
      given: 'unread, absent, empty and actually occupied room evidence',
      should:
        'certify the vacancy-preserving result only for the occupied read',
      actual: [initialMediaPass(), readPass(), empty, occupied].map(
        (value) =>
          mediaPassCompletion(nextMediaPass(value, { type: 'occupied-call' }))
            .clean,
      ),
      expected: [false, false, false, true],
    });
  });
  test('acknowledged writes await one callback receipt and failed callbacks remain separate', () => {
    const callback = Error('callback');
    const pending = nextMediaPass(readPass(), {
      type: 'room-result',
      result: { settled: true },
    });
    const completed = nextMediaPass(pending, {
      type: 'held-result',
      result: { kind: 'failed', error: callback },
    });
    const duplicate = nextMediaPass(completed, {
      type: 'held-result',
      result: { kind: 'succeeded' },
    });
    const reply = mediaPassReply(duplicate);
    assert({
      given:
        'acknowledged writes with a pending, then failed held callback and a later duplicate receipt',
      should:
        'wait for the first callback result and retain its original error without making the writes unclean',
      actual: {
        clean: [pending, completed].map(
          (value) => mediaPassCompletion(value).clean,
        ),
        reply: reply.kind,
        original: 'error' in reply && reply.error === callback,
        unchanged: duplicate === completed,
      },
      expected: {
        clean: [false, true],
        reply: 'held-failed',
        original: true,
        unchanged: true,
      },
    });
  });
});
