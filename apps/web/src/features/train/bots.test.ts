import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  botSelector,
  debateBotHref,
  findBot,
  defaultBotId,
  listBots,
  parseBotId,
  selectBotHref,
} from './bots';

setupRitewayBun();

describe('listBots', () => {
  test('unique ids, and every bot has a personality and a voice', () => {
    const bots = listBots();
    assert({
      given: 'the roster',
      should: 'never repeat an id and describe each bot fully',
      actual: [
        new Set(bots.map((bot) => bot.id)).size === bots.length,
        bots.every(
          (bot) =>
            bot.personality.length > 0 &&
            bot.voice.length > 0 &&
            bot.traits.length > 0,
        ),
      ],
      expected: [true, true],
    });
  });
});

describe('parseBotId', () => {
  test('known, unknown and absent', () => {
    assert({
      given: 'a known bot, an unknown one, and none',
      should: 'keep the known and fall back otherwise',
      actual: [
        parseBotId({ bot: 'bram' }),
        parseBotId({ bot: 'nobody' }),
        parseBotId({}),
      ],
      expected: ['bram', defaultBotId, defaultBotId],
    });
  });
});

describe('hrefs', () => {
  test('the default stays out of the address', () => {
    assert({
      given: 'the default and another bot',
      should: 'write only the non-default',
      actual: [
        selectBotHref(defaultBotId),
        selectBotHref('bram'),
        debateBotHref('bram'),
      ],
      expected: ['/train', '/train?bot=bram', '/train/practice?bot=bram'],
    });
  });
});

describe('botSelector', () => {
  test('arrows lead to the neighbours', () => {
    const view = botSelector('wren');
    assert({
      given: 'a bot in the middle of the roster',
      should: 'choose it and link to the bots either side',
      actual: [view.selected.id, view.previousHref, view.nextHref],
      expected: ['wren', '/train?bot=juno', '/train?bot=bram'],
    });
  });

  test('the ends have one arrow', () => {
    const bots = listBots();
    const first = botSelector(bots[0]?.id ?? '');
    const last = botSelector(bots.at(-1)?.id ?? '');
    assert({
      given: 'the first and the last bot',
      should: 'offer no arrow past either end',
      actual: [first.previousHref, last.nextHref],
      expected: [null, null],
    });
  });

  test('every bot is a step', () => {
    assert({
      given: 'any selection',
      should: 'list the whole roster to jump to',
      actual: botSelector('juno').steps.length,
      expected: listBots().length,
    });
  });
});

describe('findBot', () => {
  test('names a bot only when it exists', () => {
    assert({
      given: 'a known bot, an unknown one and none',
      should: 'return the bot, then null, then null',
      actual: [
        findBot({ bot: 'bram' })?.name,
        findBot({ bot: 'nobody' }),
        findBot({}),
      ],
      expected: ['Bram', null, null],
    });
  });
});
