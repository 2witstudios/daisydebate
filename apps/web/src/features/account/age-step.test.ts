import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import type { Identity } from '@daisy/auth';
import { silentLogger } from '../../server/test-loggers.test-support';
import {
  AGE_HOLD_COOKIE,
  AGE_HOLD_COOKIE_OPTIONS,
  createAgeStepHandler,
} from './age-step';
import { allowEvery } from '../../server/rate-limit.test-support';

setupRitewayBun();

const NOW = '2026-10-15T12:00:00.000Z';
const provisional: Identity = {
  state: 'provisional',
  principal: { kind: 'user', userId: 'user1', actorId: null },
};

const handlerWith = ({
  identity = provisional,
  forgets = 'deleted' as const,
}: {
  identity?: Identity;
  forgets?: 'deleted' | 'refused';
} = {}) => {
  const recorded: unknown[] = [];
  const forgotten: string[] = [];
  const handler = createAgeStepHandler({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => 'http://localhost:3000',
    identify: async () => identity,
    limiter: () => ({ consume: allowEvery }),
    clock: { now: () => NOW },
    termsVersion: 'draft-0',
    record: async (input) => {
      recorded.push(input);
      return 'recorded';
    },
    forget: async (userId) => {
      forgotten.push(userId);
      return forgets;
    },
  });
  return { handler, recorded, forgotten };
};

const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost:3000/api/account/age', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const answer = (year: number, month = 10) => ({ month, year, terms: true });

describe('POST /api/account/age', () => {
  test('an answer at or above the floor stores the month and the Terms', async () => {
    const { handler, recorded, forgotten } = handlerWith();
    const response = await handler(post(answer(2013)));
    assert({
      given: 'someone who turned 13 this month, under the member floor of 13',
      should:
        'record the birth month, the current Terms version and the server time, and delete nothing',
      actual: [response.status, await response.json(), recorded, forgotten],
      expected: [
        200,
        { recorded: 'recorded' },
        [
          {
            userId: 'user1',
            birthMonth: '2013-10',
            termsVersion: 'draft-0',
            now: NOW,
          },
        ],
        [],
      ],
    });
  });

  test('every under-18 band from 13 is admitted (decision 88)', async () => {
    const statuses = [];
    for (const year of [2013, 2011, 2010, 2009, 1990]) {
      const { handler } = handlerWith();
      statuses.push((await handler(post(answer(year)))).status);
    }
    assert({
      given: 'answers of exactly 13, 15, 16, 17 and an adult',
      should: 'record each',
      actual: statuses,
      expected: [200, 200, 200, 200, 200],
    });
  });

  test('under 13 stores nothing, forgets the account and holds the browser', async () => {
    const almost = handlerWith();
    const child = handlerWith();
    const almostAnswer = await almost.handler(post(answer(2013, 11)));
    const childAnswer = await child.handler(post(answer(2015)));
    assert({
      given: 'a 12-year-old a month from 13, and an 11-year-old',
      should:
        'refuse each as under 13, delete the provisional account, store nothing and set a day-long hold',
      actual: [
        almostAnswer.status,
        (await almostAnswer.json()).error.refusal,
        childAnswer.status,
        (await childAnswer.json()).error.refusal,
        almost.recorded.length + child.recorded.length,
        [...almost.forgotten, ...child.forgotten],
        almostAnswer.headers.get('set-cookie'),
      ],
      expected: [
        403,
        'under-13',
        403,
        'under-13',
        0,
        ['user1', 'user1'],
        `${AGE_HOLD_COOKIE}=under-13; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`,
      ],
    });
  });

  test('a browser holding the retired beta below-floor refusal answers again', async () => {
    const { handler, recorded, forgotten } = handlerWith();
    const response = await handler(
      post(answer(2012), `${AGE_HOLD_COOKIE}=below-floor`),
    );
    assert({
      given:
        'a 14-year-old whose browser still holds a day-old below-floor hold from the 16 floor',
      should: 'admit and record the answer, forgetting nothing',
      actual: [response.status, recorded.length, forgotten],
      expected: [200, 1, []],
    });
  });

  test('an account whose first answer stands is never refused again', async () => {
    const { handler, recorded } = handlerWith({ forgets: 'refused' });
    const conflict = async (response: Response) => [
      response.status,
      (await response.json()).error.code,
      response.headers.get('set-cookie'),
    ];
    const answers = [
      await conflict(await handler(post(answer(2018)))),
      await conflict(
        await handler(post(answer(1990), `${AGE_HOLD_COOKIE}=under-13`)),
      ),
    ];
    assert({
      given:
        'an account that already recorded an age (or just became a member) answering under 13, and the same from a held browser (review on #474)',
      should:
        'answer each with a conflict, no refusal page and no fresh hold, recording nothing, so the first answer stands',
      actual: [answers, recorded.length],
      expected: [
        [
          [409, 'CONFLICT', null],
          [409, 'CONFLICT', null],
        ],
        0,
      ],
    });
  });

  test('a held browser is refused and its new provisional account forgotten', async () => {
    const { handler, recorded, forgotten } = handlerWith();
    const response = await handler(
      post(answer(1990), `${AGE_HOLD_COOKIE}=under-13`),
    );
    assert({
      given:
        'an adult answer from a browser held after an under-13 refusal, signed in to a new provisional account (ISSUE-660)',
      should:
        'give the same refusal, record nothing and forget the new provisional account',
      actual: [
        response.status,
        (await response.json()).error.refusal,
        recorded.length,
        forgotten,
      ],
      expected: [403, 'under-13', 0, ['user1']],
    });
  });

  test('only a strict month, year and Terms acceptance, from an account without a username', async () => {
    const { handler, recorded } = handlerWith();
    const member = handlerWith({
      identity: {
        state: 'member',
        username: 'ada',
        principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
      },
    });
    const statuses = [
      (await handler(post({ ...answer(1990), terms: false }))).status,
      (await handler(post({ ...answer(1990), age: 30 }))).status,
      (await handler(post(answer(2027)))).status,
      (await member.handler(post(answer(1990)))).status,
    ];
    assert({
      given:
        'Terms not accepted, an extra age field, a birth month in the future, and a member',
      should: 'refuse each and store nothing',
      actual: [statuses, recorded.length + member.recorded.length],
      expected: [[400, 400, 400, 403], 0],
    });
  });
});

describe('the age hold cookie', () => {
  test('one definition serves the route and the form action', async () => {
    const { handler } = handlerWith();
    const header = (await handler(post(answer(2018)))).headers.get(
      'set-cookie',
    );
    assert({
      given:
        'the shared hold options (the form action passes them to cookies().set) and the route’s refusal',
      should:
        'be __Host-, Secure, httpOnly, Lax, one day at the root, and the route’s Set-Cookie should say exactly that',
      actual: [AGE_HOLD_COOKIE_OPTIONS, header],
      expected: [
        {
          path: '/',
          maxAge: 86_400,
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        },
        `${AGE_HOLD_COOKIE}=under-13; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`,
      ],
    });
  });
});
