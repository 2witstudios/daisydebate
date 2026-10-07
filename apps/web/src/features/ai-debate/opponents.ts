import { AI_VOICES, debaterPersona } from '@daisy/ai-voice';
import { listBots, type Bot } from '../train/bots';

type VoiceId = (typeof AI_VOICES)[number]['id'];

/** The voice each bot speaks with, matched to how its card says it sounds. */
const VOICES: Readonly<Record<string, VoiceId>> = {
  juno: 'aura-2-aurora-en',
  wren: 'aura-2-thalia-en',
  bram: 'aura-2-arcas-en',
};

/**
 * The bot actor each roster slug seats as: fixed ids the baseline's bot
 * rows carry, so a round's negative seat is a real actor. When the roster
 * and the baseline drift, the round refuses at the seat's FK.
 */
const ACTOR_IDS: Readonly<Record<string, string>> = {
  juno: 'j9u2n6o1b4r8o2s5a9c1d3e7',
  wren: 'w2r5e8n1b4o7t0a3n6i9c2e5',
  bram: 'b1r4a7m0b3r6a9n2c5h8e1s4',
};

export type Opponent = {
  readonly id: string;
  readonly actorId: string;
  readonly name: string;
  readonly voice: VoiceId;
  readonly persona: string;
};

const byActorId = new Map(
  Object.entries(ACTOR_IDS).map(([actorId, id]) => [actorId, id]),
);

/**
 * The AI opponent a Train bot plays: its actor, persona and voice. Null
 * when no bot has that id, so a forged id never starts a round.
 */
export function opponentFor(
  id: string,
  bots: readonly Bot[] = listBots(),
): Opponent | null {
  const bot = bots.find((candidate) => candidate.id === id);
  const actorId = ACTOR_IDS[id];
  if (!bot || !actorId) return null;
  return {
    id: bot.id,
    actorId,
    name: bot.name,
    voice: VOICES[bot.id] ?? 'aura-2-thalia-en',
    persona: debaterPersona(bot),
  };
}

/** The roster bot behind a bot actor's seat, or null for an unknown actor. */
export function opponentForActor(actorId: string | undefined): Opponent | null {
  if (!actorId) return null;
  const id = byActorId.get(actorId);
  return id ? opponentFor(id) : null;
}
