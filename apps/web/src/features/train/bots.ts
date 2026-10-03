import { sampleBots, type MockBot } from '../../ui/mock/train-bots';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';

export type Bot = MockBot;

/** Where a bot is chosen when the address names none or an unknown one. */
export const defaultBotId = 'wren';

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** The bots a viewer can face, in the order the selector steps through. */
export const listBots = (): readonly Bot[] => sampleBots;

/** The chosen bot's id from the address; unknown or absent falls back. */
export function parseBotId(
  params: SearchParams,
  bots: readonly Bot[] = listBots(),
): string {
  const id = first(params['bot']);
  return bots.some((bot) => bot.id === id) ? (id as string) : defaultBotId;
}

/** The selector's address for a chosen bot; the default is left out. */
export const selectBotHref = (id: string): string =>
  id === defaultBotId
    ? trainDestinations.bots
    : `${trainDestinations.bots}?bot=${id}`;

/** Where "debate this bot" goes: the practice setup, with the bot named. */
export const debateBotHref = (id: string): string =>
  `${trainDestinations.practice}?bot=${id}`;

type CarouselCard = {
  readonly bot: Bot;
  readonly selected: boolean;
  readonly href: string;
};

export type BotSelector = {
  readonly selected: Bot;
  /** Every bot as a jump target, in roster order. */
  readonly steps: readonly CarouselCard[];
  readonly previousHref: string | null;
  readonly nextHref: string | null;
  readonly debateHref: string;
};

/** The selector for a chosen bot: pure, every control a link. */
export function botSelector(
  chosenId: string,
  bots: readonly Bot[] = listBots(),
): BotSelector {
  const index = Math.max(
    0,
    bots.findIndex((bot) => bot.id === chosenId),
  );
  const selected = bots[index] as Bot;
  const card = (bot: Bot): CarouselCard => ({
    bot,
    selected: bot.id === selected.id,
    href: selectBotHref(bot.id),
  });
  const before = bots[index - 1];
  const after = bots[index + 1];
  return {
    selected,
    steps: bots.map(card),
    previousHref: before ? selectBotHref(before.id) : null,
    nextHref: after ? selectBotHref(after.id) : null,
    debateHref: debateBotHref(selected.id),
  };
}

/** The bot the address names, or null when it names none that exists. */
export function findBot(
  params: SearchParams,
  bots: readonly Bot[] = listBots(),
): Bot | null {
  const id = first(params['bot']);
  return bots.find((bot) => bot.id === id) ?? null;
}
