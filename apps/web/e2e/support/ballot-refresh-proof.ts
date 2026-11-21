import type { Page, Request, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { boundedStep } from './bounded-step';
import { expect } from './fixtures';
import { withChallengeReadLocked } from './challenge-read-lock';

/** Apply a real failed shell refresh while the original ballot awaits its answer. */
export async function submitAcrossFailedChallengeRead(
  page: Page,
  ballotPath: string,
  submit: () => Promise<void>,
) {
  const form = page.getByRole('form', { name: 'Your ballot' });
  const originalForm = await form.elementHandle();
  const refreshRequest = Promise.withResolvers<Request>();
  const sendRefresh = Promise.withResolvers<void>();
  const sendAction = Promise.withResolvers<void>();
  const resumePolling = Promise.withResolvers<void>();
  const sameBallot = (url: URL) => url.pathname === ballotPath;
  let refresh: Request | undefined;
  const intercept = async (route: Route) => {
    const request = route.request();
    const headers = request.headers();
    if (request.method() === 'GET' && headers['rsc'] === '1') {
      // Hold later polls so their commits cannot stand in for this refresh.
      if (refresh) {
        await resumePolling.promise;
      } else {
        refresh = request;
        refreshRequest.resolve(request);
        await sendRefresh.promise;
      }
    }
    if (request.method() === 'POST' && headers['next-action'])
      await sendAction.promise;
    await route.continue();
  };
  await page.route(sameBallot, intercept);
  try {
    await page.getByRole('link', { name: 'Refresh Round' }).click();
    const request = await boundedStep(
      'the Round refresh request',
      () => refreshRequest.promise,
      8_000,
    );
    await submit();
    await expect(form).toHaveAttribute('aria-busy', 'true');
    expect(
      await originalForm.evaluate(
        (node) => node.isConnected && node.getAttribute('aria-busy') === 'true',
      ),
      'the original ballot form is pending before the refresh can apply',
    ).toBe(true);
    const commit = await originalForm.evaluateHandle((node) => {
      const replaceState = history.replaceState;
      let pendingAtCommit: boolean | null = null;
      // Next writes history at the start of the router commit, before the page subtree updates.
      history.replaceState = (...args) => {
        pendingAtCommit ??=
          node.isConnected && node.getAttribute('aria-busy') === 'true';
        replaceState.apply(history, args);
      };
      return {
        pending: () => pendingAtCommit,
        restore: () => {
          history.replaceState = replaceState;
        },
      };
    });
    try {
      await Promise.all([
        page.waitForEvent('framenavigated', {
          predicate: (frame) =>
            frame === page.mainFrame() && sameBallot(new URL(frame.url())),
          timeout: 12_000,
        }),
        withChallengeReadLocked(async () => {
          const response = page.waitForResponse(
            (incoming) => incoming.request() === request,
            { timeout: 8_000 },
          );
          sendRefresh.resolve();
          const refreshed = await response;
          const requestId = refreshed.headers()['x-request-id'];
          expect(requestId).toBeTruthy();
          await expect
            .poll(
              async () => {
                const log = await readFile(
                  resolve(
                    import.meta.dirname,
                    `../../test-results/room-launch-server-${process.env.E2E_PORT}.log`,
                  ),
                  'utf8',
                );
                return log
                  .split('\n')
                  .some(
                    (line) =>
                      line.includes(`"requestId":"${requestId}"`) &&
                      line.includes('"operation":"challenges.list"') &&
                      /"status":5[0-9]{2}(?:,|})/.test(line),
                  );
              },
              {
                message:
                  'the selected Round refresh encountered a failed optional challenge read',
                timeout: 5_000,
              },
            )
            .toBe(true);
        }).then(() => {
          // React can commit the refresh and action together once both replies are available.
          sendAction.resolve();
        }),
      ]);
      expect(
        await commit.evaluate((observation) => observation.pending()),
        'the original ballot was pending at the start of the router commit',
      ).toBe(true);
      expect(
        await originalForm.evaluate((node) => node.isConnected),
        'the original pending ballot form stays mounted through the refresh',
      ).toBe(true);
    } finally {
      await commit.evaluate((observation) => observation.restore());
      await commit.dispose();
    }
    return originalForm;
  } finally {
    sendRefresh.resolve();
    sendAction.resolve();
    resumePolling.resolve();
    await page.unroute(sameBallot, intercept);
  }
}
