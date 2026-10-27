import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { eventRegistry } from '@daisy/logger';
import { sections, securityViews } from './sections';
import {
  coverageBounds,
  coverageOf,
  RETENTION_ALARM_MS,
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
        coverageBounds(now),
      ],
      expected: [
        { from: '2026-10-27 12:00:00.000', to: '2026-10-27 13:00:00.000' },
        { from: '2026-09-29 13:00:00.000', to: '2026-10-27 13:00:00.000' },
        { floor: '2026-10-26 13:00:00.000', recent: '2026-10-27 12:00:00.000' },
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

test('the error view reads by event, every registered error included', () => {
  const sql = sections.errors[0]?.sql ?? '';
  const listed = [...sql.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
  assert({
    given: 'the errors section and the logger registry',
    should: 'filter on the sort key by exactly the registry error events',
    actual: { listed: listed.sort(), bySeverity: sql.includes('severity') },
    expected: {
      listed: Object.entries(eventRegistry)
        .filter(([, severity]) => severity === 'error')
        .map(([event]) => event)
        .sort(),
      bySeverity: false,
    },
  });
});

describe('coverage', () => {
  const heartbeat = {
    at: '2026-10-27 12:59:30',
    nats_state: 'connected',
    reconnects: '2',
  };
  const healthy = {
    now,
    heartbeat,
    flow: [{ app: 'daisy-debate-staging', admitted: '3600', dropped: '2' }],
    oldest: [{ oldest: '2026-10-20 00:00:00.000' }],
    lastSweep: '2026-10-27 12:30:00',
  };

  test('a recent heartbeat from a connected shipper that stores what it gets', () => {
    assert({
      given:
        'a heartbeat 30 s old, few refusals, week-old rows and a recent sweep',
      should: 'read live with the reconnect count and retention ok',
      actual: coverageOf(healthy),
      expected: {
        shipper: 'live',
        natsState: 'connected',
        reconnects: 2,
        refusing: [],
        retention: 'ok',
        ages: [{ store: 'unknown', hours: 7 * 24 + 13 }],
      },
    });
  });

  test('a silent, disconnected or absent shipper', () => {
    assert({
      given: 'a 10-minute-old heartbeat, a disconnected one, and none',
      should: 'read stale, stale and missing, never live',
      actual: [
        coverageOf({
          ...healthy,
          heartbeat: { ...heartbeat, at: '2026-10-27 12:50:00' },
        }).shipper,
        coverageOf({
          ...healthy,
          heartbeat: { ...heartbeat, nats_state: 'disconnected' },
        }).shipper,
        coverageOf({ ...healthy, heartbeat: null }).shipper,
      ],
      expected: ['stale', 'stale', 'missing'],
    });
  });

  test('a live shipper refusing everything for an app', () => {
    const refusing = coverageOf({
      ...healthy,
      flow: [
        { app: 'daisy-debate-staging', admitted: '0', dropped: '595' },
        { app: 'daisy-debate-staging-realtime', admitted: '40', dropped: '0' },
      ],
    });
    assert({
      given: 'an app whose every line in the last hour was refused',
      should: 'read degraded and name that app, never live over zero counts',
      actual: { shipper: refusing.shipper, refusing: refusing.refusing },
      expected: { shipper: 'degraded', refusing: ['daisy-debate-staging'] },
    });
  });

  test('the retention alarm sits past the designed worst case', () => {
    const at = (ms: number) =>
      new Date(Date.parse(now) - ms)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');
    const retentionAt = (ageMs: number) =>
      coverageOf({
        ...healthy,
        oldest: [{ store: 'events', oldest: at(ageMs) }],
      });
    const day = 86_400_000;
    assert({
      given:
        'a row 29 d 30 min old (D 00:00 before the first sweep of D + 29) and one past the alarm',
      should: 'read ok, then overdue, with the age shown in whole hours',
      actual: [
        retentionAt(29 * day + 30 * 60_000).retention,
        retentionAt(RETENTION_ALARM_MS + 60_000).retention,
        retentionAt(29 * day + 30 * 60_000).ages,
        RETENTION_ALARM_MS < 30 * day,
      ],
      expected: ['ok', 'overdue', [{ store: 'events', hours: 696 }], true],
    });
  });

  test('retention past the alarm or without a recent sweep', () => {
    assert({
      given:
        'a 29.5-day-old row, an empty table, a sweep three hours ago, and none',
      should: 'read overdue, ok, unswept and unswept',
      actual: [
        coverageOf({
          ...healthy,
          oldest: [{ oldest: '2026-09-27 01:00:00.000' }],
        }).retention,
        coverageOf({ ...healthy, oldest: [{ oldest: '1970-01-01 00:00:00' }] })
          .retention,
        coverageOf({ ...healthy, lastSweep: '2026-10-27 10:00:00' }).retention,
        coverageOf({ ...healthy, lastSweep: '1970-01-01 00:00:00' }).retention,
      ],
      expected: ['overdue', 'ok', 'unswept', 'unswept'],
    });
  });
});
