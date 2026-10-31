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
  /** A practice room can assemble: both its AI seats are available. */
  readonly available: boolean;
};

const card = (bot: RoomCastChoice, chosenId: string | null): OpponentCard => ({
  actorId: bot.actorId,
  name: bot.label,
  persona: bot.persona ?? null,
  difficulty: bot.difficulty ?? null,
  eligible: bot.eligible,
  selected: bot.actorId === chosenId,
  href:
    bot.actorId === chosenId
      ? trainDestinations.bots
      : `${trainDestinations.bots}?bot=${bot.actorId}`,
});

/** The address names its opponent; unknown or absent falls back to the first. */
export function trainLanding(
  params: SearchParams,
  bots: readonly RoomCastChoice[],
): TrainLanding {
  const roster = opponents(bots);
  const named = first(params['bot']);
  const chosenBot =
    roster.find((bot) => bot.actorId === named) ??
    roster.find((bot) => bot.eligible) ??
    roster[0];
  const chosenId = chosenBot?.actorId ?? null;
  return {
    opponents: roster.map((bot) => card(bot, chosenId)),
    chosen: chosenBot ? card(chosenBot, chosenId) : null,
    available:
      roster.some((bot) => bot.eligible) && practiceJudge(bots) !== null,
  };
}
