import { createId } from '@paralleldrive/cuid2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, openPage } from './support/fixtures';
import { readRoomBotRoster } from './support/ai-cast';
import { resetRateLimits, signUpMember, origin } from './support/accounts';
import { reread } from './support/room-launch-flow';

const withdrawGrant = (username: string) =>
  new Promise<void>((resolve, reject) =>
    execFile(
      'bun',
      [
        fileURLToPath(
          new URL(
            './support/withdraw-casual-ai-judge-process.ts',
            import.meta.url,
          ),
        ),
        username,
      ],
      { timeout: 20_000 },
      (error) =>
        error ? reject(new Error('Withdrawing the grant failed')) : resolve(),
    ),
  );

test('without JavaScript, a member without the casual AI judge practises with a person judging, and the server refuses the seat', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  try {
    await resetRateLimits(context.request);
    const { username } = await signUpMember(context.request);
    await withdrawGrant(username);
    const page = await openPage(context, 'Casual host without the AI judge');
    const roster = await readRoomBotRoster(page.request);
    const opponent = roster.find(
      (bot) => bot.label === 'Wren' && bot.seatRole === 'debater',
    );
    const judge = roster.find((bot) => bot.seatRole === 'judge');
    expect(opponent?.eligible).toBe(true);

    await page.goto(`/train?bot=${opponent!.actorId}`);
    await expect(
      page.getByText('AI judging on casual rounds is premium'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
    const roomId = new URL(page.url()).pathname.split('/').at(-1)!;

    const room = await reread(page.request, roomId);
    expect(room.participants.map((p) => [p.role, p.kind])).toEqual([
      ['negative', 'bot'],
    ]);
    expect(room.aiJudgeSeating).toBe('premium');
    await expect(
      page.getByText('Invite a person to judge instead'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Invite', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'AI judge', exact: true }),
    ).toHaveCount(0);

    const forged = await page.request.post(`/api/rooms/${roomId}/commands`, {
      headers: { origin },
      data: {
        type: 'assign-seat',
        commandId: createId(),
        expectedVersion: room.version,
        actorId: judge!.actorId,
        role: 'judge',
        slot: 0,
      },
    });
    expect(forged.status()).toBe(409);
    expect((await forged.json()).refusal).toBe('ai-judge-premium');
    expect((await reread(page.request, roomId)).version).toBe(room.version);
  } finally {
    await context.close();
  }
});
