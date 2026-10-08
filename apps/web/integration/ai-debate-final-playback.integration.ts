import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { ballotCategories, ballotSchema } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomStore } from '../src/ui/ai-debate/room/store';
import {
  fakeApi,
  fakeEngine,
  handClock,
  handTimers,
  settle,
} from '../src/ui/ai-debate/room/room.test-support';
import { withPractice } from './ai-debate.test-support';
import { withSql } from './fixtures';

setupRitewayBun();
requireTestServices(process.env);

test('the final AI cutoff reaches PostgreSQL before the judge reads and completes', async () => {
  const log: string[] = [];
  let judgeInput = '';
  const scores = Object.fromEntries(
    ballotCategories.map((category) => [category, 3]),
  );
  const ballot = ballotSchema.parse({
    rubricVersion: 'speaker-10@1',
    winner: 'negative',
    scores: { affirmative: scores, negative: scores },
    reason: 'The negative wins on the spoken arguments.',
    feedback: { affirmative: 'Weigh impacts.', negative: 'Extend arguments.' },
  });
  await withPractice(
    async ({ database, actorId, id, operations, expireAt }) => {
      const initial = await operations.view({ actorId, id });
      const total = initial.rules.segments.reduce(
        (ms, segment) => ms + segment.durationMs + initial.rules.countdownMs,
        0,
      );
      await expireAt(total / 1_000 - 10);
      const view = await operations.view({ actorId, id });
      const round = (await database.getRound(id))!;
      const final = round.segments.at(-1)!;
      const bot = round.participants.find(
        (seat) => seat.role === 'affirmative',
      )!;
      const utteranceId = createId();
      await database.appendUtterance({
        id: utteranceId,
        roundId: id,
        segmentId: final.id,
        roundParticipantId: bot.id,
        text: 'Heard words. Unheard words.',
        requireOpen: true,
      });
      const time = handClock(view.serverNow);
      const timers = handTimers();
      const engine = fakeEngine(log);
      let release: () => void = () => undefined;
      const correction = new Promise<void>((resolve) => (release = resolve));
      let started: () => void = () => undefined;
      const correcting = new Promise<void>((resolve) => (started = resolve));
      let voiced: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => (voiced = resolve));
      let judged: () => void = () => undefined;
      const completed = new Promise<void>((resolve) => (judged = resolve));
      const store = createRoomStore({
        id,
        clock: time.clock,
        every: timers.every,
        openEngine: async () => engine,
        api: fakeApi({
          log,
          at: time.at,
          overrides: {
            view: async () => ({ ...view, serverNow: time.at() }),
            speech: async (_id, segmentIndex, onEvent, signal) => {
              for await (const event of operations.speech({
                actorId,
                id,
                segmentIndex,
                signal,
              }))
                onEvent(event);
              onEvent({ type: 'done' });
              voiced();
            },
            heard: async (input) => {
              log.push('heard-start');
              started();
              await correction;
              await operations.heard({ ...input, actorId });
              log.push('heard-saved');
            },
            ballot: async () => {
              log.push('ballot');
              const result = await operations.ballot({ actorId, id });
              judged();
              return result;
            },
          },
        }),
      });
      const stop = store.start();
      try {
        await settle();
        await store.join(false);
        timers.fire();
        await ready;
        await engine.advance(50);
        await withSql(async (sql) => {
          await sql`update rounds set started_at = started_at - interval '11 seconds' where id = ${id}`;
          await sql`update round_segments set started_at = started_at - interval '11 seconds', ended_at = ended_at - interval '11 seconds' where round_id = ${id}`;
        });
        time.advance(11_000);
        timers.fire();
        await correcting;
        await settle();
        assert({
          given: 'the final 2AR cutoff write is held before PostgreSQL',
          should: 'keep the round active and the judge uncalled',
          actual: [(await database.getRound(id))!.status, log],
          expected: ['active', ['heard-start']],
        });
        release();
        await completed;
        assert({
          given: 'the final AI phrase was cut halfway through',
          should:
            'persist only heard words, judge them, and then complete the round',
          actual: {
            order: log,
            text: (await database.listRoundUtterances(id)).map(
              (line) => line.text,
            ),
            judgeHeard: judgeInput.includes('Heard'),
            judgeUnheard: judgeInput.includes('Unheard words.'),
            status: (await database.getRound(id))!.status,
          },
          expected: {
            order: ['heard-start', 'heard-saved', 'ballot'],
            text: ['Heard'],
            judgeHeard: true,
            judgeUnheard: false,
            status: 'completed',
          },
        });
      } finally {
        release();
        stop();
      }
    },
    {
      personSide: 'negative',
      voiceOverrides: {
        complete: async (input) => {
          judgeInput = input.messages
            .map((message) => message.content)
            .join('\n');
          return {
            text: JSON.stringify(ballot),
            promptTokens: 10,
            completionTokens: 10,
          };
        },
      },
    },
  );
});
