import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import { requireMember } from './member-gate';

setupRitewayBun();

const rule = { max: 1, windowSeconds: 60 };
const request = new Request('https://daisy.invalid/');
const principal = { kind: 'user' as const, userId: 'user', actorId: 'actor' };
const member: Identity = { state: 'member', username: 'Ada', principal };
const waitlisted = { ...member, state: 'waitlisted' } as Identity;
const gate = (identity: Identity, actor: string | null = 'actor') => {
  const events: string[] = [];
  return {
    events,
    deps: {
      identify: async () => identity,
      limiter: () => ({
        consume: async (key: string) => {
          events.push(`consume ${key}`);
          return { allowed: true, retryAfterSeconds: 0 };
        },
      }),
      getActorByUserId: async () => {
        events.push('actor');
        return actor === null ? null : { id: actor };
      },
    },
  };
};

test('requireMember()', async () => {
  const admitted = gate(member);
  assert({
    given: 'a member with a current actor',
    should: 'spend the bucket, then read the actor, and return the caller',
    actual: [
      await requireMember(admitted.deps, request, { bucket: 'b', rule }),
      admitted.events,
    ],
    expected: [
      { userId: 'user', actorId: 'actor' },
      ['consume b:user', 'actor'],
    ],
  });

  const code = async (
    identity: Identity,
    actor: string | null,
    admitWaitlisted = false,
  ) =>
    (
      await rejectionOf(() =>
        requireMember(gate(identity, actor).deps, request, {
          bucket: 'b',
          rule,
          admitWaitlisted,
        }),
      )
    )?.code;

  assert({
    given: 'an actor that is missing, or one that moved',
    should: 'answer the one data-fault code in both cases',
    actual: [await code(member, null), await code(member, 'other')],
    expected: ['INFRASTRUCTURE', 'INFRASTRUCTURE'],
  });

  const refused = gate(waitlisted);
  assert({
    given: 'a waitlisted account on a member-only route',
    should: 'refuse it before spending any budget',
    actual: [
      (
        await rejectionOf(() =>
          requireMember(refused.deps, request, { bucket: 'b', rule }),
        )
      )?.code,
      refused.events,
    ],
    expected: ['AUTHORIZATION', []],
  });

  assert({
    given: 'a waitlisted account on a route that admits it',
    should: 'return the caller',
    actual: await requireMember(gate(waitlisted).deps, request, {
      bucket: 'b',
      rule,
      admitWaitlisted: true,
    }),
    expected: { userId: 'user', actorId: 'actor' },
  });

  const checked = gate(member);
  assert({
    given: 'a route that refuses before the budget',
    should: 'spend nothing and read no actor',
    actual: [
      (
        await rejectionOf(() =>
          requireMember(checked.deps, request, {
            bucket: 'b',
            rule,
            beforeBudget: () => {
              throw createAppError('VALIDATION');
            },
          }),
        )
      ).code,
      checked.events,
    ],
    expected: ['VALIDATION', []],
  });
});
