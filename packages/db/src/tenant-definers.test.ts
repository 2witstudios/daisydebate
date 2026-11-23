import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  tenantDefinerProblems,
  type TenantDefinerFacts,
} from './tenant-isolation';
import type { TenantIsolationManifest } from './tenant-isolation-manifest';

setupRitewayBun();

describe('tenantDefinerProblems', () => {
  const registry: TenantIsolationManifest = {
    tables: [
      { table: 'events', key: 'lobby' },
      { table: 'grants', key: 'either', subject: 'user' },
    ],
    exempt: [{ table: 'rooms', reason: 'read by the Room evaluator' }],
    definers: [
      {
        name: 'daisy_people',
        executors: ['daisy_web', 'daisy_realtime'],
        reason: 'reads grants for both runtimes',
      },
    ],
  };
  const people: TenantDefinerFacts = {
    name: 'daisy_people',
    source: 'SELECT g.user_id FROM public.grants g',
    config: ['search_path=pg_catalog, public, pg_temp'],
    executors: ['daisy_realtime', 'daisy_web'],
  };

  test('accepts a registered definer as declared, and one that reads no tenant table', () => {
    assert({
      given:
        'the registered definer as declared, and an unregistered one reading only exempt and undeclared tables',
      should: 'report nothing',
      actual: tenantDefinerProblems(
        [
          people,
          {
            name: 'daisy_room_fence',
            source:
              'SELECT 1 FROM public.rooms JOIN public.role_grants USING (id)',
            config: ['search_path=pg_catalog, pg_temp'],
            executors: ['daisy_realtime'],
          },
        ],
        registry,
      ),
      expected: [],
    });
  });

  test('reports an unregistered definer that reads a tenant-owned table', () => {
    assert({
      given:
        'a definer the registry does not name, reading events and grants in a BEGIN ATOMIC body, the names in upper and mixed case',
      should:
        'name it and the tables it reads: unquoted names fold to lower case',
      actual: tenantDefinerProblems(
        [
          people,
          {
            ...people,
            name: 'daisy_widened',
            source:
              'BEGIN ATOMIC select 1 from public.EVENTS e join Grants g on true; END',
          },
        ],
        registry,
      ),
      expected: [
        'daisy_widened is a SECURITY DEFINER function reading events, grants but is not registered',
      ],
    });
  });

  test('reports an unregistered wrapper of a registered definer, and a definer outside public', () => {
    assert({
      given:
        'an unregistered definer calling the registered one, and one in another schema reading grants',
      should: 'name each: a wrapper crosses tenants through what it calls',
      actual: tenantDefinerProblems(
        [
          people,
          {
            ...people,
            name: 'daisy_wrapper',
            source: 'select * from public.daisy_people()',
          },
          { ...people, name: 'private.daisy_people_copy' },
        ],
        registry,
      ),
      expected: [
        'daisy_wrapper is a SECURITY DEFINER function reading daisy_people but is not registered',
        'private.daisy_people_copy is a SECURITY DEFINER function reading grants but is not registered',
      ],
    });
  });

  test('reports a registered definer that is missing, unpinned, open to PUBLIC or run by other roles', () => {
    assert({
      given:
        'the registered definer missing, without a search path, with pg_catalog not first, pg_catalog alone, no pg_temp last, an earlier pg_temp, executable by PUBLIC, and by the web alone',
      should: 'report each',
      actual: [
        tenantDefinerProblems([], registry),
        tenantDefinerProblems([{ ...people, config: [] }], registry),
        ...[
          'search_path=public, pg_catalog, pg_temp',
          // Unlisted, pg_temp is searched first: pg_catalog alone is no pin.
          'search_path=pg_catalog',
          'search_path=pg_catalog, public',
          // Its first occurrence counts, so an earlier pg_temp precedes public.
          'search_path=pg_catalog, pg_temp, public, pg_temp',
        ].map((setting) =>
          tenantDefinerProblems([{ ...people, config: [setting] }], registry),
        ),
        tenantDefinerProblems(
          [{ ...people, executors: ['PUBLIC', 'daisy_web'] }],
          registry,
        ),
        tenantDefinerProblems(
          [{ ...people, executors: ['daisy_web'] }],
          registry,
        ),
      ],
      expected: [
        ['daisy_people is registered but is not a SECURITY DEFINER function'],
        ...Array.from({ length: 5 }, () => [
          'daisy_people does not pin its search_path to pg_catalog first and pg_temp last',
        ]),
        ['PUBLIC may execute daisy_people'],
        [
          'daisy_people is executable by daisy_web but registered for daisy_realtime, daisy_web',
        ],
      ],
    });
  });

  test('reports a definer registered twice, and checks only registered ones when asked', () => {
    assert({
      given:
        'a registry naming one definer twice, and an unregistered reader under registeredOnly',
      should: 'name the duplicate, and ignore the unregistered reader',
      actual: [
        tenantDefinerProblems([people], {
          ...registry,
          definers: [...registry.definers, registry.definers[0]!],
        }),
        tenantDefinerProblems(
          [people, { ...people, name: 'daisy_later' }],
          registry,
          { registeredOnly: true },
        ),
      ],
      expected: [['daisy_people is registered more than once'], []],
    });
  });
});
