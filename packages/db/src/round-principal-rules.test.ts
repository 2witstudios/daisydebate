import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  requireClaimScope,
  requireRunScope,
  type BotPublicationScope,
} from './bot-publication-context';
import {
  mediaId,
  mediaWindowClosed,
  requireMediaWindow,
} from './media-session-authority';
import {
  requireHumanRoundPrincipal,
  roundPrincipalColumns,
} from './round-write-authority';

setupRitewayBun();

const scope: BotPublicationScope = {
  roundId: 'roundaaaa1b2c3d4e5f6g7h8',
  roundParticipantId: 'seataaaaa1b2c3d4e5f6g7h8',
  segmentId: 'segmentaa1b2c3d4e5f6g7h8',
  agentRunId: 'runaaaaaa1b2c3d4e5f6g7h8',
  serviceId: 'agent-run:runaaaaaa1b2c3d4e5f6g7h8',
  publicationEpoch: 3,
};
type Claim = Parameters<typeof requireClaimScope>[0];
type Run = Parameters<typeof requireRunScope>[0];
const claim = (overrides: Record<string, unknown> = {}) =>
  ({
    publicationEpoch: 3,
    agentRunId: scope.agentRunId,
    segmentId: scope.segmentId,
    ...overrides,
  }) as unknown as Claim;
const run = (overrides: Record<string, unknown> = {}) =>
  ({
    endedAt: null,
    kind: 'speech',
    configurationSnapshot: {
      roundId: scope.roundId,
      roundParticipantId: scope.roundParticipantId,
      segmentId: scope.segmentId,
      serviceId: scope.serviceId,
      publicationEpoch: 3,
    },
    ...overrides,
  }) as unknown as Run;

test('a publication claim holds only for its exact epoch, run and segment', async () => {
  assert({
    given: 'the current claim for this scope',
    should: 'admit it',
    actual: requireClaimScope(claim(), scope),
    expected: undefined,
  });
  for (const [label, candidate] of [
    ['no claim', undefined],
    ['an older epoch', claim({ publicationEpoch: 2 })],
    ['another run', claim({ agentRunId: 'otherrun1b2c3d4e5f6g7h8' })],
    ['another segment', claim({ segmentId: 'othersegm1b2c3d4e5f6g7h8' })],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the publication as a conflict',
      actual: () => requireClaimScope(candidate, scope),
      code: 'CONFLICT',
    });
});

test('a publishing run must be a live speech or cross-ex run for this exact scope', async () => {
  assert({
    given:
      'a live speech run and a live cross-ex run configured for this scope',
    should: 'admit both',
    actual: [
      requireRunScope(run(), scope),
      requireRunScope(run({ kind: 'cross_ex' }), scope),
    ],
    expected: [undefined, undefined],
  });
  const snapshot = run()!.configurationSnapshot;
  for (const [label, candidate] of [
    ['no run', undefined],
    ['an ended run', run({ endedAt: new Date(0) })],
    ['a judging run', run({ kind: 'judging' })],
    [
      'another service',
      run({ configurationSnapshot: { ...snapshot, serviceId: 'agent-run:x' } }),
    ],
    [
      'another epoch',
      run({ configurationSnapshot: { ...snapshot, publicationEpoch: 4 } }),
    ],
    [
      'another seat',
      run({
        configurationSnapshot: { ...snapshot, roundParticipantId: 'other' },
      }),
    ],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse publication authority',
      actual: () => requireRunScope(candidate, scope),
      code: 'AUTHORIZATION',
    });
});

test('a Round command stores exactly one principal column', () => {
  assert({
    given: 'a human and an agent principal',
    should: 'store the actor for the human and the service for the agent',
    actual: [
      roundPrincipalColumns({ kind: 'human', actorId: 'actor' }),
      roundPrincipalColumns({
        kind: 'agent',
        serviceId: 'agent-run:run',
        agentRunId: 'run',
        roundId: 'round',
        participantId: 'seat',
      }),
    ],
    expected: [
      { actorId: 'actor', serviceId: null },
      { actorId: null, serviceId: 'agent-run:run' },
    ],
  });
});

test('a human Round principal needs its own live member account', async () => {
  const human = { kind: 'human', actorId: 'actor' } as const;
  const account = (member: boolean, erased: boolean, actorId = 'actor') => ({
    userId: `user-${actorId}`,
    actorId,
    member,
    beta: { state: 'approved' as const, revision: 1 },
    ageBand: 'adult' as const,
    erased,
    revision: 1,
  });
  assert({
    given: 'a live member account, and an agent principal without accounts',
    should: 'admit both',
    actual: [
      requireHumanRoundPrincipal(human, [account(true, false)]),
      requireHumanRoundPrincipal(
        {
          kind: 'agent',
          serviceId: 's',
          agentRunId: 'r',
          roundId: 'round',
          participantId: 'p',
        },
        [],
      ),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, accounts] of [
    ['an erased account', [account(true, true)]],
    ['a non-member account', [account(false, false)]],
    ['only another actor', [account(true, false, 'other')]],
    ['no account', [null]],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the human principal',
      actual: () =>
        requireHumanRoundPrincipal(
          human,
          accounts as unknown as Parameters<
            typeof requireHumanRoundPrincipal
          >[1],
        ),
      code: 'AUTHORIZATION',
    });
});

test('Round media stays open for live Rounds until thirty minutes after the final end', async () => {
  const end = '2026-10-22T12:00:00.000Z';
  assert({
    given: 'scheduled, active and terminal Rounds around the final end',
    should: 'close for terminal Rounds and from exactly thirty minutes after',
    actual: [
      mediaWindowClosed('scheduled', end, null),
      mediaWindowClosed('active', '2026-10-22T12:29:59.999Z', end),
      mediaWindowClosed('active', '2026-10-22T12:30:00.000Z', end),
      mediaWindowClosed('completed', end, null),
      mediaWindowClosed('abandoned', end, null),
    ],
    expected: [false, false, true, true, true],
  });
  await assertRejects({
    given: 'a closed media window',
    should: 'refuse the media operation',
    actual: () => requireMediaWindow('completed', end, null),
    code: 'CONFLICT',
  });
  await assertRejects({
    given: 'a media identifier that is not a cuid2',
    should: 'refuse it as invalid input',
    actual: () => mediaId('room/1'),
    code: 'VALIDATION',
  });
  assert({
    given: 'an open window and a cuid2 identifier',
    should: 'admit both',
    actual: [requireMediaWindow('active', end, null), mediaId(scope.roundId)],
    expected: [undefined, scope.roundId],
  });
});
