import { hostWaits } from '@daisy/worker/host';
import type { Waits } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createOpenRouter } from '@daisy/ai-voice';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotControl } from '../src/features/round-bots/control';
import {
  createProviderBudget,
  isProviderBudgetRefusal,
} from '../src/server/provider-budget';
import { createSpeakingBotControl } from '../src/features/round-bots/speaking';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import {
  mediaDependencies,
  waitForMediaFact,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);
const speakingOptions = {
  ...botControlOptions,
  botPublication: {
    ...botControlOptions.botPublication,
    ttsModel: 'explicit-tts',
    speechBudget: 30000,
  },
};
/** Controlled loopback vendor, not provider acceptance: one completion, short PCM per phrase. */
function loopbackProvider(mode: 'valid' | 'provider-error') {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (mode === 'provider-error') return new Response(null, { status: 503 });
      if (path.endsWith('/audio/speech'))
        return new Response(new Uint8Array(2400), {
          headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' },
        });
      // The answer streams, as the speaker asks for it: its text in pieces,
      // then the usage, then the end marker.
      const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
      return new Response(
        [
          ...['My first point stands. ', 'My second point ', 'follows it.'].map(
            (content) => event({ choices: [{ delta: { content } }] }),
          ),
          event({
            choices: [],
            usage: { prompt_tokens: 13, completion_tokens: 9 },
          }),
          'data: [DONE]\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const voice = createOpenRouter({
    apiKey: 'noncredential-loopback-fixture',
    waits: hostWaits,
    fetch: (url, init) =>
      fetch(new URL(new URL(String(url)).pathname, server.url), init),
  });
  return { voice, paths, stop: () => server.stop(true) };
}
/**
 * Host time that counts the waits still pending. Once `hold()` is true a new
 * wait ends only when its signal aborts: the provider-error case proves one
 * failure, so the retry pause after it never fires and cannot race the stop.
 */
function trackedWaits(hold: () => boolean) {
  const pending = new Set<Promise<void>>();
  const waitUntilMs = (dueMs: number, signal?: AbortSignal) => {
    const wait = hold()
      ? new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        })
      : hostWaits.waitUntilMs(dueMs, signal);
    pending.add(wait);
    void wait.finally(() => pending.delete(wait));
    return wait;
  };
  const waits: Waits = {
    nowMs: hostWaits.nowMs,
    waitUntilMs,
    sleep: (ms, signal) =>
      waitUntilMs(hostWaits.nowMs() + Math.max(0, ms), signal),
  };
  return { waits, pending };
}
for (const mode of ['valid', 'provider-error'] as const)
  test(`actual bot speaking turn over own speech: ${mode}`, async () => {
    await withRoomRuntime(async (f) => {
      const { roundId, claim } = await ownSpeech(f);
      const deps = mediaDependencies(f);
      const media = createRoundMediaOperations(deps);
      const provider = loopbackProvider(mode);
      let failures = 0;
      const time = trackedWaits(
        () => mode === 'provider-error' && failures > 0,
      );
      const speaking = createSpeakingBotControl({
        store: f.store,
        voice: () => provider.voice,
        withProvider: createProviderBudget(1),
        providerBusy: isProviderBudgetRefusal,
        botToken: media.botToken,
        listenToken: media.botListenToken,
        readPeers: media.botPeers,
        waits: time.waits,
        nextId: createId,
        nowMs: () => Date.now(),
        callTimeoutMs: 10000,
        reasoning: 'none',
        failed: () => {
          failures++;
        },
        hearingFailed: () => {
          failures++;
        },
        hearingObserved: () => undefined,
      });
      const receipts = createBotControl({
        claim,
        attendance: createAttendanceFeature({
          checkIns: f.store,
          evaluate: f.store.evaluateRoundAttendance,
          nextId: createId,
          instanceId: createId(),
        }),
        nextId: createId,
      });
      const seat = speaking(claim, receipts);
      const runs = (): Promise<Record<string, unknown>[]> =>
        f.sql`select kind,requests,input_tokens,output_tokens,characters,configuration_snapshot->>'providerOutcome' outcome from agent_runs where round_participant_id=${claim.scope.roundParticipantId} and id<>${claim.scope.agentRunId} order by kind, started_at`;
      try {
        const pulsed = await seat.pulse();
        if (mode === 'valid')
          await waitForMediaFact(
            async () =>
              (
                await f.sql`select 1 from utterances where round_id=${roundId} and complete`
              ).length === 2,
          );
        else await waitForMediaFact(async () => failures > 0);
        await seat.stop();
        // An aborted wait settles on the next turn; then none is left pending.
        await new Promise((resolve) => setImmediate(resolve));
        const rows = (await runs()).map((row) => ({ ...row }));
        const lines = (
          await f.sql`select text,complete,interrupted from utterances where round_id=${roundId} order by sequence`
        ).map((row: Record<string, unknown>) => ({ ...row }));
        assert({
          given: `a real owned speech claim with a controlled loopback ${mode} vendor (not provider acceptance)`,
          should:
            mode === 'valid'
              ? 'settle one language and two TTS dispatches, and author each phrase as one complete line with exactly its text (ADR 0122)'
              : 'record the uncertain 503 dispatch at zero known usage, report one failure and keep the control receipt (ISSUE-458-r1)',
          actual: {
            receiptsArray: Array.isArray(pulsed),
            paths: provider.paths.map((path) => path.split('/').pop()),
            rows,
            lines,
            failures,
            speechTimer: time.pending.size,
          },
          expected:
            mode === 'valid'
              ? {
                  receiptsArray: true,
                  paths: ['completions', 'speech', 'speech'],
                  rows: [
                    {
                      kind: 'speech',
                      requests: 1,
                      input_tokens: 13,
                      output_tokens: 9,
                      characters: 0,
                      outcome: 'received',
                    },
                    ...[
                      'My first point stands.',
                      'My second point follows it.',
                    ].map((text) => ({
                      kind: 'tts',
                      requests: 1,
                      input_tokens: 0,
                      output_tokens: 0,
                      characters: text.length,
                      outcome: 'received',
                    })),
                  ],
                  lines: [
                    'My first point stands.',
                    'My second point follows it.',
                  ].map((text) => ({
                    text,
                    complete: true,
                    interrupted: false,
                  })),
                  failures: 0,
                  speechTimer: 0,
                }
              : {
                  receiptsArray: true,
                  paths: ['completions'],
                  rows: [
                    {
                      kind: 'speech',
                      requests: 1,
                      input_tokens: 0,
                      output_tokens: 0,
                      characters: 0,
                      outcome: 'unknown',
                    },
                  ],
                  lines: [],
                  failures: 1,
                  speechTimer: 0,
                },
        });
      } finally {
        await seat.stop();
        await provider.stop();
      }
    }, speakingOptions);
  });
