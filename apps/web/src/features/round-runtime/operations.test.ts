import { assertRejects } from '@daisy/errors/testing';
import type { RoundCommandEnvelope } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { caller, launched, now } from '../room-runtime/operations.test-support';
import { lockedRound as context, seat } from './locked-round.test-support';
import { createRoundRuntimeOperations } from './operations';

setupRitewayBun();

const envelope = (
  command: RoundCommandEnvelope['command'],
): RoundCommandEnvelope => ({
  version: 1,
  commandId: 'e4n6p8r2t4v6x8z1k3b5c7d9',
  expectedVersion: 1,
  command,
});
const host = { kind: 'human' as const, actorId: caller.actorId };

/** A store that authorizes and projects against fixed locked facts. */
const operations = () => {
  const calls: { payloadDigest: string }[] = [];
  const ops = createRoundRuntimeOperations({
    nextSegmentId: () => 's4n6p8r2t4v6x8z1k3b5c7d9',
    store: {
      executeRoundCommand: async (input) => {
        calls.push(input);
        input.authorize(context);
        return input.buildProjection(context) as never;
      },
      executeRoundTick: async (input) =>
        input.buildProjection({ round: context.round, now }) as never,
    },
  });
  return { ops, calls };
};

test('a malformed command is refused before the store', async () => {
  const { ops, calls } = operations();
  await assertRejects({
    given: 'an envelope with an unknown command',
    should: 'refuse as invalid without a transaction',
    actual: () =>
      ops.command(
        host,
        launched.id,
        envelope({ type: 'complete' } as never) as RoundCommandEnvelope,
      ),
    code: 'VALIDATION',
  });
  assert({
    given: 'the refused envelope',
    should: 'never reach the store',
    actual: calls.length,
    expected: 0,
  });
});

test('only the host starts the Round, under a digest of the exact envelope', async () => {
  const { ops, calls } = operations();
  const start = envelope({ type: 'start' });
  const projection = (await ops.command(
    host,
    launched.id,
    start,
  )) as unknown as {
    readonly round: { readonly status: string };
  };
  assert({
    given: 'the host starting a scheduled Round',
    should: 'project the active Round and bind the SHA3 digest of the envelope',
    actual: [projection.round.status, calls[0]!.payloadDigest],
    expected: [
      'active',
      new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(start))
        .digest('hex'),
    ],
  });
  await assertRejects({
    given: 'another member starting the Round',
    should: 'refuse authority',
    actual: () =>
      ops.command(
        { kind: 'human', actorId: 'o4n6p8r2t4v6x8z1k3b5c7d9' },
        launched.id,
        start,
      ),
    code: 'AUTHORIZATION',
  });
});

test('an engine refusal of a seated command surfaces as an illegal command', async () => {
  const { ops } = operations();
  const error = await ops
    .command(
      host,
      launched.id,
      envelope({ type: 'yield', participantId: seat.id }),
    )
    .then(
      () => null,
      (caught: unknown) => caught as Error & { code: string },
    );
  assert({
    given: 'the seated member yielding before the Round started',
    should: 'refuse as a conflict naming the illegal command',
    actual: error && [error.code, error.message],
    expected: ['CONFLICT', 'illegal-command'],
  });
});

test('a tick projects the locked Round through the shared engine clock', async () => {
  const { ops } = operations();
  const projection = (await ops.tick(launched.id)) as unknown as {
    readonly speakingChanges: readonly unknown[];
    readonly round: { readonly status: string };
  };
  assert({
    given: 'a tick of a Round that has not started',
    should: 'keep it scheduled with no speaking change',
    actual: [projection.round.status, projection.speakingChanges],
    expected: ['scheduled', []],
  });
});
