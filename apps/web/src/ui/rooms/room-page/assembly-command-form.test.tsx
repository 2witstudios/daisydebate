import { FormData as BrowserFormData } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './assembly-command-form.test-support';
import { RetryRoomCommand } from './retry-room-command';

setupRitewayBun();

const original = {
  type: 'claim-seat',
  commandId: 'c'.repeat(24),
  expectedVersion: '3',
  role: 'negative',
  slot: '0',
};

test('the retry of a room command posts exactly the original fields', () => {
  const html = renderToStaticMarkup(
    <RetryRoomCommand
      values={{ ...original, $ACTION_ID_abc: '' }}
      pending={false}
    />,
  );
  const posted = [...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map(
    ([, name, value]) => [name, value],
  );
  assert({
    given:
      'the fields of a claim whose answer was lost, with the action field React added to the post',
    should:
      'render each original field once, hidden, beside one retry button, and leave React its own field',
    actual: [
      Object.fromEntries(posted),
      posted.length,
      html.includes('type="hidden"'),
      html.includes('>Retry command</button>'),
    ],
    expected: [original, 5, true, true],
  });
  assert({
    given: 'the same retry while it is in flight',
    should: 'say so',
    actual: renderToStaticMarkup(
      <RetryRoomCommand values={original} pending />,
    ).includes('Retrying…'),
    expected: true,
  });
});

test('a room command form whose answer was lost offers only the retry, then the answer of the retry', async () => {
  const { act, createElement, root, container, CommandFormHarness } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./assembly-command-form.test-support', import.meta.dir),
      // What Next's navigation module and React's form posting read from the realm.
      {
        URL,
        URLSearchParams,
        FormData: BrowserFormData,
        performance,
        process: { env: { NODE_ENV: 'test' } },
      },
    );
  const posts: Record<string, string>[] = [];
  const signals: string[] = [];
  const answers: RoomFormState[] = [
    { kind: 'unacknowledged', values: original },
    {
      kind: 'refused',
      values: original,
      error: 'The room changed. Review the latest room and try again.',
    },
  ];
  const action = async (_state: RoomFormState, form: FormData) => {
    posts.push(
      Object.fromEntries(
        [...form.entries()].filter(([name]) => !name.startsWith('$ACTION_')),
      ) as Record<string, string>,
    );
    return answers.shift()!;
  };
  const submit = () =>
    act(async () => {
      container.querySelector('button')!.click();
    });
  const shown = () => ({
    control: container.textContent.includes('Take seat'),
    retry: container.textContent.includes('Retry command'),
    says: container.querySelector('[role="alert"]')?.textContent ?? null,
    signals: [...signals],
  });
  try {
    await act(async () =>
      root.render(
        createElement(CommandFormHarness, {
          action,
          fields: original,
          sync: {
            accepted: () => signals.push('accepted'),
            signal: () => signals.push('signal'),
          },
        }),
      ),
    );
    await submit();
    const lost = shown();
    await submit();
    assert({
      given:
        'a seat claim whose answer was lost, then its retry, which the room refuses as changed',
      should:
        'replace the control with the retry and say the command may have been recorded, ask room sync for a read, post the same fields again, and then show the refusal with the control back',
      actual: { lost, posts, after: shown() },
      expected: {
        lost: {
          control: false,
          retry: true,
          says: 'This command may have been recorded. Retry it to find out: a recorded command is confirmed, not run twice.',
          signals: ['signal'],
        },
        posts: [original, original],
        after: {
          control: true,
          retry: false,
          says: 'The room changed. Review the latest room and try again.',
          signals: ['signal', 'signal'],
        },
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});
