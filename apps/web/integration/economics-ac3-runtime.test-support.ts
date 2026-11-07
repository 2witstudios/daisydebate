import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { systemClock, systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createApp } from '../src/server/app';
import { roundWorkerDatabaseOptions } from '../src/server/round-worker-policy';
import { startRoundJudgingWorkers } from '../src/server/round-judging-workers';
import { startRoundAnalysisWorkers } from '../src/server/round-analysis-workers';
import { createProviderBudget } from '../src/server/provider-budget';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../src/features/messaging/beta-policy';
import { sampleRoundAnalysisReport } from '@daisy/protocol/round-analysis-testing';
import { withRoomRuntime } from './round-runtime.test-support';
import { fixtureBallot } from './round-judging.test-support';
import { observeDispatches } from './economics-ac3-observation.test-support';
import type { WorkerTimers } from '../src/lib/worker-timers';

const services = requireTestServices(process.env);
const nextToken = () => randomBytes(32).toString('base64url');
const judging = {
  scanBatch: 8,
  scanMs: 50,
  leaseMs: 15000,
  renewMs: 1000,
  callTimeoutMs: 5000,
  model: 'fixture/ac3-judge',
};
const analysis = {
  concurrency: 2,
  scanBatch: 8,
  scanMs: 50,
  leaseMs: 15000,
  callTimeoutMs: 5000,
  model: 'fixture/ac3-analysis',
};

export function manualWorkerTimers() {
  let next = 0;
  const tasks = new Map<number, () => Promise<void>>();
  const timers: WorkerTimers = {
    setInterval: (task) => {
      const id = ++next;
      tasks.set(id, task);
      return id;
    },
    clearInterval: (id) => {
      if (typeof id === 'number') tasks.delete(id);
    },
  };
  return {
    timers,
    pulse: async () => {
      await Promise.all([...tasks.values()].map((run) => run()));
    },
  };
}

export async function untilCommitted(
  pulse: () => Promise<void>,
  ready: () => Promise<boolean>,
  failures: readonly unknown[],
) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    if (failures.length)
      throw Error('Composed AC3 worker failed', { cause: failures[0] });
    await pulse();
    if (await ready()) return;
    await Bun.sleep(10);
  }
  throw Error('AC3 actual completion did not arrive inside its test bound');
}

/** Actual composed worker resources with controlled SDK responses; never paid or supplier-cost evidence. */
export async function withAc3Runtime(
  directory: string,
  work: (input: {
    readonly app: ReturnType<typeof createApp>;
    readonly fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
    readonly observer: ReturnType<typeof observeDispatches>;
    readonly judgeTimers: ReturnType<typeof manualWorkerTimers>;
    readonly analysisTimers: ReturnType<typeof manualWorkerTimers>;
    readonly failures: readonly unknown[];
    readonly instanceId: string;
    readonly limits: { readonly judging: number; readonly analysis: number };
    readonly role: string;
  }) => Promise<void>,
) {
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: `t3-${createId()}`,
      LOG_LEVEL: 'silent',
      OPENROUTER_API_KEY: 'controlled-ac3-noncredential',
      BILLING_ECONOMICS_DIRECTORY: directory,
      PREMIUM_BETA_GRANT: 'true',
      COMPETITIVE_PROVIDER_CONCURRENCY: '3',
      ROUND_JUDGING_POLICY: JSON.stringify(judging),
      ROUND_ANALYSIS_POLICY: JSON.stringify(analysis),
    },
    messagingPolicy: betaMessagingPolicy,
    clock: systemClock,
    ids: systemId,
    nextWorkerToken: nextToken,
    fetch: async (_url, init) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as { model?: unknown })
          : null;
      if (body?.model !== judging.model && body?.model !== analysis.model)
        throw Error('Unexpected controlled model');
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(
                body.model === judging.model
                  ? fixtureBallot(
                      'Controlled TEST economics workload, not vendor quality.',
                    )
                  : sampleRoundAnalysisReport,
              ),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
      });
    },
  });
  const pool = new SQL(services.databaseUrl, {
    max: 12,
    connection: {
      role: 'daisy_web',
      statement_timeout: 5000,
      lock_timeout: 2000,
    },
  });
  const observer = observeDispatches(performance.now);
  const voice = app.aiVoice();
  const observedVoice = {
    ...voice,
    complete: (input: Parameters<typeof voice.complete>[0]) =>
      observer.call(
        input.model === judging.model ? 'casual_ai_judge' : 'round_analysis',
        () => voice.complete(input),
      ),
  };
  try {
    const [identity] = await pool`select current_user as role`;
    await withRoomRuntime(
      async (fixture) => {
        const workerApp = {
          ...app,
          database: fixture.store,
          aiVoice: () => observedVoice,
          // AC2 owns transport qualification; this component never sends an external alert.
          reporter: { capture: () => undefined },
        };
        const judgeTimers = manualWorkerTimers(),
          analysisTimers = manualWorkerTimers(),
          failures: unknown[] = [];
        const reporter = {
          capture: (error: unknown) => {
            failures.push(error);
          },
        };
        const judgePolicy = app.config.ROUND_JUDGING_POLICY,
          analysisPolicy = app.config.ROUND_ANALYSIS_POLICY,
          limit = app.config.COMPETITIVE_PROVIDER_CONCURRENCY;
        if (!judgePolicy || !analysisPolicy || !limit)
          throw Error('Missing actual declared worker policy');
        const instanceId = createId();
        await fixture.store.renewServiceInstance({ instanceId, role: 'web' });
        let renewal = Promise.resolve();
        const heartbeat = setInterval(() => {
          renewal = renewal
            .then(() =>
              fixture.store.renewServiceInstance({ instanceId, role: 'web' }),
            )
            .then(
              () => undefined,
              (error) => {
                failures.push(error);
              },
            );
        }, 1000);
        const judges = startRoundJudgingWorkers({
          app: workerApp,
          policy: judgePolicy,
          budget: createProviderBudget(limit),
          parallel: limit,
          timers: judgeTimers.timers,
          reporter,
        });
        const analyses = startRoundAnalysisWorkers({
          app: workerApp,
          policy: analysisPolicy,
          timers: analysisTimers.timers,
          reporter,
        });
        try {
          await Promise.all([judges.started, analyses.started]);
          await work({
            app: workerApp,
            fixture,
            observer,
            judgeTimers,
            analysisTimers,
            failures,
            instanceId,
            limits: { judging: limit, analysis: analysisPolicy.concurrency },
            role: identity!.role,
          });
        } catch (error) {
          process.stdout.write(
            JSON.stringify({
              kind: 'AC3_PARTIAL_FAILURE_OBSERVATION',
              events: observer.events,
              judge: observer.facts('casual_ai_judge'),
              analysis: observer.facts('round_analysis'),
            }) + '\n',
          );
          throw error;
        } finally {
          clearInterval(heartbeat);
          await renewal;
          await Promise.all([judges.stop(), analyses.stop()]);
          await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
        }
      },
      { client: pool, ...roundWorkerDatabaseOptions(app.config, nextToken) },
    );
  } finally {
    await pool.close({ timeout: 0 });
    await app.close();
  }
}
