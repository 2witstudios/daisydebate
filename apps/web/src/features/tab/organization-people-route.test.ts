import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import type { OrganizationPeopleView } from '@daisy/protocol/lobby/organization-read';
import { silentLogger } from '../../server/test-loggers.test-support';
import { member, origin } from '../../server/member-boundary.test-support';
import {
  createOrganizationPeopleRoute,
  organizationPeoplePath,
} from './organization-people-route';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const view: OrganizationPeopleView = {
  organizationId: id('o'),
  name: 'Valley League',
  people: [],
  roles: [],
  conflictHandling: null,
  capabilities: { give: true },
};

const route = (
  overrides: {
    readonly released?: boolean;
    readonly organizationId?: string | null;
    readonly view?: OrganizationPeopleView | null;
  } = {},
) => {
  const asked: unknown[] = [];
  const get = createOrganizationPeopleRoute({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
    },
    released: async () => overrides.released ?? true,
    organizationIdOfHandle: async (handle) => {
      asked.push(['handle', handle]);
      return overrides.organizationId === undefined
        ? id('o')
        : overrides.organizationId;
    },
    read: async (principal, organizationId) => {
      asked.push(['read', principal.userId, organizationId]);
      return overrides.view === undefined ? view : overrides.view;
    },
  });
  const answer = get(
    new Request(`${origin}${organizationPeoplePath('valley')}`, {
      headers: { origin },
    }),
  );
  return { answer, asked };
};

describe('the organization people route', () => {
  test('a viewer the read allows', async () => {
    const { answer, asked } = route();
    const response = await answer;
    assert({
      given: 'a member asking for a league they host by its handle',
      should: 'read it by its id as the member and answer the view',
      actual: [response.status, await response.json(), asked],
      expected: [
        200,
        view,
        [
          ['handle', 'valley'],
          ['read', member.principal.userId, id('o')],
        ],
      ],
    });
  });
  test('every refusal answers not found', async () => {
    const statuses = await Promise.all(
      [
        route({ released: false }),
        route({ organizationId: null }),
        route({ view: null }),
      ].map(async ({ answer }) => (await answer).status),
    );
    assert({
      given:
        'a closed release, an unknown handle, and a viewer the read denies',
      should: 'answer each as not found',
      actual: statuses,
      expected: [404, 404, 404],
    });
  });
});
