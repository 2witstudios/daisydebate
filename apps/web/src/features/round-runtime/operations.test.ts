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
const operations = (locked = context) => {
  const calls: { payloadDigest: string }[] = [];
  const ops = createRoundRuntimeOperations({
    nextSegmentId: () => 's4n6p8r2t4v6x8z1k3b5c7d9',
    store: {
      executeRoundCommand: async (input) => {
        calls.push(input);
        input.authorize(locked);
        return input.buildProjection(locked) as never;
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
    expected: ['opening', []],
  });
});

test('a seated forfeit in the opening stands as a result, under a digest of the exact envelope', async () => {
  const opening = {
    ...context,
    round: {
      ...context.round,
      status: 'opening' as const,
      startedAt: null,
      opening: {
        state: { startedAt: now, draw: null, prepMs: 60_000 },
        seed: null,
      },
    },
  };
  const { ops, calls } = operations(opening);
  const forfeit = envelope({ type: 'forfeit', participantId: seat.id });
  const projection = (await ops.command(
    host,
    launched.id,
    forfeit,
  )) as unknown as { readonly round: { readonly status: string } };
  assert({
    given: 'a debater forfeiting during pre-round prep',
    should: 'complete the Round and bind the SHA3 digest of the envelope',
    actual: [projection.round.status, calls[0]!.payloadDigest],
    expected: [
      'completed',
      new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(forfeit))
        .digest('hex'),
    ],
  });
});

test('a strike with no opening is an illegal command', async () => {
  const { ops } = operations();
  await assertRejects({
    given: 'a strike on an active Round',
    should: 'refuse as a conflict',
    actual: () =>
      ops.command(
        host,
        launched.id,
        envelope({
          type: 'strike_resolution',
          participantId: seat.id,
          ordinal: 0,
          position: 0,
        }),
      ),
    code: 'CONFLICT',
  });
});
