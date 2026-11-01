import type { Window } from 'happy-dom';
import type { act as reactAct } from 'react';

export async function initiateConversationNavigation(
  win: Window,
  host: HTMLElement,
  scenario: string,
  act: typeof reactAct,
) {
  const document = win.document as unknown as Document;
  if (['edit', 'modified'].includes(scenario!)) {
    const edit = [...host.querySelectorAll('a')].find(
      (link) => link.textContent === 'Edit or remove your message',
    )!;
    await act(async () => {
      edit.dispatchEvent(
        new win.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: scenario === 'modified',
        }) as unknown as MouseEvent,
      );
    });
  }
  if (['new-tab', 'canceled', 'preferences'].includes(scenario!)) {
    const link = [...host.querySelectorAll('a')].find(
      (link) => link.textContent === 'Preferences',
    )!;
    await act(async () => {
      link.dispatchEvent(
        new win.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }) as unknown as MouseEvent,
      );
    });
  }
  if (
    [
      'search',
      'canceled-search',
      'invalid-search',
      'late-canceled-search',
    ].includes(scenario)
  ) {
    if (scenario === 'late-canceled-search')
      document.addEventListener('submit', (event) => event.preventDefault(), {
        once: true,
      });
    await act(async () => {
      host.querySelector('form')!.requestSubmit();
    });
  }
  if (scenario.startsWith('same-conversation')) {
    const earlier = [...host.querySelectorAll('a')].find(
      (link) => link.textContent === 'Earlier messages',
    )!;
    await act(async () => {
      earlier.dispatchEvent(
        new win.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }) as unknown as MouseEvent,
      );
    });
  }
}

export function readMountedComposer(host: HTMLElement) {
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  return {
    requestId: field.form!.querySelector<HTMLInputElement>(
      'input[name="requestId"]',
    )!.value,
    text: field.value,
    ready: !field.form!.querySelector<HTMLButtonElement>('button')!.disabled,
  };
}
