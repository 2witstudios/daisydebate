import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readHostEntries,
  readHostJudges,
} from '../../../features/tab/sample/read-entries';
import { readTimelineRail } from '../../../features/tab/sample/read-tournament';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from '../searchable-groups/searchable-groups.test-support';
setupRitewayBun();
const globals = {
  self: { setTimeout, clearTimeout },
  process: { env: { NODE_ENV: 'test' } },
  performance,
  URL,
  URLSearchParams,
};
const mount = () =>
  mountBrowserClient<typeof Client>(
    Bun.resolveSync(
      '../searchable-groups/searchable-groups.test-support',
      import.meta.dir,
    ),
    globals,
  );
test('large entry filters count people and retain pending families and individual statuses', async () => {
  const scene = { viewer: 'host', moment: 'before', scale: 'large' } as const;
  const entries = readHostEntries('autumn-open', scene)!;
  const total = entries.groups.flatMap((group) => group.entries).length;
  const family = entries.groups.find(
    (group) => group.kind === 'guardian',
  )!.name;
  const client = await mount();
  try {
    await client.act(async () =>
      client.root.render(
        client.createElement(client.EntrySummary, { entries }),
      ),
    );
    const before = client.container.textContent ?? '';
    await client.act(async () =>
      [...client.container.querySelectorAll('button')]
        .find((button) => button.textContent?.startsWith('Not answered'))!
        .click(),
    );
    const after = client.container.textContent ?? '';
    await client.act(async () =>
      [...client.container.querySelectorAll('button')]
        .find((button) =>
          button.textContent?.startsWith('Waiting on a guardian'),
        )
        ?.click(),
    );
    const guardians =
      client.container.querySelector('[aria-label="Entry rosters"]')
        ?.textContent ?? '';
    await client.act(async () =>
      [...client.container.querySelectorAll('button')]
        .find((button) => button.textContent?.startsWith('Withdrawn'))
        ?.click(),
    );
    const withdrawn =
      client.container.querySelector('[aria-label="Entry rosters"]')
        ?.textContent ?? '';
    assert({
      given: 'all large entries, including three pending family entries',
      should:
        'count entries, offer guardian/withdrawn filters, retain pending families and label roster statuses',
      actual: [
        before.includes(`All ${total}`),
        before.includes('Waiting on a guardian'),
        before.includes('Withdrawn'),
        after.includes(family),
        after.includes('Not answered') ||
          after.includes('Waiting on a guardian'),
        guardians.includes(family) && !guardians.includes('Accepted'),
        withdrawn.includes('Withdrawn') && !withdrawn.includes('Accepted'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});
test('judges keep shortages and conflicts first and filter availability in the chosen slot', async () => {
  const scene = { viewer: 'host', moment: 'prelims', scale: 'large' } as const;
  const judges = readHostJudges('autumn-open', scene)!;
  const rail = readTimelineRail('autumn-open', scene)!;
  const client = await mount();
  try {
    await client.act(async () =>
      client.root.render(
        client.createElement(
          client.WithAppRouter,
          null,
          client.createElement(client.HostJudges, {
            rail,
            judges,
            entriesHref: '/host/tournaments/autumn-open/entries',
            judgesHref: '/host/tournaments/autumn-open/judges',
          }),
        ),
      ),
    );
    const text = client.container.textContent ?? '';
    const select = client.container.querySelector('select');
    const availability: number[] = [];
    if (select?.getAttribute('aria-label') === 'Time slot') {
      await client.act(async () =>
        [...client.container.querySelectorAll('button')]
          .find((button) => button.textContent?.startsWith('Free '))!
          .click(),
      );
      availability.push(
        client.container.querySelectorAll(
          '[aria-label="Judge roster"] th[scope="row"]',
        ).length,
      );
      await client.act(async () => {
        select.value = judges.slots[3]!.id;
        select.dispatchEvent(
          new client.browser.Event('change', { bubbles: true }),
        );
      });
      availability.push(
        client.container.querySelectorAll(
          '[aria-label="Judge roster"] th[scope="row"]',
        ).length,
      );
    }
    assert({
      given: 'the large pool with four schools owing judges',
      should:
        'surface urgent actions, per-slot staffing, a slot selection and uncleared status',
      actual: [
        text.includes('Needs you'),
        text.includes('By time slot'),
        text.includes('Remind 4 coaches'),
        text.includes('Review conflicts'),
        select?.getAttribute('aria-label') === 'Time slot',
        text.includes('Not cleared yet'),
      ],
      expected: [true, true, true, true, true, true],
    });
    assert({
      given: 'Free selected first at 16:30 and then at 13:00',
      should: 'show only judges actually free in each selected slot',
      actual: availability,
      expected: [141, 30],
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});
