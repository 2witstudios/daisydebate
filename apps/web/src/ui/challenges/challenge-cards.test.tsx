import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ChallengeList } from '@daisy/protocol';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './challenge-cards.test-support';

setupRitewayBun();

const offer = (id: string, username: string) => ({
  id: id.repeat(24),
  username,
  mode: 'casual' as const,
  format: 'freestyle' as const,
  createdAt: '2026-11-02T00:00:00.000Z',
  expiresAt: '2026-11-02T00:02:00.000Z',
});
const listOf = (outgoing: ChallengeList['outgoing'] = []): ChallengeList => ({
  version: 1,
  incoming: [],
  outgoing,
  accepted: [],
});

/** The cards in a private realm; the test answers each read of the list. */
const mount = async (initialChallenges: ChallengeList) => {
  const reads: ReturnType<typeof Promise.withResolvers<ChallengeList>>[] = [];
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./challenge-cards.test-support', import.meta.dir),
    {
      performance,
      URL,
      URLSearchParams,
      process: { env: { NODE_ENV: 'test' } },
      fetch: async () => {
        const read = Promise.withResolvers<ChallengeList>();
        reads.push(read);
        return { ok: true, json: () => read.promise };
      },
    },
  );
  let held: Parameters<Parameters<typeof client.CardsProbe>[0]['hold']>[0];
  await client.act(async () =>
    client.root.render(
      client.createElement(client.CardsProbe, {
        initialChallenges,
        hold: (now) => {
          held = now;
        },
      }),
    ),
  );
  const notices = () =>
    [...client.container.querySelectorAll('section')].filter((card) =>
      card.getAttribute('aria-label')?.endsWith(' ended'),
    );
  return {
    reads,
    act: (work: () => void) => client.act(async () => work()),
    held: () => held,
    refresh: () => client.act(async () => held.refresh()),
    notices: () => notices().map((card) => card.getAttribute('aria-label')),
    dismiss: (index: number) =>
      client.act(async () =>
        notices()[index]!.querySelector('button')!.click(),
      ),
    waiting: () =>
      [...client.container.querySelectorAll('section')]
        .map((card) => card.getAttribute('aria-label') ?? '')
        .filter((label) => label.startsWith('Challenge sent to')),
    unmount: () => client.act(async () => client.root.unmount()),
  };
};

test('two offers to one person that both ended are two notices, dismissed one at a time', async () => {
  const page = await mount(listOf([offer('a', 'mara'), offer('b', 'mara')]));
  try {
    await page.refresh();
    await page.act(() => page.reads.at(-1)!.resolve(listOf()));
    const ended = page.notices();
    await page.dismiss(0);
    assert({
      given: 'two offers to @mara that both ended, then one notice dismissed',
      should: 'say each offer ended, and keep the notice not dismissed',
      actual: { ended, afterDismissing: page.notices() },
      expected: {
        ended: [
          'Your challenge to @mara ended',
          'Your challenge to @mara ended',
        ],
        afterDismissing: ['Your challenge to @mara ended'],
      },
    });
  } finally {
    await page.unmount();
  }
});

test('a read changes what is shown, never the commands a card holds', async () => {
  const page = await mount(listOf([offer('a', 'mara')]));
  try {
    const before = page.held();
    await page.refresh();
    await page.act(() => page.reads.at(-1)!.resolve(listOf()));
    const after = page.held();
    assert({
      given: 'a read that ended the one offer shown',
      should: 'show the list anew and keep each command the same function',
      actual: [
        page.waiting(),
        after.refresh === before.refresh,
        after.noteCancelled === before.noteCancelled,
        after.forgetCancelled === before.forgetCancelled,
        after.dismissEnded === before.dismissEnded,
      ],
      expected: [[], true, true, true, true],
    });
  } finally {
    await page.unmount();
  }
});

test('an offer the member is cancelling ends without a notice', async () => {
  const page = await mount(listOf([offer('a', 'mara'), offer('b', 'mara')]));
  try {
    await page.act(() => page.held().noteCancelled('a'.repeat(24)));
    await page.refresh();
    await page.act(() =>
      page.reads.at(-1)!.resolve(listOf([offer('b', 'mara')])),
    );
    assert({
      given:
        'two offers to @mara, one cancelled by the member and read as gone',
      should: 'keep the other waiting and say nothing ended',
      actual: [page.waiting(), page.notices()],
      expected: [['Challenge sent to @mara'], []],
    });
  } finally {
    await page.unmount();
  }
});

test('a read that fails keeps what is shown', async () => {
  const page = await mount(listOf([offer('a', 'mara')]));
  try {
    await page.refresh();
    await page.act(() => page.reads.at(-1)!.reject(new Error('offline')));
    assert({
      given: 'an offer shown and a read that fails',
      should: 'keep the offer waiting and say nothing ended',
      actual: [page.waiting(), page.notices()],
      expected: [['Challenge sent to @mara'], []],
    });
  } finally {
    await page.unmount();
  }
});
