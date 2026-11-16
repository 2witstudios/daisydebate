import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';
/**
 * A bot actor with its profile, seated nowhere yet: the AI judge's for a
 * judge seat, a bot debater's otherwise (ISSUE-750).
 */
export async function createBotActor(
  fixture: Fixture,
  seat: 'debater' | 'judge' = 'debater',
) {
  const actorId = createId();
  await fixture.insert('actors', { id: actorId, kind: 'bot' });
  if (seat === 'judge')
    await fixture.insert(
      'ai_judge_profiles',
      { actor_id: actorId, name: 'Fixture judge' },
      'actor_id',
    );
  else
    await fixture.insert(
      'bot_profiles',
      {
        actor_id: actorId,
        name: 'Fixture bot',
        persona: 'Test',
        voice: 'aura-2-thalia-en',
      },
      'actor_id',
    );
  return actorId;
}
export async function createBotSeat(
  fixture: Fixture,
  roundId: string,
  role: 'affirmative' | 'negative' | 'judge',
  slot = 0,
) {
  return fixture.seat(
    roundId,
    role,
    slot,
    await createBotActor(fixture, role === 'judge' ? 'judge' : 'debater'),
  );
}

/** The already frozen bot judge identity, never a post-Start replacement. */
export async function existingBotJudgeSeat(
  fixture: Fixture,
  roundId: string,
  slot: number,
) {
  const [seat] =
    await fixture.sql`select p.id,p.actor_id as "actorId" from round_participants p join actors a on a.id=p.actor_id where p.round_id=${roundId} and p.seat_kind='judge' and p.slot=${slot} and a.kind='bot' and public.daisy_round_participant_is_current(p.id)`;
  if (!seat) throw new Error('Original frozen bot judge missing');
  return { id: String(seat.id), actorId: String(seat.actorId) };
}
