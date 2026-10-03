import { mock } from 'bun:test';

/**
 * Gives client components a Next router, which only exists in a running app.
 * Call before importing the component under test.
 */
export async function mockNextRouter(): Promise<void> {
  const actual = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...actual,
    useRouter: () => ({ replace: () => undefined }),
  }));
}
