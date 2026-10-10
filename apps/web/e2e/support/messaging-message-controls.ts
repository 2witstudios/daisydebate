import { openPage, test } from './fixtures';
import {
  openMessagingJourney,
  acceptMessagingJourney,
} from './messaging-journey';
import {
  expect,
  type Page,
  type BrowserContext,
  type Locator,
} from '@playwright/test';
import { effectsRan } from './hydration';
import { pressByKeyboard } from './focus';
import { expectNotInUrl } from './forms';
import { idSchema } from '@daisy/protocol';
import {
  manageNativeReactions,
  openRefusedMessageControls,
} from './messaging-reactions';
/** Both native modes edit a fresh own contribution, then remove it while posting is blocked. */
export async function editNativeMessage(page: Page, channelId: string) {
  const original = 'Temporary native cleanup contribution';
  const edited = 'Revised native cleanup contribution';
  await page.getByLabel('Your message').fill(original);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const row = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: original });
  await row
    .getByRole('link', { name: 'Edit or remove your message', exact: true })
    .click();
  await page.getByLabel('Revise your message').fill(edited);
  await page
    .getByRole('button', { name: 'Save message edit', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
  const updated = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: edited });
  await expect(updated).toHaveCount(1);
  await expect(messageInHistory(page, edited)).toHaveCount(1);
  await expect(updated).toContainText('edited');
  await expect(row).toHaveCount(0);
  const path = await updated
    .getByRole('link', { name: 'Edit or remove your message', exact: true })
    .getAttribute('href');
  if (path === null) throw new Error('Actual own message controls required');
  return { path, text: edited };
}
export async function removeNativeMessage(
  context: BrowserContext,
  channelId: string,
  message: { readonly path: string; readonly text: string },
) {
  const page = await openPage(
    context,
    'own-message cleanup while posting is blocked',
  );
  try {
    await page.goto(message.path);
    await page
      .getByRole('button', { name: 'Remove your message', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
    const history = page.getByRole('list', { name: 'Message history' });
    await expect(history.getByText(message.text, { exact: true })).toHaveCount(
      0,
    );
    await expect(history).toContainText('Message unavailable');
  } finally {
    await page.close();
  }
}

export function messageInHistory(page: Page, text: string) {
  return page
    .getByRole('list', { name: 'Message history' })
    .getByText(text, { exact: true });
}

/** A real pending action loses control focus; each settled answer owes its own notice. */
async function proveMessageControlFocus(
  page: Page,
  buttonName: string,
  failure: 'refusal' | 'transport',
  refusal?: {
    readonly refuse: () => Promise<void>;
    readonly recover: (buttonName: string) => Promise<void>;
  },
) {
  await effectsRan(page);
  const button = page.getByRole('button', { name: buttonName, exact: true });
  const form = button.locator('..').locator('xpath=ancestor-or-self::form');
  const requestId = await form.locator('input[name="requestId"]').inputValue();
  const intent = await messageControlIntent(form);
  const editor = page.getByLabel('Revise your message');
  const draft = 'Keyboard revision retained for retry';
  if (buttonName === 'Save message edit') await editor.fill(draft);
  await refusal?.refuse();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let started!: () => void;
      let release!: () => void;
      const posted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/*', async (route) => {
        if (
          route.request().method() !== 'POST' ||
          route.request().headers()['next-action'] === undefined
        )
          return route.continue();
        started();
        await held;
        return failure === 'transport'
          ? route.abort('internetdisconnected')
          : route.continue();
      });
      try {
        await pressByKeyboard(button);
        await posted;
        await expect(button).toBeDisabled();
      } finally {
        release();
      }
      const notice = form.getByRole('status');
      await expect(notice).toHaveText(
        buttonName.includes('message')
          ? 'Your message could not be changed. The text is kept; try again.'
          : 'Reaction could not be changed. Try again.',
      );
      await expect(button).toBeEnabled();
      await expect
        .poll(() =>
          notice.evaluate((element) => ({
            focused: document.activeElement === element,
            id: document.activeElement?.id,
            tag: document.activeElement?.tagName,
          })),
        )
        .toEqual({
          focused: true,
          id: await notice.getAttribute('id'),
          tag: 'P',
        });
      await expect(form.locator('input[name="requestId"]')).toHaveValue(
        requestId,
      );
      expect(await messageControlIntent(form)).toEqual(intent);
      if (buttonName === 'Save message edit') {
        await expect(editor).toHaveValue(draft);
        expectNotInUrl(page, draft);
      }
      await expect(
        page.getByRole('heading', { name: 'Something went wrong' }),
      ).toHaveCount(0);
      await page.unrouteAll({ behavior: 'wait' });
    }
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
  await refusal?.recover(buttonName);
  // The same retained intent succeeds once credentials/transport recover.
  await pressByKeyboard(button);
  await expect(page).not.toHaveURL(/\/message\?messageId=/);
  if (buttonName === 'Save message edit')
    await expect(messageInHistory(page, draft)).toHaveCount(1);
  else if (buttonName === 'Remove your message')
    await expect(
      page.getByRole('list', { name: 'Message history' }),
    ).toContainText('Message unavailable');
  else
    await expect(
      page.getByRole('button', {
        name: buttonName === 'React 👍' ? 'Remove 👍' : 'React 👍',
        exact: true,
      }),
    ).toBeVisible();
}

function messageControlIntent(form: Locator) {
  return form.locator('input[type="hidden"]').evaluateAll((inputs) =>
    inputs.map((input) => ({
      name: (input as HTMLInputElement).name,
      value: (input as HTMLInputElement).value,
    })),
  );
}

/** Registered in the dedicated native MSG suite, sharing its authenticated fixture. */
export function testMessageControlFocus() {
  for (const javaScriptEnabled of [true, false]) {
    test(`native message controls navigate with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, async ({
      browser,
    }) => {
      const journey = await openMessagingJourney(browser, javaScriptEnabled);
      try {
        const page = await acceptMessagingJourney(journey);
        const message = await editNativeMessage(page, journey.channelId);
        await manageNativeReactions(page, journey.channelId, message.text);
        await removeNativeMessage(
          journey.recipient,
          journey.channelId,
          message,
        );
      } finally {
        await journey.close();
      }
    });
  }
  for (const failure of ['refusal', 'transport'] as const) {
    for (const buttonName of [
      'Save message edit',
      'Remove your message',
      'React 👍',
      'Remove 👍',
    ]) {
      test(`keyboard ${buttonName} restores its own notice after ${failure}`, async ({
        browser,
      }) => {
        const refused =
          failure === 'refusal'
            ? await openRefusedMessageControls(browser)
            : undefined;
        const journey =
          refused?.journey ?? (await openMessagingJourney(browser));
        try {
          const page = refused?.page ?? (await acceptMessagingJourney(journey));
          const message = await seedControlMessage(page, journey.channelId);
          if (buttonName.includes('message')) await page.goto(message.path);
          else {
            await page.goto(
              `/messages/${journey.channelId}/reactions?messageId=${message.id}`,
            );
            if (buttonName === 'Remove 👍') {
              await page
                .getByRole('button', { name: 'React 👍', exact: true })
                .click();
              await expect(
                page.getByRole('button', { name: buttonName, exact: true }),
              ).toBeVisible();
            }
          }
          await proveMessageControlFocus(page, buttonName, failure, refused);
        } finally {
          await journey.close();
        }
      });
    }
  }
}

/** Setup uses the actual authenticated send route and this rendered composer's request ID. */
async function seedControlMessage(page: Page, channelId: string) {
  const requestId = await page
    .getByLabel('Your message')
    .locator('xpath=ancestor::form')
    .locator('input[name="requestId"]')
    .inputValue();
  const text = 'Keyboard message controls contribution';
  const response = await page.request.post('/api/messaging/messages', {
    headers: { origin: new URL(page.url()).origin },
    data: { version: 1, channelId, requestId, text },
  });
  expect(response.ok()).toBe(true);
  const id = idSchema.parse((await response.json()).id);
  return { id, text, path: `/messages/${channelId}/message?messageId=${id}` };
}
