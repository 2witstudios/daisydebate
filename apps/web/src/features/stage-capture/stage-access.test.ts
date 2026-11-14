import { twoSides } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  credentialHash,
  newStageCredential,
  observerAccess,
  stageCredentialValid,
  stageSnapshot,
} from './stage-access';

setupRitewayBun();

describe('stage credential', () => {
  test('only the minted secret opens the stage, and only its hash is stored', () => {
    const minted = newStageCredential(() => new Uint8Array(32).fill(7));
    assert({
      given: 'a minted credential',
      should:
        'store a SHA3-256 hash, accept the secret, and refuse anything else or no stored hash',
      actual: [
        minted.hash === minted.secret,
        minted.hash === credentialHash(minted.secret),
        minted.hash.length,
        stageCredentialValid(minted.secret, minted.hash),
        stageCredentialValid('wrong', minted.hash),
        stageCredentialValid(null, minted.hash),
        stageCredentialValid(minted.secret, null),
      ],
      expected: [false, true, 64, true, false, false, false],
    });
  });
});

test('observerAccess follows revocation, so a reconnect cannot bypass it', () => {
  assert({
    given: 'a Broadcast with the observer revoked, and one not',
    should: 'mint no subscribe for the revoked one',
    actual: [
      observerAccess({ observerRevokedAt: new Date(1) }),
      observerAccess({ observerRevokedAt: null }),
    ],
    expected: [{ canSubscribe: false }, { canSubscribe: true }],
  });
});

const seating = {
  sides: twoSides,
  seats: {
    sides: { affirmative: 1, negative: 1 },
    speakers: 0,
    judges: 1,
    moderators: 0,
  },
};

describe('stageSnapshot', () => {
  const seats = [
    {
      seat: { kind: 'side', side: 'negative', slot: 0 } as const,
      label: 'Ned',
      kind: 'bot' as const,
      identity: 'neg',
      participantId: 'p2',
    },
    {
      seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
      label: 'Ann',
      kind: 'human' as const,
      identity: 'aff',
      participantId: 'p1',
    },
    {
      seat: { kind: 'judge', slot: 0 } as const,
      label: 'Secret Judge',
      kind: 'human' as const,
      identity: 'j',
      participantId: 'p3',
    },
  ];
  const position = {
    status: 'active' as const,
    stage: null,
    prep: null,
    nextSegment: { type: 'speech', label: 'Rebuttal' },
    countdownRemainingMs: null,
    incident: { phase: 'none' },
    openSegment: {
      label: 'Constructive',
      endsAt: '2026-11-02T00:01:00.000Z',
      lead: { kind: 'side', side: 'affirmative', slot: 0 } as const,
      floorParticipantId: null,
    },
  };
  test('a speech shows clock, phase, names and floor, and never a judge', () => {
    const snapshot = stageSnapshot({ position, seating, seats });
    assert({
      given: 'an open speech with a seated human judge',
      should:
        'carry the clock, the phase and both debaters with the floor marked, and no judge anywhere',
      actual: [
        snapshot.phase,
        snapshot.phase === 'speech' && snapshot.clock,
        snapshot.seats,
        snapshot.debaterIdentities,
        JSON.stringify(snapshot).includes('Secret Judge'),
      ],
      expected: [
        'speech',
        { label: 'Constructive', endsAt: '2026-11-02T00:01:00.000Z' },
        [
          {
            column: 'affirmative',
            columnLabel: 'Affirmative',
            label: 'Ann',
            kind: 'human',
            identity: 'aff',
            floor: true,
          },
          {
            column: 'negative',
            columnLabel: 'Negative',
            label: 'Ned',
            kind: 'bot',
            identity: 'neg',
            floor: false,
          },
        ],
        ['aff', 'neg'],
        false,
      ],
    });
  });
  test('each wait carries only what it can show', () => {
    const waiting = { ...position, openSegment: null };
    const view = (
      changed: Partial<Parameters<typeof stageSnapshot>[0]['position']>,
    ) => {
      const snapshot = stageSnapshot({
        position: { ...waiting, ...changed },
        seating,
        seats,
      });
      return {
        phase: snapshot.phase,
        remainingMs:
          'remainingMs' in snapshot ? snapshot.remainingMs : undefined,
        next: 'next' in snapshot ? snapshot.next : undefined,
      };
    };
    const prep = { side: 'negative', remainingMs: 90_000 };
    const none = { remainingMs: undefined, next: undefined };
    const next = { label: 'Rebuttal' };
    assert({
      given:
        'prep, a countdown, a ballot awaited, no round yet and a round that is over; then prep spent, prep and a countdown under an incident, and a start held at zero',
      should:
        'carry what is left of a running wait, name the next speech, tell a round that is over from one not begun, and give a stopped or spent wait nothing to count',
      actual: [
        view({ prep }),
        view({ countdownRemainingMs: 5_000 }),
        view({ stage: 'awaiting_ballot' }),
        view({ status: 'opening' }),
        view({ status: 'completed', nextSegment: null }),
        view({ status: 'abandoned', prep }),
        view({ prep: { ...prep, remainingMs: 0 } }),
        view({ prep, incident: { phase: 'paused' } }),
        view({ countdownRemainingMs: 5_000, incident: { phase: 'resuming' } }),
        view({ countdownRemainingMs: 0 }),
      ],
      expected: [
        { phase: 'prep', remainingMs: 90_000, next: undefined },
        { phase: 'between', remainingMs: 5_000, next },
        { phase: 'judging', ...none },
        { phase: 'slate', ...none },
        { phase: 'ended', ...none },
        { phase: 'ended', ...none },
        { phase: 'prep', remainingMs: null, next: undefined },
        { phase: 'prep', remainingMs: null, next: undefined },
        { phase: 'between', remainingMs: null, next },
        { phase: 'between', remainingMs: null, next },
      ],
    });
  });
  test('no wait gives anyone the floor', () => {
    assert({
      given: 'no open speech',
      should: 'mark no seat as speaking',
      actual: stageSnapshot({
        position: { ...position, openSegment: null, nextSegment: null },
        seating,
        seats,
      }).seats.some((s) => s.floor),
      expected: false,
    });
  });
});

describe('stageSnapshot for an unsided format (TAB-6.17)', () => {
  test('each speaker is a column of their own, by seat', () => {
    const unsided = {
      sides: [],
      seats: { sides: {}, speakers: 2, judges: 0, moderators: 0 },
    };
    const snapshot = stageSnapshot({
      position: {
        status: 'active',
        stage: null,
        prep: null,
        nextSegment: null,
        countdownRemainingMs: null,
        incident: { phase: 'none' },
        openSegment: {
          label: 'Opening',
          endsAt: '2026-11-02T00:01:00.000Z',
          lead: { kind: 'speaker', slot: 1 },
          floorParticipantId: null,
        },
      },
      seating: unsided,
      seats: [1, 0].map((slot) => ({
        seat: { kind: 'speaker', slot } as const,
        label: `S${slot}`,
        kind: 'human' as const,
        identity: `s${slot}`,
        participantId: `p${slot}`,
      })),
    });
    assert({
      given: 'two speakers read out of order, the second holding the floor',
      should:
        'order them by seat, name each column by its seat, and mark the lead',
      actual: snapshot.seats.map((seat) => [
        seat.column,
        seat.columnLabel,
        seat.floor,
      ]),
      expected: [
        ['speaker:0', 'Speaker 1', false],
        ['speaker:1', 'Speaker 2', true],
      ],
    });
  });
});
