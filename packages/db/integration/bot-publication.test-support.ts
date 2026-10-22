import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createBotPublicationOperations } from '../src/bot-publication';
export const withBotPublication = (
  work: (value: {
    fixture: Parameters<Parameters<typeof withBoundedRound>[0]>[0];
    operations: ReturnType<typeof createBotPublicationOperations>;
    target: { roundId: string; roundParticipantId: string; segmentId: string };
  }) => Promise<void>,
) =>
  withBoundedRound(async (fixture, run, roundId) => {
    const bot = createId();
    await fixture.insert('actors', { id: bot, kind: 'bot' });
    await fixture.insert(
      'bot_profiles',
      {
        actor_id: bot,
        name: 'Fixture bot',
        persona: 'Test',
        voice: 'aura-2-thalia-en',
      },
      'actor_id',
    );
    const seat = await fixture.seat(roundId, 'affirmative', 0, bot);
    const segmentId = createId();
    fixture.track('round_segments', segmentId);
    await fixture.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp()-interval '1 second' where id=${roundId}`;
    await fixture.sql`insert into round_segments(id,round_id,sequence,type,rules_segment_key,started_at,duration_ms) values(${segmentId},${roundId},0,'speech','AC',clock_timestamp()-interval '1 second',60000)`;
    await fixture.insert('round_speaking_intervals', {
      id: createId(),
      round_id: roundId,
      segment_id: segmentId,
      round_participant_id: seat.id,
      started_at: new Date(),
      started_version: 1,
    });
    await fixture.sql`update round_speaking_intervals set started_at=(select started_at from round_segments where id=${segmentId}) where segment_id=${segmentId}`;
    try {
      await work({
        fixture,
        target: { roundId, roundParticipantId: seat.id, segmentId },
        operations: createBotPublicationOperations({
          run,
          nextId: createId,
          nextToken: () => randomBytes(32).toString('base64url'),
          leaseMs: 30000,
          models: {
            speech: 'anthropic/claude-sonnet-5.5',
            cross_ex: 'openai/gpt-6-luna',
          },
        }),
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
