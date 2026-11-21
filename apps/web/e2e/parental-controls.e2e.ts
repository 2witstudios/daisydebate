import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import {
  affirmativeSide,
  isNamedSeat,
  judgeSeat,
  negativeSide,
  sideSeat,
} from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import {
  birthAged,
  confirmSignIn,
  emailedLink,
  freshEmail,
  origin,
  resetRateLimits,
  signUpMember,
  uniqueName,
  youthBirth,
} from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import { claimUsername } from './support/forms';
import { settleLeftRounds } from './support/settle-left-round';
import { aiCast, readRoomBotRoster } from './support/ai-cast';
import {
  assignSeat,
  readyOwnSeat,
  startAdmittedRound,
} from './support/human-ballot-round';
import {
  claim,
  closeRoom,
  deniedCommand,
  reread,
  rosterSeatName,
  submitCreateRoom,
} from './support/room-launch-flow';

const flag = (state: 'enabled' | 'default') =>
  promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/release-flag-process.ts', import.meta.url),
      ),
      'parental-controls',
      state,
    ],
    { timeout: 20_000, maxBuffer: 4096 },
  );

test.beforeAll(async () => {
  await flag('enabled');
});
test.afterAll(async () => {
  await flag('default');
});

const agree = (form: ReturnType<Page['locator']>) =>
  form.getByLabel('I have read and agree to this notice.').check();

const childrenOf = (page: Page) =>
  page.getByRole('region', { name: 'Your children' });
const parentsOf = (page: Page) =>
  page.getByRole('region', { name: 'Linked parents and requests' });
const familyRow = (region: ReturnType<Page['locator']>, username: string) =>
  region.getByRole('listitem').filter({
    has: region
      .page()
      .getByRole('heading', { name: `@${username}`, exact: true }),
  });

test('a parent creates a child’s account and the child uses the emailed sign-in', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const parent = await signUpMember(page.request);
  await page.goto('/settings');
  const jump = page.getByLabel('Section', { exact: true });
  if (await jump.isVisible())
    await jump.selectOption('/settings/parental-controls');
  else
    await page
      .getByRole('link', { name: 'Parental controls', exact: true })
      .click();
  await page.getByText('Create a child’s account', { exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByLabel('Child’s email') });
  const email = freshEmail();
  const { year, month } = youthBirth(systemClock.now());
  await form.getByLabel('First name').fill('Sam');
  await form
    .getByLabel('Birth month and year')
    .fill(`${year}-${String(month).padStart(2, '0')}`);
  await form.getByLabel('Child’s email').fill(email);
  await agree(form);
  await form.getByRole('button', { name: 'Email my child' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `We emailed ${email}.` }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const child = await openPage(context, 'new child');
    await confirmSignIn(child, await emailedLink(page.request, email));
    await expect(
      child.getByRole('heading', { name: 'Your Daisy account' }),
    ).toBeVisible();
    await expect(child.getByLabel('Month', { exact: true })).toHaveCount(0);
    await child.getByLabel(/I agree to the Terms/).check();
    await child.getByRole('button', { name: 'Continue' }).click();
    await expect(child).toHaveURL(/\/onboarding\/lobby/);
    await child.getByRole('link', { name: 'Continue', exact: true }).click();
    const username = uniqueName('child');
    await claimUsername(child, username);
    await expect(child).toHaveURL(/\/onboarding\/passkey/);
    await child.goto('/settings/your-parents');
    await expect(
      familyRow(parentsOf(child), parent.username).getByText('Linked', {
        exact: true,
      }),
    ).toBeVisible();
    await child.goto('/play');
    await expect(child).toHaveURL(/\/play(?:$|\?)/);
    await page.reload();
    await expect(
      familyRow(childrenOf(page), username).getByText('Linked', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an existing child can privately confirm or refuse a link', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const parent = await signUpMember(page.request);
  await page.goto('/settings/parental-controls');
  for (const consent of ['confirm', 'refuse'] as const) {
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const child = await openPage(context, consent);
      const account = await signUpMember(
        child.request,
        youthBirth(systemClock.now()),
      );
      if (consent === 'confirm') {
        await page
          .getByText('Create a child’s account', { exact: true })
          .click();
        const form = page
          .locator('form')
          .filter({ has: page.getByLabel('Child’s email') });
        const { year, month } = youthBirth(systemClock.now());
        await form.getByLabel('First name').fill('Chris');
        await form
          .getByLabel('Birth month and year')
          .fill(`${year}-${String(month).padStart(2, '0')}`);
        await form.getByLabel('Child’s email').fill(account.email);
        await agree(form);
        await form.getByRole('button', { name: 'Email my child' }).click();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: `We emailed ${account.email}.` }),
        ).toBeVisible();
        await expect(familyRow(childrenOf(page), account.username)).toHaveCount(
          0,
        );
        await expect(async () => {
          const link = await emailedLink(page.request, account.email);
          expect(new URL(link).pathname).toBe('/settings/your-parents');
        }).toPass();
      } else {
        await page
          .getByText('Link an existing account', { exact: true })
          .click();
        const form = page
          .locator('form')
          .filter({ has: page.getByLabel('Child’s username') });
        await form.getByLabel('Child’s username').fill(account.username);
        await agree(form);
        await form.getByRole('button', { name: 'Ask to link' }).click();
        await expect(
          page.getByText('Request sent.', { exact: true }),
        ).toBeVisible();
      }
      await child.goto('/settings/your-parents');
      const request = familyRow(parentsOf(child), parent.username);
      if (consent === 'confirm') {
        await agree(request);
        await request
          .getByRole('button', { name: 'Yes, this is my parent' })
          .click();
        await expect(
          request.getByText('Linked', { exact: true }),
        ).toBeVisible();
      } else {
        await request
          .getByRole('button', { name: 'No, this isn’t my parent' })
          .click();
        await expect(request).toHaveCount(0);
      }
      await page.reload();
      const childRow = familyRow(childrenOf(page), account.username);
      await expect(
        childRow.getByText(consent === 'confirm' ? 'Linked' : 'Not confirmed', {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

test('a guardian clears a Guided hold, then Supervised locks messages and ranked entry and seats', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/rating-season-worker.ts', import.meta.url),
      ),
    ],
    { timeout: 20_000, maxBuffer: 4096 },
  );
  await resetRateLimits(page.request);
  const parent = await signUpMember(page.request);
  const childContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const peerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const child = await openPage(childContext, 'child with protection');
    const peer = await openPage(peerContext, 'unlinked youth peer');
    const youth = youthBirth(systemClock.now());
    const account = await signUpMember(child.request, youth);
    const peerAccount = await signUpMember(peer.request, youth);

    await page.goto('/settings/parental-controls');
    await page.getByText('Link an existing account', { exact: true }).click();
    const request = page
      .locator('form')
      .filter({ has: page.getByLabel('Child’s username') });
    await request.getByLabel('Child’s username').fill(account.username);
    await agree(request);
    await request.getByRole('button', { name: 'Ask to link' }).click();
    await expect(
      page.getByText('Request sent.', { exact: true }),
    ).toBeVisible();

    await child.goto('/settings/your-parents');
    const confirmation = familyRow(parentsOf(child), parent.username);
    await agree(confirmation);
    await confirmation
      .getByRole('button', { name: 'Yes, this is my parent' })
      .click();
    await expect(
      confirmation.getByText('Protection level: Guided'),
    ).toBeVisible();

    await page.goto('/friends');
    await page.getByLabel('Username').fill(account.username);
    await page.getByRole('button', { name: 'Send friend request' }).click();
    await expect(page.locator('#add-friend-notice')).toContainText(
      /friend request pending/i,
    );
    await child.goto('/friends');
    await expect(
      child.getByText('Waiting for your parent', { exact: true }),
    ).toBeVisible();
    await expect(
      child.getByRole('button', { name: `Accept @${parent.username}` }),
    ).toHaveCount(0);

    await page.goto('/notifications');
    await page
      .getByRole('main')
      .getByRole('link', {
        name: 'A friend request is waiting for your approval.',
      })
      .click();
    const waiting = page.getByRole('region', { name: 'Waiting for you' });
    await expect(waiting).toContainText(
      `@${parent.username} sent @${account.username} a friend request.`,
    );
    await waiting
      .getByRole('button', { name: 'Approve friend request' })
      .click();
    await expect(waiting).toContainText('No friend requests need approval.');
    await child.reload();
    const accept = child.getByRole('button', {
      name: `Accept @${parent.username}`,
    });
    await expect(accept).toBeVisible();
    await child
      .getByRole('button', { name: `Decline @${parent.username}` })
      .click();
    await expect(accept).toHaveCount(0);
    await expect(
      child
        .getByRole('region', { name: 'Your friends' })
        .getByText(`@${parent.username}`, { exact: true }),
    ).toHaveCount(0);

    const family = familyRow(childrenOf(page), account.username);
    const setLevel = async (level: 'Guided' | 'Supervised') => {
      await family
        .getByLabel(`Protection level for @${account.username}`)
        .selectOption(level.toLowerCase());
      await family
        .getByRole('button', { name: 'Save protection level' })
        .click();
      await expect(async () => {
        await child.goto('/settings/your-parents');
        await expect(
          child.getByText(`Protection level: ${level}`, { exact: true }),
        ).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
    };
    await setLevel('Supervised');

    await child.goto('/settings');
    const messaging = child.getByRole('form', { name: 'Message requests' });
    await expect(
      messaging.getByRole('radio', { name: 'Friends only' }),
    ).toBeChecked();
    await expect(
      messaging.getByRole('radio', { name: 'Everyone' }),
    ).toBeDisabled();
    const change = await child.request.post('/api/messaging/request-setting', {
      headers: { origin },
      data: { version: 1, setting: 'everyone' },
    });
    expect(change.status()).toBe(403);
    const dm = await peer.request.post('/api/messaging/requests/username', {
      headers: { origin },
      data: {
        version: 1,
        requestId: createId(),
        recipientUsername: account.username,
      },
    });
    expect(dm.status()).toBe(404);

    await child.goto('/friends');
    await child.getByLabel('Username').fill(peerAccount.username);
    await child.getByRole('button', { name: 'Send friend request' }).click();
    await expect(child.locator('#add-friend-notice')).toContainText(
      'Waiting for your parent.',
    );
    await peer.goto('/friends');
    await expect(
      peer.getByText('Friend request pending', { exact: true }),
    ).toBeVisible();
    await expect(
      peer.getByText('Waiting for your parent', { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(waiting).toContainText(
      `@${account.username} asked to be friends with @${peerAccount.username}.`,
    );
    await waiting
      .getByRole('button', { name: 'Decline friend request' })
      .click();
    await expect(waiting).toContainText('No friend requests need approval.');
    await peer.reload();
    await expect(
      peer.getByText('Friend request pending', { exact: true }),
    ).toHaveCount(0);

    await peer.goto('/play/room');
    const ranked = await submitCreateRoom(
      peer,
      `Ranked protection ${createId().slice(0, 8)}`,
      'freestyle',
      true,
    );
    try {
      await child.goto('/play/room');
      const creation = child.getByRole('form', { name: 'Create a room' });
      await creation
        .getByLabel('Room name', { exact: true })
        .fill('Supervised ranked entry');
      await creation
        .getByRole('checkbox', { name: 'Ranked', exact: true })
        .check();
      await creation
        .getByRole('button', { name: 'Create room', exact: true })
        .click();
      await expect(
        child.getByText(/Ranked rooms are unavailable right now/),
      ).toBeVisible();
      const denied = await deniedCommand(child.request, ranked, {
        type: 'claim-seat',
        seat: sideSeat(affirmativeSide),
      });
      expect(denied.status()).toBe(409);
      expect(await denied.json()).toMatchObject({
        refusal: 'ranked-unavailable',
      });
      await setLevel('Guided');
      const seated = await claim(child, ranked, 'Affirmative 1');
      const childSeat = seated.participants
        .filter(isNamedSeat)
        .find((participant) => participant.actorId !== ranked.hostActorId);
      if (!childSeat)
        throw new Error('The child did not take the ranked seat on Guided');
      await setLevel('Supervised');

      // A host can move a seated human. Use that normal entry point so the
      // refusal comes from protection rather than ordinary seat eligibility.
      const before = await reread(peer.request, ranked.id);
      const assigned = await deniedCommand(peer.request, before, {
        type: 'assign-seat',
        actorId: childSeat.actorId,
        seat: sideSeat(negativeSide),
      });
      expect(assigned.status()).toBe(409);
      expect(await assigned.json()).toMatchObject({
        refusal: 'ranked-unavailable',
      });
      expect((await reread(peer.request, ranked.id)).participants).toEqual(
        before.participants,
      );
    } finally {
      await closeRoom(peer.request, ranked.id);
    }
  } finally {
    await Promise.all([childContext.close(), peerContext.close()]);
  }
});

test('a linked guardian signs the media release and closes the child account from More', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const parent = await signUpMember(page.request);
  const childContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const outsiderContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const child = await openPage(childContext, 'linked child');
    const account = await signUpMember(
      child.request,
      youthBirth(systemClock.now()),
    );
    await page.goto('/settings/parental-controls');
    await page.getByText('Link an existing account', { exact: true }).click();
    const linkForm = page.locator('form').filter({
      has: page.getByLabel('Child’s username'),
    });
    await linkForm.getByLabel('Child’s username').fill(account.username);
    await agree(linkForm);
    await linkForm.getByRole('button', { name: 'Ask to link' }).click();
    const more = page.getByRole('link', {
      name: `More for @${account.username}`,
    });
    await expect(
      page.getByText('Request sent.', { exact: true }),
    ).toBeVisible();
    await expect(more).toHaveCount(0);

    await child.goto('/settings/your-parents');
    const request = familyRow(parentsOf(child), parent.username);
    await agree(request);
    await request
      .getByRole('button', { name: 'Yes, this is my parent' })
      .click();
    await expect(request.getByText('Linked', { exact: true })).toBeVisible();

    await page.reload();
    await more.click();
    await expect(
      page.getByRole('heading', { name: `More for @${account.username}` }),
    ).toBeVisible();
    const linkId = new URL(page.url()).pathname.split('/').at(-1);
    expect(linkId).toBeTruthy();
    const outsider = await openPage(outsiderContext, 'unlinked adult');
    await signUpMember(outsider.request);
    await outsider.goto(page.url());
    await expect(
      outsider.getByRole('heading', { name: 'Not found' }),
    ).toBeVisible();
    const rejected = await outsider.request.post(
      '/api/parental-controls/more',
      {
        headers: { origin },
        data: { type: 'close', linkId, confirmed: true },
      },
    );
    expect(rejected.status()).toBe(404);

    await page
      .getByText('Review and sign media release', { exact: true })
      .click();
    await page.getByLabel('Your full name').fill('Taylor Guardian');
    await page.getByLabel(/I am @.*parent or legal guardian/).check();
    await page.getByRole('button', { name: 'Sign release' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Media release signed.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText('A media release is on file.')).toBeVisible();

    const unconfirmed = await page.request.post('/api/parental-controls/more', {
      headers: { origin },
      data: { type: 'close', linkId, confirmed: false },
    });
    expect(unconfirmed.status()).toBe(400);
    await page.getByLabel(/I withdraw my consent and confirm/).check();
    await page
      .getByRole('button', { name: 'Withdraw consent and close account' })
      .click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Your child’s account was closed.' }),
    ).toBeVisible();
    await expect(more).toHaveCount(0);
    await child.goto('/settings/your-parents');
    await expect(child).toHaveURL(/\/sign-in(?:$|\?)/);
  } finally {
    await childContext.close();
    await outsiderContext.close();
  }
});

async function signPersonalWaiver(page: Page, roomId: string) {
  const view = await reread(page.request, roomId);
  const signature = await page.request.post('/api/agreements/content-waiver', {
    headers: { origin },
    data: { accepted: 'yes', version: view.contentWaiverVersion, roomId },
  });
  expect(signature.status()).toBe(200);
  return view;
}

test('a 14-year-old plays Youth and gets their guardian’s waiver to play Open ranked', async ({
  page: guardian,
  browser,
}) => {
  test.setTimeout(210_000);
  await promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/rating-season-worker.ts', import.meta.url),
      ),
    ],
    { timeout: 20_000 },
  );
  await resetRateLimits(guardian.request);
  const parent = await signUpMember(guardian.request);
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const youthPeerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const rooms: { readonly page: Page; readonly id: string }[] = [];
  try {
    const child = await openPage(context, '14-year-old debater');
    const player = await signUpMember(
      child.request,
      birthAged(systemClock.now(), 14),
    );
    const token = createId().slice(0, 8);

    await child.goto('/play/room');
    const youth = await submitCreateRoom(
      child,
      `Youth ${token}`,
      'freestyle',
      true,
    );
    rooms.push({ page: child, id: youth.id });
    expect(youth.ageRule).toBe('under-18');
    const youthHost = { context, username: player.username };
    const youthSeated = await claim(child, youth, 'Affirmative 1');
    const youthPeer = await openPage(youthPeerContext, 'Youth opponent');
    const youthOpponent = await signUpMember(
      youthPeer.request,
      birthAged(systemClock.now(), 15),
    );
    const { aiJudge } = aiCast({
      bots: await readRoomBotRoster(child.request),
    });
    await assignSeat(youthHost, youthSeated, {
      seat: judgeSeat(),
      actorId: aiJudge.actorId,
    });
    await youthPeer.goto(`/rooms/${youth.id}`);
    await claim(
      youthPeer,
      await reread(youthPeer.request, youth.id),
      'Negative 1',
    );
    await readyOwnSeat(
      { context: youthPeerContext, username: youthOpponent.username },
      await signPersonalWaiver(youthPeer, youth.id),
      sideSeat('negative'),
    );
    const youthReady = await readyOwnSeat(
      youthHost,
      await signPersonalWaiver(child, youth.id),
      sideSeat('affirmative'),
    );
    const youthRound = await startAdmittedRound(youthHost, youthReady);
    expect(
      youthRound.participants.some(
        (seat) => 'actorId' in seat && seat.actorId === youthSeated.hostActorId,
      ),
    ).toBe(true);
    rooms.pop();
    await settleLeftRounds([
      youthHost,
      { context: youthPeerContext, username: youthOpponent.username },
    ]);

    await guardian.goto('/play/room');
    const open = await submitCreateRoom(
      guardian,
      `Open ${token}`,
      'freestyle',
      true,
    );
    rooms.push({ page: guardian, id: open.id });
    expect(open.ageRule).toBe('adults');
    const negative = rosterSeatName(open, 'Negative 1');
    await child.goto(`/rooms/${open.id}`);
    await expect(
      child.getByRole('button', { name: `Take ${negative}`, exact: true }),
    ).toHaveCount(0);
    const refused = await deniedCommand(child.request, open, {
      type: 'claim-seat',
      seat: sideSeat('negative'),
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ refusal: 'other-division' });

    await guardian.goto('/settings/parental-controls');
    await guardian
      .getByText('Link an existing account', { exact: true })
      .click();
    const linkForm = guardian
      .locator('form')
      .filter({ has: guardian.getByLabel('Child’s username') });
    await linkForm.getByLabel('Child’s username').fill(player.username);
    await agree(linkForm);
    await linkForm.getByRole('button', { name: 'Ask to link' }).click();
    await expect(
      guardian.getByText('Request sent.', { exact: true }),
    ).toBeVisible();

    await child.goto('/settings/your-parents');
    const parentRow = familyRow(parentsOf(child), parent.username);
    await agree(parentRow);
    await parentRow
      .getByRole('button', { name: 'Yes, this is my parent' })
      .click();
    await parentRow.getByLabel('Adult lobby').selectOption(open.lobbyId);
    await parentRow.getByRole('button', { name: 'Ask to play' }).click();
    await expect(
      parentRow.getByText(/Open.*Waiting for approval/),
    ).toBeVisible();

    await guardian.reload();
    const childRow = familyRow(childrenOf(guardian), player.username);
    await childRow.getByText(/^Ranked content waiver \(/).click();
    await expect(
      childRow.getByText(
        /^Daisy owns what is said and shown by adult debaters/,
      ),
    ).toBeVisible();
    await expect(
      childRow.getByText(
        /a separate media release covering every youth debater/,
      ),
    ).toBeVisible();
    await childRow
      .getByRole('checkbox', { name: /I sign this waiver for my child/ })
      .check();
    await childRow
      .getByRole('button', { name: 'Sign waiver and allow Open' })
      .click();
    await expect(childRow.getByText(/Open.*Allowed/)).toBeVisible();

    const setProtection = async (level: 'supervised' | 'guided') => {
      await childRow
        .getByLabel(`Protection level for @${player.username}`)
        .selectOption(level);
      await childRow
        .getByRole('button', { name: 'Save protection level' })
        .click();
      await expect(async () => {
        await child.goto('/settings/your-parents');
        await expect(
          parentRow.getByText(
            `Protection level: ${level === 'guided' ? 'Guided' : 'Supervised'}`,
          ),
        ).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
    };
    await setProtection('supervised');
    const supervised = await deniedCommand(
      child.request,
      await reread(child.request, open.id),
      {
        type: 'claim-seat',
        seat: sideSeat('negative'),
      },
    );
    expect(supervised.status()).toBe(409);
    expect(await supervised.json()).toMatchObject({
      refusal: 'ranked-unavailable',
    });
    await setProtection('guided');

    const host = { context: guardian.context(), username: parent.username };
    const withHost = await claim(
      guardian,
      await reread(guardian.request, open.id),
      'Affirmative 1',
    );
    await assignSeat(host, withHost, {
      seat: judgeSeat(),
      actorId: aiJudge.actorId,
    });

    await child.reload();
    await expect(parentRow.getByText(/Open.*Allowed/)).toBeVisible();
    await child.goto(`/lobby?lobby=${open.lobbyId}&q=${token}&view=rooms`);
    await child
      .getByRole('link', { name: `Join: ${open.title}`, exact: true })
      .click();
    const seated = await claim(
      child,
      await reread(child.request, open.id),
      'Negative 1',
    );
    expect(seated.contentWaiver).toBe('signed');
    const childActor = seated.participants.find(
      (seat) => isNamedSeat(seat) && seat.label === player.username,
    );
    if (!childActor || !isNamedSeat(childActor))
      throw new Error('The child’s seat is missing');
    await readyOwnSeat(
      { context, username: player.username },
      seated,
      sideSeat('negative'),
    );

    const hostView = await signPersonalWaiver(guardian, open.id);
    const ready = await readyOwnSeat(host, hostView, sideSeat('affirmative'));
    const round = await startAdmittedRound(host, ready);
    rooms.pop();
    expect(
      round.participants.some(
        (seat) => 'actorId' in seat && seat.actorId === childActor.actorId,
      ),
    ).toBe(true);
  } finally {
    await settleLeftRounds([
      { context: guardian.context(), username: parent.username },
    ]);
    for (const room of rooms) await closeRoom(room.page.request, room.id);
    await Promise.all([context.close(), youthPeerContext.close()]);
  }
});
