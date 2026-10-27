import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { silentLogger } from '../../server/test-loggers.test-support';
import { AGE_HOLD_COOKIE, createAgeStepHandler } from './age-step';
import { allowEvery } from '../auth/abuse/limiter.test-support';

setupRitewayBun();

const NOW = '2026-10-15T12:00:00.000Z';
const provisional: Identity = {
  state: 'provisional',
  principal: { kind: 'user', userId: 'user1', actorId: null },
};

const handlerWith = ({
  identity = provisional,
  floor = 16 as const,
  forgets = 'deleted' as const,
}: {
  identity?: Identity;
  floor?: 13 | 16;
  forgets?: 'deleted' | 'refused';
} = {}) => {
  const recorded: unknown[] = [];
  const forgotten: string[] = [];
  const handler = createAgeStepHandler({
    logger: silentLogger,
    origin: () => 'http://localhost:3000',
    identify: async () => identity,
    limiter: () => ({ consume: allowEvery }),
    clock: { now: () => NOW },
    floor,
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
    const response = await handler(post(answer(2010)));
    assert({
      given: 'someone who turned 16 this month, under the beta floor of 16',
      should:
        'record the birth month, the current Terms version and the server time, and delete nothing',
      actual: [response.status, await response.json(), recorded, forgotten],
      expected: [
        200,
        { recorded: 'recorded' },
        [
          {
            userId: 'user1',
            birthMonth: '2010-10',
            termsVersion: 'draft-0',
            now: NOW,
          },
        ],
        [],
      ],
    });
  });

  test('below the floor stores nothing, forgets the account and holds the browser', async () => {
    const teen = handlerWith();
    const child = handlerWith();
    const teenAnswer = await teen.handler(post(answer(2010, 11)));
    const childAnswer = await child.handler(post(answer(2015)));
    assert({
      given: 'a 15-year-old and a 11-year-old under the beta floor',
      should:
        'refuse each with its own neutral reason, delete the provisional account, store nothing and set a day-long hold',
      actual: [
        teenAnswer.status,
        (await teenAnswer.json()).error.refusal,
        childAnswer.status,
        (await childAnswer.json()).error.refusal,
        teen.recorded.length + child.recorded.length,
        [...teen.forgotten, ...child.forgotten],
        teenAnswer.headers.get('set-cookie'),
      ],
      expected: [
        403,
        'below-floor',
        403,
        'under-13',
        0,
        ['user1', 'user1'],
        `${AGE_HOLD_COOKIE}=below-floor; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`,
      ],
    });
  });

  test('an under-age answer after an accepted one changes nothing', async () => {
    const { handler, recorded } = handlerWith({ forgets: 'refused' });
    const response = await handler(post(answer(2018)));
    assert({
      given:
        'an under-13 answer from an account that already recorded an age (or just became a member)',
      should:
        'answer a conflict with no refusal page, no hold and nothing recorded, so the first answer stands',
      actual: [
        response.status,
        (await response.json()).error.code,
        response.headers.get('set-cookie'),
        recorded.length,
      ],
      expected: [409, 'CONFLICT', null, 0],
    });
  });

  test('after the beta the floor is 13', async () => {
    const { handler, recorded } = handlerWith({ floor: 13 });
    const response = await handler(post(answer(2012)));
    assert({
      given: 'a 14-year-old once the floor is the product floor of 13',
      should: 'accept and record the answer',
      actual: [response.status, recorded.length],
      expected: [200, 1],
    });
  });

  test('a held browser is refused before anything is read or stored', async () => {
    const { handler, recorded, forgotten } = handlerWith();
    const response = await handler(
      post(answer(1990), `${AGE_HOLD_COOKIE}=under-13`),
    );
    assert({
      given: 'an adult answer from a browser held after an under-13 refusal',
      should: 'give the same refusal and touch nothing',
      actual: [
        response.status,
        (await response.json()).error.refusal,
        recorded.length + forgotten.length,
      ],
      expected: [403, 'under-13', 0],
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
