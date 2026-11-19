import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  tenantDefinerProblems,
  type TenantDefinerFacts,
} from './tenant-definers';
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
    config: ['search_path=pg_catalog, public'],
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
      given: 'a definer the registry does not name, reading events and grants',
      should: 'name it and the tables it reads',
      actual: tenantDefinerProblems(
        [
          people,
          {
            ...people,
            name: 'daisy_widened',
            source: 'select 1 from events e join grants g on true',
          },
        ],
        registry,
      ),
      expected: [
        'daisy_widened is a SECURITY DEFINER function reading events, grants but is not registered',
      ],
    });
  });

  test('reports a registered definer that is missing, unpinned, open to PUBLIC or run by other roles', () => {
    assert({
      given:
        'the registered definer missing, without a pinned search path, executable by PUBLIC, and by the web alone',
      should: 'report each',
      actual: [
        tenantDefinerProblems([], registry),
        tenantDefinerProblems([{ ...people, config: [] }], registry),
        tenantDefinerProblems(
          [{ ...people, config: ['search_path=public, pg_catalog'] }],
          registry,
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
        ['daisy_people does not pin its search_path to pg_catalog first'],
        ['daisy_people does not pin its search_path to pg_catalog first'],
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
