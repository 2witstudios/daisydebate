import type { Browser } from '@playwright/test';
import { roomCastChoiceSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  assignSeat,
  claimSeat,
  createFoundationRoom,
  readBallotRound,
  readyOwnSeat,
  startAdmittedRound,
} from './human-ballot-round';
import { humanRoundSelection } from './human-round-selection';
import { checkIn, openSpeech, yieldSpeech } from './human-judged-journey';
import { botSpeechEvidence } from './bot-speech-evidence';

/** The shortest legal bot speech; the bot holds the floor until its clock ends. */
const BOT_SPEECH_MS = 60_000;

/**
 * One human affirmative against a stored bot negative, judged by a stored
 * AI judge, through the production worker path and the configured provider.
 * No fixture clock, maintenance callback, seeded run, transcript or ballot.
 */
export async function proveHumanBotJourney(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  try {
    const host = accounts.members[0]!;
    const catalog = await host.context.request.get('/api/rooms/catalog');
    expect(catalog.status()).toBe(200);
    const bots = (await catalog.json()).bots
      .map((bot: unknown) => roomCastChoiceSchema.parse(bot))
      .filter((bot: { eligible: boolean }) => bot.eligible);
    expect(bots.length).toBeGreaterThanOrEqual(2);
    let room = await createFoundationRoom(host, (choice) => {
      const selection = humanRoundSelection(choice, 1);
      return {
        ...selection,
        config: {
          ...selection.config,
          speechTiming: {
            ...selection.config.speechTiming,
            segmentDurationOverrides: { NC: BOT_SPEECH_MS },
          },
        },
      };
    });
    room = await claimSeat(host, room, { role: 'affirmative', slot: 0 });
    room = await assignSeat(host, room, {
      actorId: bots[0]!.actorId,
      role: 'negative',
      slot: 0,
    });
    room = await assignSeat(host, room, {
      actorId: bots[1]!.actorId,
      role: 'judge',
      slot: 0,
    });
    room = await readyOwnSeat(host, room, { role: 'affirmative', slot: 0 });
    let view = await startAdmittedRound(host, room);
    const first = await openSpeech(host.context.request, view, 0);
    await checkIn(host, first.view, first.open.id);
    view = await yieldSpeech(host, first.view, 'affirmative');
    const bot = await openSpeech(host.context.request, view, 1);
    expect(bot.open.durationMs).toBe(BOT_SPEECH_MS);
    await expect(async () => {
      const round = await readBallotRound(host.context.request, view.id);
      expect(round.status).toBe('completed');
      expect(['affirmative', 'negative']).toContain(round.outcome);
    }).toPass({ timeout: BOT_SPEECH_MS + 240_000 });
    const runs = await botSpeechEvidence(view.id);
    const received = (role: string, kind: string) =>
      runs.filter(
        (run) =>
          run.role === role &&
          run.kind === kind &&
          run.outcome === 'received' &&
          run.requests > 0,
      );
    expect(received('negative', 'speech').length).toBeGreaterThan(0);
    expect(
      received('negative', 'speech').every((run) => run.outputTokens > 0),
    ).toBe(true);
    expect(received('negative', 'tts').length).toBeGreaterThan(0);
    expect(received('negative', 'tts').every((run) => run.characters > 0)).toBe(
      true,
    );
    expect(received('judge', 'judging')).toHaveLength(1);
    expect(runs.filter((run) => run.role === 'affirmative')).toEqual([]);
    const receipt = await openPage(host.context, 'human/bot receipt');
    await receipt.goto(`/rounds/${view.id}`);
    await expect(
      receipt.getByText(/^Result · (Affirmative|Negative) won$/),
    ).toBeVisible();
  } finally {
    await accounts.closeContexts();
  }
}
