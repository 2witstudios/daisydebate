import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  credentialHash,
  newStageCredential,
  observerAccess,
  stageCredentialValid,
  stageSnapshot,
  subscribesTo,
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

test('the stage subscribes to debaters alone, never a judge', () => {
  const debaters = ['aff', 'neg'];
  assert({
    given: 'a debater, a judge and an unknown identity',
    should: 'subscribe only to the debater',
    actual: [
      subscribesTo(debaters, 'aff'),
      subscribesTo(debaters, 'judge'),
      subscribesTo(debaters, 'someone'),
    ],
    expected: [true, false, false],
  });
});

describe('stageSnapshot', () => {
  const seats = [
    { role: 'affirmative', label: 'Ann', identity: 'aff', participantId: 'p1' },
    { role: 'negative', label: 'Ned', identity: 'neg', participantId: 'p2' },
    {
      role: 'judge',
      label: 'Secret Judge',
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
          { side: 'affirmative', label: 'Ann', floor: true },
          { side: 'negative', label: 'Ned', floor: false },
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
