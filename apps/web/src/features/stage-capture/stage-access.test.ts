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

describe('stageSnapshot', () => {
  const nowMs = Date.parse('2026-11-02T00:00:00.000Z');
  const seats = [
    {
      role: 'negative',
      label: 'Ned',
      kind: 'bot' as const,
      identity: 'neg',
      participantId: 'p2',
    },
    {
      role: 'affirmative',
      label: 'Ann',
      kind: 'human' as const,
      identity: 'aff',
      participantId: 'p1',
    },
    {
      role: 'judge',
      label: 'Secret Judge',
      kind: 'human' as const,
      identity: 'j',
      participantId: 'p3',
    },
  ];
  const position = {
    status: 'active',
    stage: null,
    prep: null,
    nextSegment: { type: 'speech', label: 'Rebuttal' },
    countdownRemainingMs: null,
    openSegment: {
      label: 'Constructive',
      endsAt: '2026-11-02T00:01:00.000Z',
      side: 'affirmative' as const,
      floorParticipantId: null,
    },
  };
  test('a speech shows clock, phase, names and floor, and never a judge', () => {
    const snapshot = stageSnapshot({ position, seats, nowMs });
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
            side: 'affirmative',
            label: 'Ann',
            kind: 'human',
            identity: 'aff',
            floor: true,
          },
          {
            side: 'negative',
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
        seats,
        nowMs,
      });
      return {
        phase: snapshot.phase,
        endsAt: 'endsAt' in snapshot ? snapshot.endsAt : undefined,
        next: 'next' in snapshot ? snapshot.next : undefined,
      };
    };
    assert({
      given:
        'prep, a ballot awaited, a countdown, a held floor change and no round',
      should:
        'end prep and the countdown at the answer’s instant plus what is left, name the next speech, and give judging and the slate nothing',
      actual: [
        view({ prep: { side: 'negative', remainingMs: 90_000 } }),
        view({ stage: 'awaiting_ballot' }),
        view({ countdownRemainingMs: 5_000 }),
        view({}),
        view({ nextSegment: null }),
      ],
      expected: [
        {
          phase: 'prep',
          endsAt: '2026-11-02T00:01:30.000Z',
          next: undefined,
        },
        { phase: 'judging', endsAt: undefined, next: undefined },
        {
          phase: 'between',
          endsAt: '2026-11-02T00:00:05.000Z',
          next: { label: 'Rebuttal' },
        },
        { phase: 'between', endsAt: null, next: { label: 'Rebuttal' } },
        { phase: 'slate', endsAt: undefined, next: undefined },
      ],
    });
  });
  test('no wait gives anyone the floor', () => {
    assert({
      given: 'no open speech',
      should: 'mark no seat as speaking',
      actual: stageSnapshot({
        position: { ...position, openSegment: null, nextSegment: null },
        seats,
        nowMs,
      }).seats.some((s) => s.floor),
      expected: false,
    });
  });
});
