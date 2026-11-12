import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { contextChatFormUnavailable, submitContextChatMessage } from './form';
import { contextChatIdle, contextChatUnacknowledged } from './form-state';
import { testChatContext } from './chat-context.test-support';

setupRitewayBun();
const roundId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);
const requestId = 'q'.repeat(24);
const nextId = 'n'.repeat(24);
const messageId = 'm'.repeat(24);
const draft = () => {
  const form = new FormData();
  form.set('text', 'Keep this draft');
  form.set('requestId', requestId);
  return form;
};
const scope = { ownerId: roundId, channelId };
const previous = contextChatIdle(requestId);
const lost = contextChatUnacknowledged(
  { text: 'Keep this draft', requestId },
  'Message could not be sent. Your draft is kept; try again.',
);
const message = {
  id: messageId,
  channelId,
  authorActorId: 'a'.repeat(24),
  sequence: 1,
  changeVersion: 2,
  text: 'Keep this draft',
  createdAt: '2026-11-07T00:00:00.000Z',
  editedAt: null,
};

describe('embedded Round chat send', () => {
  test('confirmed send', async () => {
    const requests: unknown[] = [];
    const answer = await submitContextChatMessage(
      testChatContext,
      async (url, init) => {
        requests.push([url, init.method, JSON.parse(String(init.body))]);
        return Response.json(message);
      },
      scope,
      previous,
      draft(),
      () => nextId,
    );
    assert({
      given: 'a confirmed chat send',
      should:
        'rotate the command and clear its draft without navigating the Round',
      actual: answer,
      expected: { kind: 'sent', messageId, requestId: nextId },
    });
    assert({
      given: 'the embedded form',
      should:
        'post its validated bound scope and stable command through the chat route',
      actual: requests,
      expected: [
        [
          `/api/rounds/${roundId}/floor/messages`,
          'POST',
          {
            version: 1,
            channelId,
            requestId,
            text: 'Keep this draft',
          },
        ],
      ],
    });
  });

  test('unknown commit', async () => {
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => {
        throw new Error('transport unavailable');
      },
      scope,
      previous,
      draft(),
      () => nextId,
    );
    assert({
      given: 'a send whose transport failed after possible commitment',
      should:
        'retain the exact text and command and prevent changing a retry payload',
      actual: answer,
      expected: lost,
    });
  });

  test('refusal after an unknown send', async () => {
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => new Response(null, { status: 429 }),
      scope,
      lost,
      draft(),
      () => nextId,
    );
    assert({
      given:
        'a retry refused temporarily while the original outcome remains unknown',
      should: 'keep its identity and payload locked until a confirmed result',
      actual: answer,
      expected: contextChatUnacknowledged(
        lost.values,
        'Please wait before sending again. Your draft is kept.',
      ),
    });
  });

  test('malformed successful response', async () => {
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => Response.json({ ...message, channelId: 'f'.repeat(24) }),
      scope,
      previous,
      draft(),
      () => nextId,
    );
    assert({
      given: 'an acknowledged body bound to a different channel',
      should: 'keep the draft as an unknown result rather than claim delivery',
      actual: answer,
      expected: lost,
    });
  });

  test('a pending-outcome command cannot change its text', async () => {
    let called = false;
    const edited = draft();
    edited.set('text', 'A different message');
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => {
        called = true;
        return Response.json(message);
      },
      scope,
      lost,
      edited,
      () => nextId,
    );
    assert({
      given: 'changed text on a command whose commitment remains unknown',
      should: 'keep the original retry payload and avoid another request',
      actual: [called, answer],
      expected: [
        false,
        contextChatUnacknowledged(
          lost.values,
          'Retry the original message before starting another one. Your draft is kept.',
        ),
      ],
    });
  });

  test('untrusted bound scope', async () => {
    let called = false;
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => {
        called = true;
        return Response.json(message);
      },
      { ...scope, ownerId: '../another' },
      previous,
      draft(),
      () => nextId,
    );
    assert({
      given: 'a forged bound Round identifier',
      should: 'refuse without calling a route and keep the typed draft',
      actual: [called, answer],
      expected: [
        false,
        {
          kind: 'refused',
          values: { text: 'Keep this draft', requestId },
          error: 'Message could not be sent. Your draft is kept; try again.',
        },
      ],
    });
  });
});
test('a canonical send retry can return a later edit of the committed message', async () => {
  const answer = await submitContextChatMessage(
    testChatContext,
    async () =>
      Response.json({
        ...message,
        text: 'Later canonical edit',
        changeVersion: 3,
      }),
    scope,
    lost,
    draft(),
    () => nextId,
  );
  assert({
    given:
      'a committed send edited on another device before its lost-response retry',
    should:
      'settle the valid canonical reply instead of keeping the command uncertain',
    actual: answer,
    expected: { kind: 'sent', messageId, requestId: nextId },
  });
});

describe('a chat send answers exactly one kind', () => {
  const answered = (status: number, earlier: unknown = previous) =>
    submitContextChatMessage(
      testChatContext,
      async () => new Response(null, { status }),
      scope,
      earlier,
      draft(),
      () => nextId,
    );
  test('refusals and lost answers', async () => {
    assert({
      given: 'a refusal, a server failure, and a refusal of a retry',
      should:
        'refuse a first attempt the server turned down, and hold any that may have committed as unacknowledged',
      actual: [
        (await answered(403)).kind,
        (await answered(500)).kind,
        (await answered(403, lost)).kind,
      ],
      expected: ['refused', 'unacknowledged', 'unacknowledged'],
    });
  });
  test('a call that never arrived', () => {
    assert({
      given: 'a form whose call failed in the browser',
      should: 'keep the whole command for its retry',
      actual: contextChatFormUnavailable(draft()),
      expected: lost,
    });
  });
  test('a previous answer the browser forged', async () => {
    let calls = 0;
    const answer = await submitContextChatMessage(
      testChatContext,
      async () => {
        calls += 1;
        return Response.json(message);
      },
      scope,
      { kind: 'unacknowledged', values: { requestId: 'forged', text: 7 } },
      draft(),
      () => nextId,
    );
    assert({
      given: 'an unacknowledged answer that names no real command',
      should: 'hold nothing back and send the posted message',
      actual: [calls, answer.kind],
      expected: [1, 'sent'],
    });
  });
});
