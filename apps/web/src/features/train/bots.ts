import type { RoomCastChoice } from '@daisy/protocol';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';

/** The bot debaters a member can face; the AI judge judges, never opposes (ISSUE-750). */
export const opponents = (
  bots: readonly RoomCastChoice[],
): readonly RoomCastChoice[] =>
  bots.filter((bot) => bot.seatRole === 'debater');

/** The AI judge a practice room seats so its cast completes (DEC-269). */
export const practiceJudge = (
  bots: readonly RoomCastChoice[],
): RoomCastChoice | null =>
  bots.find((bot) => bot.seatRole === 'judge' && bot.eligible) ?? null;

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** The Train address names only the opponent; without one it is the bare landing. */
const address = (botId: string | null) =>
  botId
    ? `${trainDestinations.bots}?${new URLSearchParams({ bot: botId })}`
    : trainDestinations.bots;

type OpponentCard = {
  readonly actorId: string;
  readonly name: string;
  readonly persona: string | null;
  readonly difficulty: RoomCastChoice['difficulty'] | null;
  readonly eligible: boolean;
  readonly selected: boolean;
  /** The card's address, so choosing works without JavaScript. */
  readonly href: string;
};

export type TrainLanding = {
  readonly opponents: readonly OpponentCard[];
  readonly chosen: OpponentCard | null;
  /** A practice room can assemble: the seats it would seat with AI are available. */
  readonly available: boolean;
  /** Who judges the practice: the AI judge, or a person the host invites (WATCH-16). */
  readonly judge: 'ai' | 'person';
};

const opponentCard = (
  bot: RoomCastChoice,
  chosenId: string | null,
): OpponentCard => ({
  actorId: bot.actorId,
  name: bot.label,
  persona: bot.persona ?? null,
  difficulty: bot.difficulty ?? null,
  eligible: bot.eligible,
  selected: bot.actorId === chosenId,
  href: bot.actorId === chosenId ? address(null) : address(bot.actorId),
});

/** Train's landing: one bot roster, the chosen opponent in the address. */
export function trainLanding(
  params: SearchParams,
  bots: readonly RoomCastChoice[],
  botDebateAiJudge: boolean,
): TrainLanding {
  const roster = opponents(bots);
  const named = first(params['bot']);
  const chosenBot =
    roster.find((bot) => bot.actorId === named) ??
    roster.find((bot) => bot.eligible) ??
    roster[0];
  const chosenId = chosenBot?.actorId ?? null;
  return {
    opponents: roster.map((bot) => opponentCard(bot, chosenId)),
    chosen: chosenBot ? opponentCard(chosenBot, chosenId) : null,
    available:
      roster.some((bot) => bot.eligible) &&
      (!botDebateAiJudge || practiceJudge(bots) !== null),
    judge: botDebateAiJudge ? 'ai' : 'person',
  };
}
