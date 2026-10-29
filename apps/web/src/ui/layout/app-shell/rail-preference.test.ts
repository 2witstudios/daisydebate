import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  flipRailPreference,
  isRailPreference,
  parseRailPreference,
  RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
  RAIL_PREFERENCES,
} from './rail-preference';

setupRitewayBun();

describe('parseRailPreference', () => {
  test('accepts every known preference', () => {
    assert({
      given: 'each known preference string',
      should: 'return it unchanged',
      actual: RAIL_PREFERENCES.map(parseRailPreference),
      expected: ['extended', 'mini'],
    });
  });

  test('falls back to extended for anything else', () => {
    assert({
      given: 'a missing cookie, wrong case, junk, and non-strings',
      should: 'default to the extended rail',
      actual: [undefined, 'Mini', 'wide', '', 1, null].map(parseRailPreference),
      expected: [
        'extended',
        'extended',
        'extended',
        'extended',
        'extended',
        'extended',
      ],
    });
  });
});

describe('isRailPreference', () => {
  test('recognizes only known preferences', () => {
    assert({
      given: 'a known value, a near miss, and a non-string',
      should: 'accept only the known value',
      actual: ['mini', 'Mini', {}].map(isRailPreference),
      expected: [true, false, false],
    });
  });
});

describe('flipRailPreference', () => {
  test('toggles between the two rail widths, and back', () => {
    assert({
      given: 'the extended and mini preferences',
      should: 'return the opposite preference, and flipping twice the original',
      actual: [
        flipRailPreference('extended'),
        flipRailPreference('mini'),
        flipRailPreference(flipRailPreference('mini')),
      ],
      expected: ['mini', 'extended', 'mini'],
    });
  });
});

describe('RAIL_COOKIE_OPTIONS', () => {
  test('holds a year-long, site-wide, server-only cookie', () => {
    assert({
      given: "the cookie's one definition",
      should: 'sit at the root for a year, Secure, HttpOnly and Lax',
      actual: RAIL_COOKIE_OPTIONS,
      expected: {
        path: '/',
        maxAge: 31_536_000,
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      },
    });
  });

  test('names the cookie as the design specifies', () => {
    assert({
      given: 'the cookie constant',
      should: 'be daisy.rail',
      actual: RAIL_COOKIE,
      expected: 'daisy.rail',
    });
  });
});
