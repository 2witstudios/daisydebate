import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead } from '@daisy/protocol';
import { ballotRefreshEveryMs } from '../../../features/round-ballots/ballot-refresh';
import {
  ballotUnavailable,
  type RoundBallotFormState,
} from '../../../features/round-ballots/form';
import {
  asActive,
  judge,
  view,
} from '../../debate-room/live-round.test-support';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './ballot-page-refresh.test-support';

setupRitewayBun();

const renderedAtMs = Date.parse('2026-10-22T00:05:00.000Z');
/** A frozen Round inside its judging window, the judge's ballot not yet cast. */
const open: RoundBallotRead = {
  round: {
    ...asActive(view),
    waitingOn: {
      state: 'human_window',
      deadlineAt: '2026-10-22T00:30:00.000Z',
    },
  },
  own: { participantId: judge.id, ballot: null, freezeRevision: null },
  freeze: {
    revision: 1,
    frontier: 0,
    frozenAt: '2026-10-22T00:00:00.000Z',
    completeness: 'complete',
    utterances: [],
  },
  ballots: [],
  transcript: null,
};

/** The page in a private realm whose timeouts the test holds and fires by hand. */
const mount = async () => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./ballot-page-refresh.test-support', import.meta.dir),
    // What Next's link and the page's clock read; a link's idle work never runs.
    {
      process: { env: {} },
      self: { requestIdleCallback: () => 0, cancelIdleCallback: () => {} },
      performance,
      FormData,
      URL,
      URLSearchParams,
    },
  );
  const { browser } = client;
  const scheduled = new Map<number, { run: () => void; inMs: number }>();
  let timers = 0;
  Object.assign(browser, {
    setTimeout: (run: () => void, inMs: number) => {
      timers += 1;
      scheduled.set(timers, { run, inMs });
      return timers;
    },
    clearTimeout: (timer: number) => {
      scheduled.delete(timer);
    },
  });
  let refreshes = 0;
  const answers: ReturnType<
    typeof Promise.withResolvers<RoundBallotFormState>
  >[] = [];
  const posted: FormData[] = [];
  await client.act(async () =>
    client.root.render(
      client.createElement(client.RoutedBallotPage, {
        view: open,
        commandId: 'c'.repeat(24),
        renderedAtMs,
        onRefresh: () => {
          refreshes += 1;
        },
        action: (_state, form) => {
          const answer = Promise.withResolvers<RoundBallotFormState>();
          answers.push(answer);
          posted.push(form);
          return answer.promise;
        },
      }),
    ),
  );
  return {
    answers,
    posted,
    act: (work: () => void) => client.act(async () => work()),
    /** The delays of the refreshes now scheduled. */
    scheduled: () => [...scheduled.values()].map(({ inMs }) => inMs),
    /** Runs every scheduled refresh as if its delay had passed; says how many the router was asked for so far. */
    pass: async () => {
      const due = [...scheduled.values()];
      scheduled.clear();
      await client.act(async () => due.forEach(({ run }) => run()));
      return refreshes;
    },
    submit: () =>
      client.act(async () => {
        const form = client.container.querySelector('form')!;
        form.dispatchEvent(
          new browser.Event('submit', { bubbles: true, cancelable: true }),
        );
      }),
    unmount: () => client.act(async () => client.root.unmount()),
  };
};

test('a ballot being posted, or left unacknowledged, stops the page refreshing', async () => {
  const page = await mount();
  try {
    const before = [page.scheduled(), await page.pass(), page.scheduled()];
    await page.submit();
    const posting = [page.answers.length, page.scheduled(), await page.pass()];
    await page.act(() =>
      page.answers[0]!.resolve(ballotUnavailable(page.posted[0]!)),
    );
    const unacknowledged = [page.scheduled(), await page.pass()];
    assert({
      given:
        'an open ballot inside its judging window, then the ballot posted, then its answer lost',
      should:
        'refresh on schedule before the post, and schedule and send no refresh while it is posted or unacknowledged',
      actual: { before, posting, unacknowledged },
      expected: {
        before: [[ballotRefreshEveryMs], 1, [ballotRefreshEveryMs]],
        posting: [1, [], 1],
        unacknowledged: [[], 1],
      },
    });
  } finally {
    await page.unmount();
  }
});
