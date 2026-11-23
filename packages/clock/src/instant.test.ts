import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  addMs,
  fixedClock,
  instantMs,
  isInstantAtOrBefore,
  isInstantBefore,
  nowMs,
  tryAddMs,
  tryCanonicalInstantMs,
  tryInstantMs,
} from './index';

setupRitewayBun();

describe('ISO instants', () => {
  test('reads zoned instants at millisecond precision', () => {
    assert({
      given:
        'the epoch in UTC, with a zone offset, and with sub-millisecond precision',
      should: 'read each independently of the runtime time zone',
      actual: [
        instantMs('1970-01-01T00:00Z'),
        instantMs('1969-12-31T19:00:00-05:00'),
        instantMs('1970-01-01T00:00:00.123456Z'),
      ],
      expected: [0, 0, 123],
    });
  });

  test('adds milliseconds only where the sum is a representable instant', () => {
    assert({
      given:
        'a valid sum, the last representable instant, one past it, a fractional duration and a non-instant',
      should: 'answer the UTC instant or undefined',
      actual: [
        tryAddMs('2026-11-22T10:00:00Z', 1500),
        tryAddMs('+275760-09-13T00:00:00.000Z', 0),
        tryAddMs('+275760-09-13T00:00:00.000Z', 1),
        tryAddMs('2026-11-22T10:00:00Z', 0.5),
        tryAddMs('later', 1),
      ],
      expected: [
        '2026-11-22T10:00:01.500Z',
        '+275760-09-13T00:00:00.000Z',
        undefined,
        undefined,
        undefined,
      ],
    });
  });

  test('reads the canonical UTC form only, when asked for it', () => {
    assert({
      given:
        'the canonical form, a zone offset, no milliseconds, a missing zone and a non-string',
      should: 'read only the exact toISOString form',
      actual: [
        tryCanonicalInstantMs('2026-11-22T10:00:00.000Z'),
        tryCanonicalInstantMs('2026-11-22T05:00:00.000-05:00'),
        tryCanonicalInstantMs('2026-11-22T10:00:00Z'),
        tryCanonicalInstantMs('2026-11-22T10:00:00.000'),
        tryCanonicalInstantMs(1_795_000_000_000),
      ],
      expected: [1_795_341_600_000, undefined, undefined, undefined, undefined],
    });
  });

  test('rejects missing zones and invalid calendar dates', () => {
    const invalid = [
      null,
      '',
      '2026-11-20',
      '2026-11-20T01:00:00',
      '2026-02-29T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-11-20T24:00:00Z',
      '2026-11-20T00:00:00+24:00',
      '2026-11-20T00:00:00Z\n',
    ];
    assert({
      given: 'values that do not denote zoned ISO instants',
      should: 'refuse each one',
      actual: invalid.map(tryInstantMs),
      expected: invalid.map(() => undefined),
    });
  });

  test('reads an injected clock and adds a signed duration across a date boundary', () => {
    const instant = '2000-02-29T23:59:59.999Z';
    assert({
      given: 'a fixed clock on a leap day',
      should: 'read epoch milliseconds and add one millisecond',
      actual: [
        nowMs(fixedClock(instant)),
        addMs(instant, 1),
        addMs('2000-03-01T00:00Z', -1),
      ],
      expected: [951868799999, '2000-03-01T00:00:00.000Z', instant],
    });
  });

  test('orders only valid instants', () => {
    const at = '2026-11-20T05:00:00Z';
    const equal = '2026-11-20T00:00:00-05:00';
    const earlier = '2026-11-20T04:59:59Z';
    assert({
      given: 'equivalent offsets, an earlier instant and malformed input',
      should: 'distinguish strict ordering and refuse either malformed operand',
      actual: [
        isInstantBefore(earlier, at),
        isInstantBefore(at, equal),
        isInstantAtOrBefore(at, equal),
        isInstantBefore('bad', at),
        isInstantAtOrBefore(at, 'bad'),
      ],
      expected: [true, false, true, false, false],
    });
  });

  test('throws on invalid required instants and durations', () => {
    const rejects = (read: () => unknown) => {
      try {
        read();
        return false;
      } catch (error) {
        return error instanceof RangeError;
      }
    };
    const instant = '2000-01-01T00:00Z';
    assert({
      given:
        'invalid instants, a fractional duration, or an out-of-range result',
      should: 'throw at the point of use',
      actual: [
        rejects(() => instantMs('bad')),
        rejects(() => nowMs(fixedClock('bad'))),
        rejects(() => addMs('bad', 1)),
        rejects(() => addMs(instant, 0.5)),
        rejects(() => addMs(instant, Number.MAX_SAFE_INTEGER)),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
