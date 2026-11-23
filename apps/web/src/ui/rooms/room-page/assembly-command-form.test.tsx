import { FormData as BrowserFormData } from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { createLocalCommandAction } from '../../../features/rooms/local-command-action';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './assembly-command-form.test-support';
import {
  accessibleWithin,
  renderAccessible,
} from '../../../test-support/rendered/accessible';
import { RetryRoomCommand } from './retry-room-command';

setupRitewayBun();

const original = {
  type: 'claim-seat',
  commandId: 'c'.repeat(24),
  expectedVersion: '3',
  seat: JSON.stringify({ kind: 'side', side: 'negative', slot: 0 }),
};

test('the retry of a room command posts exactly the original fields', () => {
  // The retry stands inside its command's form; the test gives it one.
  const view = renderAccessible(
    <form aria-label="Claim seat">
      <RetryRoomCommand
        values={{ ...original, $ACTION_ID_abc: '' }}
        pending={false}
      />
    </form>,
  );
  const inputs = [
    ...view.get('form', 'Claim seat').querySelectorAll('input'),
  ].map((input) => input as HTMLInputElement);
  const posted = inputs.map((input) => [input.name, input.value]);
  assert({
    given:
      'the fields of a claim whose answer was lost, with the action field React added to the post',
    should:
      'render each original field once, hidden, beside one retry button, and leave React its own field',
    actual: [
      Object.fromEntries(posted),
      posted.length,
      inputs.every((input) => input.type === 'hidden'),
      view.count('button'),
      view.has('button', 'Retry command'),
    ],
    expected: [original, 4, true, 1, true],
  });
  assert({
    given: 'the same retry while it is in flight',
    should: 'say so',
    actual: renderAccessible(
      <RetryRoomCommand values={original} pending />,
    ).has('button', 'Retrying…'),
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
  const shown = () => {
    const view = accessibleWithin(container as unknown as Element);
    return {
      control: view.has('button', 'Take seat'),
      retry: view.has('button', 'Retry command'),
      says: view.has('alert') ? view.text('alert') : null,
      signals: [...signals],
    };
  };
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

test('Ready, then Not ready, each hand keyboard focus back to the controls', async () => {
  const { act, createElement, root, container, browser, CommandFormHarness } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./assembly-command-form.test-support', import.meta.dir),
      {
        URL,
        URLSearchParams,
        FormData: BrowserFormData,
        performance,
        process: { env: { NODE_ENV: 'test' } },
      },
    );
  const action = createLocalCommandAction(
    {
      readSnapshot: () => ({ devicesPassed: true, pending: false }),
      ready: async () => {},
      unready: async () => {},
    },
    async (state) => state,
  );
  const sync = { accepted: () => {}, signal: () => {} };
  /** The one form instance the Ready control keeps across its toggle. */
  const show = (type: 'ready' | 'unready') =>
    act(async () =>
      root.render(
        createElement(CommandFormHarness, { action, sync, fields: { type } }),
      ),
    );
  /** Posts from the button, then leaves focus where a disabled control drops it. */
  const press = async () => {
    await act(async () => container.querySelector('button')!.click());
    const focused = browser.document.activeElement === fieldset();
    (browser.document.activeElement as { blur?: () => void } | null)?.blur?.();
    return focused;
  };
  const fieldset = () => container.querySelector('fieldset');
  try {
    await show('ready');
    const afterReady = await press();
    await show('unready');
    const afterUnready = await press();
    assert({
      given:
        'a keyboard user who presses Ready and then Not ready, both answered in the browser',
      should: 'return focus to the form’s controls after each answer',
      actual: [afterReady, afterUnready],
      expected: [true, true],
    });
  } finally {
    await act(async () => root.unmount());
  }
});
