import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sections, securityViews } from './sections';
import {
  coverageFloor,
  coverageOf,
  securityHref,
  securityQuery,
  windowBounds,
} from './view';

setupRitewayBun();

const now = '2026-10-27T13:00:00.000Z';

describe('the security screen', () => {
  test('its query', () => {
    assert({
      given: 'no query, a full one, and values outside the closed sets',
      should: 'default to auth over 24 hours, keep known values, drop the rest',
      actual: [
        securityQuery({}),
        securityQuery({ view: 'invariants', window: '7d' }),
        securityQuery({ view: "auth' OR 1=1", window: ['1h'] }),
        securityQuery({ view: 'errors', window: '90d' }),
      ],
      expected: [
        { view: 'auth', window: '24h' },
        { view: 'invariants', window: '7d' },
        { view: 'auth', window: '24h' },
        { view: 'errors', window: '24h' },
      ],
    });
  });

  test('its links', () => {
    assert({
      given: 'a view and a window',
      should: 'link the page with both',
      actual: securityHref({ view: 'realtime', window: '1h' }),
      expected: '/security?view=realtime&window=1h',
    });
  });

  test('the window bounds', () => {
    assert({
      given: 'the injected time and each window',
      should: 'bind from and to as UTC DateTime64 text, at most 28 days back',
      actual: [
        windowBounds(now, '1h'),
        windowBounds(now, '28d'),
        coverageFloor(now),
      ],
      expected: [
        { from: '2026-10-27 12:00:00.000', to: '2026-10-27 13:00:00.000' },
        { from: '2026-09-29 13:00:00.000', to: '2026-10-27 13:00:00.000' },
        '2026-10-26 13:00:00.000',
      ],
    });
  });

  test('every query is bound to the window and limited', () => {
    const all = securityViews.flatMap((view) => sections[view]);
    assert({
      given: 'every section of every view',
      should:
        'bind both window parameters and end in a LIMIT, with no other placeholder',
      actual: all.every(
        ({ sql }) =>
          sql.includes('{from:DateTime64(3)}') &&
          sql.includes('{to:DateTime64(3)}') &&
          /LIMIT \d+$/.test(sql.trim()) &&
          !/\$\{|\{(?!from:|to:)/.test(sql),
      ),
      expected: true,
    });
  });
});

describe('coverage', () => {
  const heartbeat = {
    at: '2026-10-27 12:59:30',
    nats_state: 'connected',
    reconnects: '2',
  };
  const fresh = [{ oldest: '2026-10-20 00:00:00.000' }];

  test('a recent heartbeat from a connected shipper', () => {
    assert({
      given: 'a heartbeat 30 s old, connected, and rows a week old',
      should: 'read live with the reconnect count and retention ok',
      actual: coverageOf({ now, heartbeat, oldest: fresh }),
      expected: {
        shipper: 'live',
        natsState: 'connected',
        reconnects: 2,
        retention: 'ok',
      },
    });
  });

  test('a silent, disconnected or absent shipper', () => {
    assert({
      given: 'a 10-minute-old heartbeat, a disconnected one, and none',
      should: 'read stale, stale and missing, never live',
      actual: [
        coverageOf({
          now,
          heartbeat: { ...heartbeat, at: '2026-10-27 12:50:00' },
          oldest: fresh,
        }).shipper,
        coverageOf({
          now,
          heartbeat: { ...heartbeat, nats_state: 'disconnected' },
          oldest: fresh,
        }).shipper,
        coverageOf({ now, heartbeat: null, oldest: fresh }).shipper,
      ],
      expected: ['stale', 'stale', 'missing'],
    });
  });

  test('a row past the retention alarm', () => {
    assert({
      given: 'one table whose oldest row is 29.5 days old and an empty table',
      should: 'flag retention overdue, ignoring the empty table',
      actual: [
        coverageOf({
          now,
          heartbeat,
          oldest: [{ oldest: '2026-09-27 01:00:00.000' }],
        }).retention,
        coverageOf({
          now,
          heartbeat,
          oldest: [{ oldest: '1970-01-01 00:00:00' }],
        }).retention,
      ],
      expected: ['overdue', 'ok'],
    });
  });
});
