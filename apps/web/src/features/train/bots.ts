import type { RoomCastChoice, RoomCatalogChoice } from '@daisy/protocol';
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

/**
 * The Train address names the opponent and the format; Freestyle needs no
 * format segment, so every address reads plainly and old links keep working.
 */
const address = (botId: string | null, formatId: string | null) => {
  const query = new URLSearchParams();
  if (botId) query.set('bot', botId);
  if (formatId && formatId !== 'freestyle') query.set('format', formatId);
  const suffix = query.toString();
  return suffix
    ? `${trainDestinations.bots}?${suffix}`
    : trainDestinations.bots;
};

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

type FormatCard = {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  /** The card's address, carrying the chosen opponent with it. */
  readonly href: string;
};

export type TrainLanding = {
  readonly opponents: readonly OpponentCard[];
  readonly chosen: OpponentCard | null;
  /** A practice room can assemble: the seats it would seat with AI are available. */
  readonly available: boolean;
  /** Who judges the practice: the AI judge, or a person the host invites (WATCH-16). */
  readonly judge: 'ai' | 'person';
  /** The standards a practice may run, the member's choice riding the address. */
  readonly formats: readonly FormatCard[];
};

const opponentCard = (
  bot: RoomCastChoice,
  chosenId: string | null,
  formatId: string | null,
): OpponentCard => ({
  actorId: bot.actorId,
  name: bot.label,
  persona: bot.persona ?? null,
  difficulty: bot.difficulty ?? null,
  eligible: bot.eligible,
  selected: bot.actorId === chosenId,
  href:
    bot.actorId === chosenId
      ? address(null, formatId)
      : address(bot.actorId, formatId),
});

/** The addressed format; unknown or absent falls back to Freestyle (DEC-269). */
const chosenFormatOf = (
  params: SearchParams,
  formats: readonly RoomCatalogChoice[],
): RoomCatalogChoice | null => {
  const named = first(params['format']);
  return (
    formats.find((choice) => choice.formatId === named) ??
    formats.find((choice) => choice.formatId === 'freestyle') ??
    formats[0] ??
    null
  );
};

/** Train's landing: one bot roster and one format choice, both in the address. */
export function trainLanding(
  params: SearchParams,
  bots: readonly RoomCastChoice[],
  botDebateAiJudge: boolean,
  formats: readonly RoomCatalogChoice[],
): TrainLanding {
  const roster = opponents(bots);
  const named = first(params['bot']);
  const chosenBot =
    roster.find((bot) => bot.actorId === named) ??
    roster.find((bot) => bot.eligible) ??
    roster[0];
  const chosenId = chosenBot?.actorId ?? null;
  const chosenFormat = chosenFormatOf(params, formats);
  const formatId = chosenFormat?.formatId ?? null;
  return {
    opponents: roster.map((bot) => opponentCard(bot, chosenId, formatId)),
    chosen: chosenBot ? opponentCard(chosenBot, chosenId, formatId) : null,
    available:
      roster.some((bot) => bot.eligible) &&
      (!botDebateAiJudge || practiceJudge(bots) !== null),
    judge: botDebateAiJudge ? 'ai' : 'person',
    formats: formats.map((choice) => ({
      id: choice.formatId,
      label: choice.label,
      selected: choice.formatId === formatId,
      href: address(chosenId, choice.formatId),
    })),
  };
}
