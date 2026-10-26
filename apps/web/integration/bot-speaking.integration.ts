import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createOpenRouter } from '@daisy/ai-voice';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotControl } from '../src/features/round-bots/control';
import { createProviderCapacity } from '../src/features/round-bots/provider-capacity';
import { createSpeakingBotControl } from '../src/features/round-bots/speaking';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import {
  hearRoundTracks,
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
      return Response.json({
        choices: [
          {
            message: {
              content: 'My first point stands. My second point follows it.',
            },
          },
        ],
        usage: { prompt_tokens: 13, completion_tokens: 9 },
      });
    },
  });
  const voice = createOpenRouter({
    apiKey: 'noncredential-loopback-fixture',
    fetch: (url, init) =>
      fetch(new URL(new URL(String(url)).pathname, server.url), init),
  });
  return { voice, paths, stop: () => server.stop(true) };
}
for (const mode of ['valid', 'provider-error'] as const)
  test(`actual bot speaking turn over own speech: ${mode}`, async () => {
    await withRoomRuntime(async (f) => {
      const { roundId, claim } = await ownSpeech(f);
      const deps = mediaDependencies(f);
      const media = createRoundMediaOperations(deps);
      const provider = loopbackProvider(mode);
      const capture = hearRoundTracks(
        f,
        deps,
        roundId,
        claim.scope.roundParticipantId,
      );
      let failures = 0;
      const timers = new Set<unknown>();
      const speaking = createSpeakingBotControl({
        store: f.store,
        voice: () => provider.voice,
        withProvider: createProviderCapacity(1),
        botToken: media.botToken,
        readActivity: f.redis.readBotActivity,
        readHeard: capture.heard,
        timers: {
          setInterval: (task, ms) => {
            const handle = setInterval(() => void task(), ms);
            timers.add(handle);
            return handle;
          },
          clearInterval: (handle) => {
            timers.delete(handle);
            clearInterval(handle as ReturnType<typeof setInterval>);
          },
        },
        nextId: createId,
        nowMs: () => Date.now(),
        callTimeoutMs: 10000,
        failed: () => {
          failures++;
        },
      });
      const receipts = createBotControl({
        claim,
        store: f.store,
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
        f.sql`select kind,requests,input_tokens,output_tokens,characters,configuration_snapshot->>'providerOutcome' outcome from agent_runs where round_participant_id=${claim.scope.roundParticipantId} and id<>${claim.scope.agentRunId} order by kind`;
      try {
        const pulsed = await seat.pulse();
        if (mode === 'valid')
          await waitForMediaFact(
            async () =>
              (await runs()).filter(
                (row) => row.kind === 'tts' && row.outcome === 'received',
              ).length === 2,
          );
        else await waitForMediaFact(async () => failures > 0);
        await seat.stop();
        const rows = (await runs()).map((row) => ({ ...row }));
        const [{ lines }] =
          await f.sql`select count(*)::int lines from utterances where round_id=${roundId}`;
        assert({
          given: `a real owned speech claim with a controlled loopback ${mode} vendor (not provider acceptance)`,
          should:
            mode === 'valid'
              ? 'settle one language and two TTS dispatches, publish the first phrase before voicing the second, and credit no transcript'
              : 'record the uncertain 503 dispatch at zero known usage, report one failure and keep the control receipt (ISSUE-458-r1)',
          actual: {
            receiptsArray: Array.isArray(pulsed),
            paths: provider.paths.map((path) => path.split('/').pop()),
            rows,
            lines,
            failures,
            speechTimer: timers.size,
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
                  lines: 0,
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
                  lines: 0,
                  failures: 1,
                  speechTimer: 0,
                },
        });
      } finally {
        await seat.stop();
        await provider.stop();
        await capture.close();
      }
    }, speakingOptions);
  });
