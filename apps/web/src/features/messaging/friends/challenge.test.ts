import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCreateSchema } from '@daisy/protocol';
import { unequalTemplate as template } from '../../rooms/assembly.test-support';
import { challengeFriend } from './challenge';

setupRitewayBun();

const at = '2026-10-26T18:00:00.000Z';
const friendsOf = (friends: readonly string[]) => async () =>
  Response.json({
    version: 1,
    friends: friends.map((username) => ({ username, presence: 'online' })),
    incoming: [],
    outgoing: [{ username: 'eve', requestedAt: at }],
  });
const catalog = async () => Response.json({ choices: [template], bots: [] });
const formFor = (username: string) => {
  const form = new FormData();
  form.set('username', username);
  return form;
};

const run = async (
  username: string,
  friends: readonly string[],
  outcome: { next?: string; error?: string } = { next: '/rooms/r1' },
) => {
  const created: FormData[] = [];
  const answer = await challengeFriend({
    viewer: 'ada',
    form: formFor(username),
    commandId: 'c'.repeat(24),
    routes: { friends: friendsOf(friends), catalog: catalog as never },
    create: async (form) => {
      created.push(form);
      return { values: {}, ...outcome };
    },
  });
  return { answer, created };
};

test('challenging a friend opens an unlisted room for the pair', async () => {
  const { answer, created } = await run('bea', ['bea']);
  const form = created[0]!;
  assert({
    given: 'an accepted friend and the default template',
    should:
      'create an unlisted casual room named for both on that template, then move on to it',
    actual: [
      answer,
      form.get('title'),
      form.get('visibility'),
      form.get('commandId'),
      JSON.parse(String(form.get('selection'))),
      roomCreateSchema.safeParse({
        commandId: form.get('commandId'),
        title: form.get('title'),
        topic: form.get('topic'),
        visibility: form.get('visibility'),
        selection: JSON.parse(String(form.get('selection'))),
      }).success,
    ],
    expected: [
      { username: '', next: '/rooms/r1' },
      '@ada vs @bea',
      'unlisted',
      'c'.repeat(24),
      {
        kind: 'catalog',
        formatId: template.formatId,
        formatVersion: template.formatVersion,
        competitionType: 'casual',
        config: template.defaultConfig,
      },
      true,
    ],
  });
});

test('no room for anyone who is not a friend', async () => {
  const stranger = await run('zed', ['bea']);
  const pending = await run('eve', ['bea']);
  const malformed = await run('a b', ['bea']);
  assert({
    given: 'a stranger, a pending request and a malformed name',
    should: 'create nothing and answer the same unavailable notice',
    actual: [stranger, pending, malformed].map(({ answer, created }) => [
      answer.notice,
      created.length,
    ]),
    expected: [
      ['Could not open a challenge room. Try again.', 0],
      ['Could not open a challenge room. Try again.', 0],
      ['Could not open a challenge room. Try again.', 0],
    ],
  });
});

test('a refused room keeps its own words', async () => {
  const { answer } = await run('bea', ['bea'], {
    error: 'You are already in a room.',
  });
  assert({
    given: 'room creation refusing',
    should: 'answer its refusal as the notice',
    actual: answer,
    expected: { username: '', notice: 'You are already in a room.' },
  });
});
