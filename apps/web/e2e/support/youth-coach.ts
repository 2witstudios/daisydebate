import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
} from '@playwright/test';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { origin, signUpMember, youthBirth } from './accounts';
import { expect } from './fixtures';

/** The broadcast seed process, run as its own Bun process against the e2e database. */
const seedYouthRound = async (
  input: Record<string, unknown>,
): Promise<unknown> => {
  const { stdout } = await promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'broadcast-seed-process.ts'),
      JSON.stringify(input),
    ],
    {
      cwd: resolve(import.meta.dirname, '../../../..'),
      env: process.env,
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout);
};

/**
 * A minor debating a live ranked Youth Round, and their school coach (ADR
 * 0155): the coach is `context`'s member, the student signs up in a context
 * of their own, which the caller closes, and `stop` ends the seeded Round.
 */
export const coachedYouthRound = async (
  browser: Browser,
  context: BrowserContext,
) => {
  const student = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const { username: studentName } = await signUpMember(
    student.request,
    youthBirth(systemClock.now()),
  );
  const { username: coachName } = await signUpMember(context.request);
  const tag = createId().slice(0, 8);
  const round = (await seedYouthRound({
    command: 'create',
    mode: 'ranked',
    visibility: 'public',
    division: 'youth',
    affUsername: studentName,
    title: `Thursday scrimmage ${tag}`,
    resolution: `Cities should ban cars ${tag}`,
  })) as { roundId: string; caption: string };
  await seedYouthRound({
    command: 'link-coach',
    coachUsername: coachName,
    studentUsername: studentName,
  });
  return {
    student,
    studentName,
    coachName,
    tag,
    round,
    stop: () => seedYouthRound({ command: 'stop', roundId: round.roundId }),
  };
};

/** The Round's floor, opened by a debater; its channel id. */
export const openFloor = async (
  request: APIRequestContext,
  roundId: string,
): Promise<string> => {
  const opened = await request.post(`/api/rounds/${roundId}/floor`, {
    headers: { origin },
    data: { version: 1, roundId },
  });
  expect(opened.ok()).toBe(true);
  const discovered = await request.get(`/api/rounds/${roundId}/floor`);
  expect(discovered.status()).toBe(200);
  return (await discovered.json()).channel.channelId;
};

/** One floor message, as `request`'s member; the response's status. */
export const postFloorMessage = async (
  request: APIRequestContext,
  roundId: string,
  channelId: string,
  text: string,
): Promise<number> =>
  (
    await request.post(`/api/rounds/${roundId}/floor/messages`, {
      headers: { origin },
      data: { version: 1, channelId, requestId: createId(), text },
    })
  ).status();
