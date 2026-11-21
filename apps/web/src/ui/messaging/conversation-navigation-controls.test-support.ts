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
  );
  if (!link) throw new Error(`No link named "${text}" is mounted`);
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
      const form = host.querySelector('form');
      if (!form) throw new Error('No search form is mounted');
      form.requestSubmit();
    });
  }
  if (
    scenario.startsWith('same-conversation') ||
    scenario === 'superseded-refusal'
  )
    await clickLink(win, host, 'Earlier messages', act);
}

export function readMountedComposer(host: HTMLElement) {
  const field = host.querySelector<HTMLTextAreaElement>('textarea');
  const form = field?.form;
  const requestId = form?.querySelector<HTMLInputElement>(
    'input[name="requestId"]',
  );
  const button = form?.querySelector<HTMLButtonElement>('button');
  if (!field || !requestId || !button)
    throw new Error('No composer with a request id and a button is mounted');
  return {
    requestId: requestId.value,
    text: field.value,
    ready: !button.disabled,
  };
}
