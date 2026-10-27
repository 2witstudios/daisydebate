import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { APIRequestContext, Page, Response } from '@playwright/test';
import { reachExpiredLink } from '../e2e/support/confirm-page';

setupRitewayBun();

for (const status of [303, 400, 429]) {
  test(`expired-link setup waits for redemption response completion (${status})`, async () => {
    let cleared = false;
    let listening = false;
    let listeningAtClick = false;
    const response = Promise.withResolvers<Response>();
    const body = Promise.withResolvers<null>();
    const clicked = Promise.withResolvers<void>();
    const stopped = new Error('stop after observing session cleanup');
    const reply = (method: string, path: string) =>
      ({
        request: () => ({ method: () => method }),
        url: () => `https://unit.example${path}`,
        status: () => status,
        finished: () => body.promise,
      }) as unknown as Response;
    const responseMatches: boolean[] = [];
    const page = {
      goto: async () => {},
      getByLabel: () => ({ fill: async () => {} }),
      getByRole: (_role: string, options: { name: string | RegExp }) => {
        if (options.name instanceof RegExp)
          return {
            _apiName: 'Locator',
            _expect: async () => ({ matches: true }),
          };
        return {
          click: async () => {
            if (options.name === 'Sign in to Daisy Debate') {
              listeningAtClick = listening;
              clicked.resolve();
            }
          },
        };
      },
      waitForResponse: async (predicate: (response: Response) => boolean) => {
        listening = true;
        for (const [method, path] of [
          ['GET', '/auth/confirm'],
          ['POST', '/api/auth/sign-in/magic-link'],
          ['POST', '/auth/confirm'],
        ])
          responseMatches.push(predicate(reply(method!, path!)));
        return response.promise;
      },
      context: () => ({
        clearCookies: async () => {
          cleared = true;
          throw stopped;
        },
      }),
    } as unknown as Page;
    const request = {
      get: async () => ({
        json: async () => [
          { text: 'https://unit.example/auth/confirm?token=unit-placeholder' },
        ],
      }),
    } as unknown as APIRequestContext;
    const finished = reachExpiredLink(page, request).catch((error: unknown) => {
      if (error !== stopped) throw error;
    });
    await clicked.promise;
    await Promise.resolve();
    const clearedBeforeResponse = cleared;
    response.resolve(reply('POST', '/auth/confirm'));
    await Promise.resolve();
    await Promise.resolve();
    const clearedBeforeBody = cleared;
    body.resolve(null);
    await finished;
    assert({
      given: `a confirmation POST returning ${status} with delayed headers and body`,
      should:
        'listen before the click and finish redemption before clearing the session',
      actual: {
        listeningAtClick,
        responseMatches,
        clearedBeforeResponse,
        clearedBeforeBody,
        cleared,
      },
      expected: {
        listeningAtClick: true,
        responseMatches: [false, false, true],
        clearedBeforeResponse: false,
        clearedBeforeBody: false,
        cleared: true,
      },
    });
  });
}
