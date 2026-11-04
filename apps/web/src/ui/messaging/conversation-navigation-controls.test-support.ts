import type { Window } from 'happy-dom';
import type { act as reactAct } from 'react';

/** Clicks a real Link exactly as the browser dispatches it. */
async function clickLink(
  win: Window,
  host: HTMLElement,
  text: string,
  act: typeof reactAct,
  ctrlKey = false,
) {
  const link = [...host.querySelectorAll('a')].find(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? candidate.textContent) === text,
  )!;
  await act(async () => {
    link.dispatchEvent(
      new win.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey,
      }) as unknown as MouseEvent,
    );
  });
}

export async function initiateConversationNavigation(
  win: Window,
  host: HTMLElement,
  scenario: string,
  act: typeof reactAct,
) {
  if (['edit', 'modified'].includes(scenario))
    await clickLink(
      win,
      host,
      'Edit or remove your message',
      act,
      scenario === 'modified',
    );
  if (['new-tab', 'canceled', 'preferences'].includes(scenario))
    await clickLink(win, host, 'Preferences', act);
  if (['search', 'invalid-search'].includes(scenario)) {
    await act(async () => {
      host.querySelector('form')!.requestSubmit();
    });
  }
  if (
    scenario.startsWith('same-conversation') ||
    scenario === 'superseded-refusal'
  )
    await clickLink(win, host, 'Earlier messages', act);
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
