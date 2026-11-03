import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { fixedClock } from '@daisy/clock';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { fileReport } from './operations';

setupRitewayBun();

const me = 'a'.repeat(24);
const them = 'b'.repeat(24);
const now = '2026-11-02T00:00:00.000Z';
const member = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: me,
  sessionId: 's'.repeat(24),
} as unknown as AuthorizationPrincipal;
const input = { username: 'ada', reason: 'hate', surface: 'online' } as const;

const deps = (overrides = {}) => {
  const filed: unknown[] = [];
  return {
    filed,
    dependencies: {
      clock: fixedClock(now),
      ids: { next: () => 'r'.repeat(24) },
      limit: async () => {},
      discover: async () => them,
      store: () => ({
        file: async (_fence: unknown, report: unknown) => {
          filed.push(report);
        },
      }),
      ...overrides,
    },
  };
};

describe('fileReport', () => {
  test('stores a reason and where it was made, nothing more', async () => {
    const { filed, dependencies } = deps();
    assert({
      given: 'a report of another member',
      should: 'answer reported and file those fields',
      actual: [await fileReport(member, input, dependencies), filed],
      expected: [
        { username: 'ada', state: 'reported' },
        [
          {
            id: 'r'.repeat(24),
            subjectActorId: them,
            reason: 'hate',
            surface: 'online',
            now,
          },
        ],
      ],
    });
  });

  test('nobody, yourself, or a refused fence answer alike', async () => {
    for (const overrides of [
      { discover: async () => null },
      { discover: async () => me },
      {
        store: () => ({
          file: async () => {
            throw createAppError('AUTHORIZATION');
          },
        }),
      },
    ])
      await assertRejects({
        given: 'a name that cannot be reported',
        should: 'answer NOT_FOUND',
        code: 'NOT_FOUND',
        actual: () => fileReport(member, input, deps(overrides).dependencies),
      });
  });
});
