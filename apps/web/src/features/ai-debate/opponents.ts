import { AI_VOICES, debaterPersona } from '@daisy/ai-voice';
import { listBots, type Bot } from '../train/bots';

type VoiceId = (typeof AI_VOICES)[number]['id'];

/** The voice each bot speaks with, matched to how its card says it sounds. */
const VOICES: Readonly<Record<string, VoiceId>> = {
  juno: 'aura-2-aurora-en',
  wren: 'aura-2-thalia-en',
  bram: 'aura-2-arcas-en',
};

export type Opponent = {
  readonly id: string;
  readonly name: string;
  readonly voice: VoiceId;
  readonly persona: string;
};

/**
 * The AI opponent a Train bot plays: its persona and its voice. Null when
 * no bot has that id, so a forged id never starts a debate.
 */
export function opponentFor(
  id: string,
  bots: readonly Bot[] = listBots(),
): Opponent | null {
  const bot = bots.find((candidate) => candidate.id === id);
  if (!bot) return null;
  return {
    id: bot.id,
    name: bot.name,
    voice: VOICES[bot.id] ?? 'aura-2-thalia-en',
    persona: debaterPersona(bot),
  };
}
