import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { admitParticipants } from '@daisy/db/testing';

/**
 * The scripted tournament's frame (TAB-8.18): bots on a real database, an
 * injected clock, and stages run in order. A stage that is not wired yet
 * throws `StageNotWired`, so the script fails at its first unwired stage and
 * names it. Nothing waits on real time: the clock moves only when a stage
 * moves it.
 */

/** One person the script acts as: an admitted account with its actor. */
export type Bot = {
  readonly name: string;
  readonly userId: string;
  readonly actorId: string;
};

export class StageNotWired extends Error {
  constructor(readonly stage: string) {
    super(`not wired: ${stage}`);
  }
}

/** A clock the script owns. It starts at a fixed instant. */
export type ScriptClock = {
  readonly now: () => string;
  readonly advance: (minutes: number) => string;
};

export const scriptClock = (
  start = Date.UTC(2027, 2, 6, 8, 0),
): ScriptClock => {
  let at = start;
  return {
    now: () => new Date(at).toISOString(),
    advance: (minutes) => {
      at += minutes * 60_000;
      return new Date(at).toISOString();
    },
  };
};

/** Creates admitted accounts, each with a human actor, in one statement each. */
export const createBots = async (
  sql: SQL,
  names: readonly string[],
): Promise<readonly Bot[]> => {
  const bots = names.map((name) => ({
    name,
    userId: createId(),
    actorId: createId(),
  }));
  for (const bot of bots) {
    await sql`insert into users (id, username, email_verified, name) values (${bot.userId}, ${`bot-${bot.userId}`}, true, ${bot.name})`;
    await sql`insert into actors (id, kind, user_id) values (${bot.actorId}, 'human', ${bot.userId})`;
  }
  await admitParticipants(
    sql,
    bots.map((bot) => bot.userId),
  );
  return bots;
};

export type Stage<World> = {
  readonly name: string;
  readonly run: (world: World) => Promise<void>;
};

export type StageReport =
  | { readonly stage: string; readonly outcome: 'passed'; readonly ms: number }
  | {
      readonly stage: string;
      readonly outcome: 'not-wired' | 'failed';
      readonly ms: number;
      readonly detail: string;
    }
  | { readonly stage: string; readonly outcome: 'not-run' };

/**
 * Runs the stages in order and stops at the first that does not pass; the
 * stages after it are reported as not run, so the output shows how far a
 * tournament gets.
 */
export const runStages = async <World>(
  stages: readonly Stage<World>[],
  world: World,
): Promise<readonly StageReport[]> => {
  const reports: StageReport[] = [];
  let stopped = false;
  for (const stage of stages) {
    if (stopped) {
      reports.push({ stage: stage.name, outcome: 'not-run' });
      continue;
    }
    const started = performance.now();
    try {
      await stage.run(world);
      reports.push({
        stage: stage.name,
        outcome: 'passed',
        ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      stopped = true;
      reports.push({
        stage: stage.name,
        outcome: error instanceof StageNotWired ? 'not-wired' : 'failed',
        ms: Math.round(performance.now() - started),
        detail:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      });
    }
  }
  return reports;
};

/** The report as the PR shows it: one line per stage. */
export const reportLines = (reports: readonly StageReport[]): string =>
  reports
    .map((report) =>
      report.outcome === 'not-run'
        ? `  - ${report.stage}: not run`
        : report.outcome === 'passed'
          ? `  ✓ ${report.stage} (${report.ms} ms)`
          : `  ✗ ${report.stage}: ${report.outcome}\n${report.detail
              .split('\n')
              .slice(0, 6)
              .map((line) => `      ${line}`)
              .join('\n')}`,
    )
    .join('\n');
