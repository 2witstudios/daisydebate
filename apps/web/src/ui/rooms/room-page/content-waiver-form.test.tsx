import {
  FormData as BrowserFormData,
  type HTMLInputElement as BrowserInput,
} from 'happy-dom';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './content-waiver-form.test-support';
import { idle } from '../../../features/forms/form-state';
import { CONTENT_WAIVER_VERSION } from '../../../features/legal/agreements';
import { findElements } from '../../test-support/find-elements';
import { ContentWaiverForm } from './content-waiver-form';

setupRitewayBun();

const tree = ContentWaiverForm({ action: async () => idle() });
const input = (name: string) =>
  findElements(
    tree,
    (element) => element.type === 'input' && element.props.name === name,
  )[0]?.props;

describe('the content waiver form', () => {
  test('a native post states the version and the tick', () => {
    assert({
      given: 'the form with no script',
      should: 'post the version and require the box',
      actual: [
        input('version')?.value,
        input('accepted')?.required,
        input('accepted')?.value,
      ],
      expected: [CONTENT_WAIVER_VERSION, true, 'yes'],
    });
  });

  test('it says it has not been reviewed', () => {
    const lede = findElements(
      tree,
      (element) =>
        typeof element.props.children === 'string' &&
        element.props.children.includes('has not been reviewed by counsel'),
    );
    assert({
      given: 'the waiver as a member reads it',
      should: 'say counsel has not reviewed it',
      actual: lede.length,
      expected: 1,
    });
  });
});

test('a waiver whose answer was lost stays on screen to be signed again', async () => {
  const { act, createElement, root, container, WaiverFormHarness } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./content-waiver-form.test-support', import.meta.dir),
      // What Next's navigation module and React's form posting read from the
      // realm. The waiver's links ask for idle time to prefetch, which never comes.
      {
        self: { setTimeout: () => 0, clearTimeout: () => {} },
        URL,
        URLSearchParams,
        FormData: BrowserFormData,
        performance,
        process: { env: { NODE_ENV: 'test' } },
      },
    );
  const signed = { version: CONTENT_WAIVER_VERSION, accepted: 'yes' };
  const posts: Record<string, string>[] = [];
  const signals: string[] = [];
  const action = async (
    _state: RoomFormState,
    form: FormData,
  ): Promise<RoomFormState> => {
    posts.push(
      Object.fromEntries(
        [...form.entries()].filter(([name]) => !name.startsWith('$ACTION_')),
      ) as Record<string, string>,
    );
    return { kind: 'unacknowledged', values: signed };
  };
  const sign = () =>
    act(async () => {
      const box = container.querySelector('input[name="accepted"]');
      if (box) (box as BrowserInput).checked = true;
      container.querySelector('button')!.click();
    });
  try {
    await act(async () =>
      root.render(
        createElement(WaiverFormHarness, {
          action,
          sync: {
            accepted: () => signals.push('accepted'),
            signal: () => signals.push('signal'),
          },
        }),
      ),
    );
    await sign();
    const lost = {
      waiver: container.textContent.includes('Read the waiver, version'),
      box: container.querySelector('input[name="accepted"]') !== null,
      button:
        container.querySelector('button[type="submit"]')?.textContent ?? null,
      says: container.querySelector('[role="alert"]')?.textContent ?? null,
      signals: [...signals],
    };
    await sign();
    assert({
      given: 'a signature whose answer was lost, then signed again',
      should:
        'keep the waiver, its box and its button, say the signature may have been recorded and that signing again is safe, ask room sync for a read, and post the signature again',
      actual: { lost, posts },
      expected: {
        lost: {
          waiver: true,
          box: true,
          button: 'Sign waiver',
          says: 'Your signature may have been recorded. Signing again is safe: a season’s waiver is signed once, however often it is sent.',
          signals: ['signal'],
        },
        posts: [signed, signed],
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});
