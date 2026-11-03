import type { Identity } from '@daisy/auth';
import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createReportHandler } from '../features/content-moderation/report-handler';
import { createDebaterFollowRoute } from '../features/following/handler';
import { createSpectatorChatRoute } from '../features/messaging/spectator-chat/handler';
import { createAudienceReactionRoute } from '../features/audience-reactions/handler';
import { silentLogger } from './test-loggers.test-support';

setupRitewayBun();

const origin = 'https://daisy.invalid';
const principal = {
  kind: 'user',
  userId: 'abcdefghijklmnopqrstuvwx',
  actorId: 'bcdefghijklmnopqrstuvwxy',
} as const;
const identities: Readonly<Record<string, Identity>> = {
  restricted: { state: 'restricted', username: 'sam', principal },
  waitlisted: {
    state: 'waitlisted',
    username: 'sam',
    reason: 'pending',
    principal,
  },
  member: { state: 'member', username: 'sam', principal },
};

/** Every write the routes could reach, recording that it was reached. */
const harness = (identity: Identity) => {
  const reached: string[] = [];
  const deps = {
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => identity,
    limiter: () =>
      ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }) as never,
    clock: { now: () => '2026-11-03T00:00:00.000Z' },
    ids: { next: () => 'cdefghijklmnopqrstuvwxyz' },
  };
  const reach = (name: string, answer: unknown) => async () => {
    reached.push(name);
    return answer;
  };
  const routes = {
    chat: createSpectatorChatRoute({
      ...deps,
      store: {
        postSpectatorChatMessage: reach('chat', { id: 'm' }) as never,
      },
    }),
    reaction: createAudienceReactionRoute({
      ...deps,
      store: { recordAudienceReaction: reach('reaction', true) as never },
    }),
    follow: createDebaterFollowRoute({
      ...deps,
      store: { setDebaterFollow: reach('follow', 'following') as never },
    }),
    report: createReportHandler({
      ...deps,
      store: {
        readReportTargetFacts: reach('report', { kind: 'missing' }) as never,
        fileReport: reach('report', undefined) as never,
      },
      nextId: deps.ids.next,
    }),
  };
  return { reached, routes };
};

const round = 'defghijklmnopqrstuvwxyza';
const post = (path: string, body: unknown) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
const requests = {
  chat: () =>
    post(`/api/rounds/${round}/chat`, {
      version: 1,
      requestId: 'efghijklmnopqrstuvwxyzab',
      text: 'A line',
    }),
  reaction: () =>
    post(`/api/rounds/${round}/reactions`, { version: 1, kind: 'sharp_point' }),
  follow: () =>
    post('/api/debater-follows', {
      version: 1,
      username: 'ana',
      state: 'following',
    }),
  report: () =>
    post('/api/content-reports', {
      targetKind: 'round',
      targetId: round,
      reason: 'spam',
    }),
} as const;
const kinds = ['chat', 'reaction', 'follow', 'report'] as const;

describe('audience interaction with no claimed username (WATCH-1)', () => {
  test('is refused everywhere, before any write', async () => {
    const { reached, routes } = harness({
      state: 'provisional',
      principal: { ...principal, actorId: null },
    } as Identity);
    const answers = await Promise.all(
      kinds.map(async (kind) => {
        const response = await routes[kind](requests[kind]());
        return ((await response.json()) as { refusal?: string }).refusal;
      }),
    );
    assert({
      given: 'a signed-in account that has not claimed a username',
      should: 'refuse chat, reactions, follows and reports and reach no store',
      actual: { answers, reached },
      expected: {
        answers: kinds.map(() => 'audience-needs-username'),
        reached: [],
      },
    });
  });
});

describe('audience interaction by a restricted account (WATCH-1)', () => {
  test('is refused everywhere, before any write', async () => {
    const { reached, routes } = harness(identities['restricted']!);
    const answers = await Promise.all(
      kinds.map(async (kind) => {
        const response = await routes[kind](requests[kind]());
        return [
          response.status,
          ((await response.json()) as { refusal?: string }).refusal,
        ];
      }),
    );
    assert({
      given:
        'a suspended or banned account on chat, reactions, follows, reports',
      should: 'refuse each with one fixed word and reach no store',
      actual: { answers, reached },
      expected: {
        answers: kinds.map(() => [403, 'account-restricted']),
        reached: [],
      },
    });
  });

  test('the account rule stands for everyone else', async () => {
    const reachedBy = async (who: string) => {
      const { reached, routes } = harness(identities[who]!);
      for (const kind of kinds) await routes[kind](requests[kind]());
      return reached;
    };
    assert({
      given: 'an account still waiting for beta access, and a member',
      should: 'pass the rule: interaction needs an account, not admission',
      actual: [await reachedBy('waitlisted'), await reachedBy('member')],
      expected: [
        ['chat', 'reaction', 'follow', 'report'],
        ['chat', 'reaction', 'follow', 'report'],
      ],
    });
  });
});
