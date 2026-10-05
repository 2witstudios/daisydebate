import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import type { OnboardingStepWrite } from '@daisy/db';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createOnboardingHandler } from './save-answers';
import { allowEvery, type ConsumeStub } from '../auth/limiter.test-support';

setupRitewayBun();

const member: Identity = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'user1', permissions: [] },
};

const NOW = '2026-10-05T12:00:00.000Z';

const handlerWith = ({
  identity = member,
  consume = allowEvery,
}: {
  identity?: Identity;
  consume?: ConsumeStub;
} = {}) => {
  const saved: Array<{ userId: string; answers: OnboardingStepWrite }> = [];
  const completed: Array<{ userId: string; at: string }> = [];
  const handler = createOnboardingHandler({
    logger: silentLogger,
    origin: () => 'http://localhost:3000',
    identify: async () => identity,
    limiter: () => ({ consume }),
    clock: { now: () => NOW },
    save: async (userId, answers) => {
      saved.push({ userId, answers });
    },
    complete: async (userId, at) => {
      completed.push({ userId, at: at.toISOString() });
    },
  });
  return { handler, saved, completed };
};

const post = (body: unknown, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/account/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

const about = { step: 'about', wants: ['debate'], club: 'own' };

describe('POST /api/account/onboarding gates', () => {
  test('callers who are not members store nothing', async () => {
    const anonymous = handlerWith({
      identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
    });
    const provisional = handlerWith({
      identity: {
        state: 'provisional',
        principal: { kind: 'user', userId: 'user1', permissions: [] },
      },
    });
    const outage = handlerWith({
      identity: { state: 'unavailable', principal: { kind: 'anonymous' } },
    });
    assert({
      given: 'no session, an account with no username, and a session outage',
      should: 'answer 401, 403 and 503, storing nothing',
      actual: [
        (await anonymous.handler(post(about))).status,
        (await provisional.handler(post(about))).status,
        (await outage.handler(post(about))).status,
        anonymous.saved.length + provisional.saved.length + outage.saved.length,
      ],
      expected: [401, 403, 503, 0],
    });
  });

  test('another origin is refused', async () => {
    const { handler, saved } = handlerWith();
    assert({
      given: 'a post from another site',
      should: 'refuse with 403 and store nothing',
      actual: [
        (await handler(post(about, 'https://evil.example'))).status,
        saved,
      ],
      expected: [403, []],
    });
  });

  test('the rate rule', async () => {
    const limited = handlerWith({
      consume: async () => ({ allowed: false, retryAfterSeconds: 30 }),
    });
    const down = handlerWith({
      consume: async () => {
        throw new Error('redis down');
      },
    });
    assert({
      given: 'a member over the allowance, and a limiter that throws',
      should: 'answer 429 and a fail-closed 503, storing nothing',
      actual: [
        (await limited.handler(post(about))).status,
        (await down.handler(post(about))).status,
        limited.saved.length + down.saved.length,
      ],
      expected: [429, 503, 0],
    });
  });
});

describe('POST /api/account/onboarding answers', () => {
  test('a step is saved for the session member', async () => {
    const { handler, saved } = handlerWith();
    const response = await handler(post(about));
    assert({
      given: 'a member posting the about step',
      should: 'save it under their own id and answer 200 with the step',
      actual: [response.status, await response.json(), saved],
      expected: [
        200,
        { saved: 'about' },
        [
          {
            userId: 'user1',
            answers: { step: 'about', wants: ['debate'], club: 'own' },
          },
        ],
      ],
    });
  });

  test('a refused answer stores nothing', async () => {
    const { handler, saved } = handlerWith();
    const response = await handler(
      post({ step: 'topics', topics: ['astrology'] }),
    );
    assert({
      given: 'a topic off the list',
      should: 'answer 400 VALIDATION and store nothing',
      actual: [
        response.status,
        ((await response.json()) as { error: { code: string } }).error.code,
        saved,
      ],
      expected: [400, 'VALIDATION', []],
    });
  });

  test('finishing records completion at the injected time', async () => {
    const { handler, saved, completed } = handlerWith();
    const response = await handler(post({ step: 'finish' }));
    assert({
      given: 'a member posting finish',
      should: 'record completion now and save no answers',
      actual: [response.status, await response.json(), completed, saved],
      expected: [200, { saved: 'finish' }, [{ userId: 'user1', at: NOW }], []],
    });
  });

  test('finish takes no other fields', async () => {
    const { handler, completed } = handlerWith();
    assert({
      given: 'finish with an extra field',
      should: 'refuse with 400 and record nothing',
      actual: [
        (await handler(post({ step: 'finish', wants: [] }))).status,
        completed,
      ],
      expected: [400, []],
    });
  });
});
