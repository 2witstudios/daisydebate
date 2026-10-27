import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { APIRequestContext, Page } from '@playwright/test';
import { reachExpiredLink } from '../e2e/support/confirm-page';

setupRitewayBun();

test('expired-link setup cannot clear the session or revisit before redemption navigates', async () => {
  let navigated = false;
  let clearedBeforeNavigation = false;
  let cleared = false;
  const navigation = Promise.withResolvers<void>();
  const clicked = Promise.withResolvers<void>();
  const stopped = new Error('stop after observing session cleanup');
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
          if (options.name === 'Sign in to Daisy Debate') clicked.resolve();
        },
      };
    },
    waitForURL: async (url: RegExp) => {
      if (!url.test('https://unit.example/onboarding/username'))
        throw new Error('unexpected redemption destination');
      await navigation.promise;
    },
    context: () => ({
      clearCookies: async () => {
        cleared = true;
        clearedBeforeNavigation = !navigated;
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
  // Drain the click continuation while redemption is deliberately incomplete.
  await Promise.resolve();
  await Promise.resolve();
  const clearedWhilePending = cleared;
  navigated = true;
  navigation.resolve();
  await finished;
  assert({
    given: 'a confirmation click whose server redemption has not navigated yet',
    should: 'wait for successful onboarding before clearing the session',
    actual: { clearedWhilePending, clearedBeforeNavigation, cleared },
    expected: {
      clearedWhilePending: false,
      clearedBeforeNavigation: false,
      cleared: true,
    },
  });
});
