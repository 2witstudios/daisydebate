import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  bandLabel,
  defaultHostQuery,
  hostHref,
  parseHostQuery,
  seatSpan,
  seatSpanText,
} from './host-query';

setupRitewayBun();

describe('parseHostQuery', () => {
  test('defaults and valid values', () => {
    assert({
      given: 'no parameters, a band and a posted step',
      should: 'default to editing within 200 and read the rest',
      actual: [
        parseHostQuery({}),
        parseHostQuery({ band: '0' }),
        parseHostQuery({ step: 'posted', band: '300' }),
      ],
      expected: [
        defaultHostQuery,
        { step: 'edit', band: 0 },
        { step: 'posted', band: 300 },
      ],
    });
  });

  test('untrusted values fall back', () => {
    assert({
      given: 'an unknown step, a band outside the options and a repeat',
      should: 'use the defaults or the first value',
      actual: [
        parseHostQuery({ step: 'x', band: '250' }),
        parseHostQuery({ band: ['100', '300'] }),
        parseHostQuery({ band: '-100' }),
      ],
      expected: [
        defaultHostQuery,
        { step: 'edit', band: 100 },
        defaultHostQuery,
      ],
    });
  });
});

describe('hostHref', () => {
  test('only non-default values appear', () => {
    assert({
      given: 'the default, a band and a posted table',
      should: 'build the shortest URL',
      actual: [
        hostHref(defaultHostQuery),
        hostHref({ step: 'edit', band: 100 }),
        hostHref({ step: 'posted', band: 0 }),
        hostHref({ step: 'posted', band: 200 }),
      ],
      expected: [
        '/ranked/host',
        '/ranked/host?band=100',
        '/ranked/host?step=posted&band=0',
        '/ranked/host?step=posted',
      ],
    });
  });
});

describe('seatSpan', () => {
  test('around a rating, or open to anyone', () => {
    assert({
      given: 'a provisional, an established and an unrated host',
      should: 'span the band, except for any rating or no rating',
      actual: [
        seatSpan({ kind: 'provisional', value: 1412 }, 200),
        seatSpan({ kind: 'established', value: 1586 }, 100),
        seatSpan({ kind: 'provisional', value: 1412 }, 0),
        seatSpan({ kind: 'unrated' }, 200),
      ],
      expected: [
        { min: 1212, max: 1612 },
        { min: 1486, max: 1686 },
        null,
        null,
      ],
    });
  });

  test('the copy', () => {
    assert({
      given: 'a span and no span',
      should: 'say who can take the seat',
      actual: [
        seatSpanText({ min: 1212, max: 1612 }),
        seatSpanText(null),
        bandLabel(100),
        bandLabel(0),
      ],
      expected: [
        'Ratings 1212 to 1612 can take the seat',
        'Any rating can take the seat',
        'Within 100 of my rating',
        'Any rating',
      ],
    });
  });
});
