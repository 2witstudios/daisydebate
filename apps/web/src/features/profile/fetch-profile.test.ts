import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fetchProfile } from './fetch-profile';

setupRitewayBun();

const profile = {
  version: 1,
  username: 'debater-a',
  memberSince: '2026-09-01T00:00:00.000Z',
  me: false,
  record: { wins: 0, losses: 0, draws: 0 },
  history: [],
  nextBefore: null,
};

const answering = (response: () => Response) => {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      return response();
    },
  };
};

describe('fetchProfile', () => {
  test('a profile', async () => {
    const { fetch, urls } = answering(() => Response.json(profile));
    const read = await fetchProfile(fetch, 'debater-a', {
      before: 'r'.repeat(24),
    });
    assert({
      given: 'a well-formed profile answer for an older page',
      should: 'ask for that page and return the profile',
      actual: [urls, read],
      expected: [
        [`/api/profiles/debater-a?before=${'r'.repeat(24)}`],
        { kind: 'found', profile },
      ],
    });
  });

  test('every other answer', async () => {
    const kinds = await Promise.all(
      [
        () => new Response(null, { status: 404 }),
        () => new Response(null, { status: 400 }),
        () => new Response(null, { status: 503 }),
        () => Response.json({ ...profile, rating: 1500 }),
        () => {
          throw new Error('network');
        },
      ].map(async (response) => {
        const read = await fetchProfile(
          answering(response).fetch,
          'debater-a',
          {},
        );
        return read.kind;
      }),
    );
    assert({
      given: 'a 404, a 400, a 503, an off-contract body and a network failure',
      should: 'name each without trusting the body',
      actual: kinds,
      expected: [
        'missing',
        'invalid',
        'unavailable',
        'unavailable',
        'unavailable',
      ],
    });
  });
});
