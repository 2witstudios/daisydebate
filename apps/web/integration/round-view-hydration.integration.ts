import { requireTestServices } from '@daisy/config';
import { roundPositionAt } from '@daisy/debate-engine/position';
import { roundViewSchema } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withPractice } from './ai-debate.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a started Round reads back checkpoint and ordered segments that pass the RoundView contract', async () => {
  await withPractice(
    async ({ database, host, id, operations, actorId, expireAt }) => {
      const initial = await database.getRound(id);
      if (!initial) throw new Error('Round missing');
      // Cross the countdown and land one second inside the first speech, the
      // same way the runtime itself learns a segment is due, then let the
      // real observation persist the projection before reading it back.
      await expireAt((initial.rules.countdownMs + 1_000) / 1_000);
      await operations.view({ actorId, id });
      const read = await database.readLaunchedRound(id, host, () => true);
      const round = roundViewSchema.parse(read);
      assert({
        given: 'a Round started through the real round command path',
        should: 'read back active and started, with a runtime checkpoint',
        actual: [
          round.status,
          round.startedAt !== null,
          round.checkpoint === null,
        ],
        expected: ['active', true, false],
      });
      assert({
        given: 'the segment rows of the started Round',
        should: 'come back in sequence order from 0 with the first open',
        actual: [
          round.segments.map((segment) => segment.sequence),
          round.segments.at(-1)?.endedAt ?? null,
        ],
        expected: [round.segments.map((_, sequence) => sequence), null],
      });
      const position = roundPositionAt({
        round,
        rules: round.rules,
        checkpoint: round.checkpoint,
        segments: round.segments,
        nowMs: Math.max(
          Date.now(),
          Date.parse(round.segments[0]!.startedAt) + 1,
        ),
      });
      assert({
        given: 'the same payload a browser derives its live position from',
        should: 'yield the active open first segment',
        actual: [position.status, position.openSegment?.sequence ?? -1],
        expected: ['active', 0],
      });
    },
  );
});
