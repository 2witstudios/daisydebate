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
