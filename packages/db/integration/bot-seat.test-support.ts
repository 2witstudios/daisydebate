import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';
export async function createBotSeat(
  fixture: Fixture,
  roundId: string,
  role: 'affirmative' | 'negative' | 'judge',
) {
  const actorId = createId();
  await fixture.insert('actors', { id: actorId, kind: 'bot' });
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
  return fixture.seat(roundId, role, 0, actorId);
}
