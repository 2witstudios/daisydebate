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
    nextSegment: { type: 'speech' },
    openSegment: {
      label: 'Constructive',
      endsAt: '2026-11-02T00:01:00.000Z',
      side: 'affirmative' as const,
      floorParticipantId: null,
    },
  };
  test('a speech shows clock, phase, names and floor, and never a judge', () => {
    const snapshot = stageSnapshot({ position, seats });
    assert({
      given: 'an open speech with a seated human judge',
      should:
        'carry the clock, the phase and both debaters with the floor marked, and no judge anywhere',
      actual: [
        snapshot.phase,
        snapshot.clock,
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
  test('private phases show a slate with no clock from the private media', () => {
    assert({
      given: 'prep, awaiting a ballot, and an unplaced state',
      should: 'report a slate kind and no floor',
      actual: [
        stageSnapshot({
          position: {
            ...position,
            openSegment: null,
            prep: { side: 'negative' },
          },
          seats,
        }).phase,
        stageSnapshot({
          position: {
            ...position,
            openSegment: null,
            stage: 'awaiting_ballot',
          },
          seats,
        }).phase,
        stageSnapshot({
          position: { ...position, openSegment: null, nextSegment: null },
          seats,
        }).seats.some((s) => s.floor),
      ],
      expected: ['prep', 'judging', false],
    });
  });
});
