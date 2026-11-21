import {
  admitParticipants,
  type SavepointTestDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';
import type { TournamentHttp } from './tab-tournament-transport.test-support';

/**
 * The scripted tournament's frame (TAB-8.18): bots on a real database, an
 * injected clock, and stages run in order. Required stages fail the gate by
 * name; stages explicitly assigned to a later slice remain pending. Nothing waits on real time: the clock moves only when a stage
 * moves it.
 */

/** One person the script acts as: an admitted account with its actor. */
export type Bot = {
  readonly name: string;
  readonly userId: string;
  readonly actorId: string;
};

/**
 * What every stage acts on: the store's database (each operation a savepoint of its test transaction,
 * under the web runtime role; the frame chooses commit or rollback), the
 * raw transaction for assertions, the clock and the bots, and what earlier
 * stages made.
 */
export type World = {
  readonly database: SavepointTestDatabase;
  readonly runtimeDatabaseUrl?: string;
  readonly http?: TournamentHttp;
  readonly sql: SQL;
  readonly clock: ScriptClock;
  readonly bots: Readonly<Record<string, Bot>>;
  readonly made: Map<string, string>;
};

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

export type Stage<World> =
  | { readonly name: string; readonly run: (world: World) => Promise<void> }
  | { readonly name: string; readonly pending: string };

export type StageReport =
  | { readonly stage: string; readonly outcome: 'passed'; readonly ms: number }
  | {
      readonly stage: string;
      readonly outcome: 'failed';
      readonly ms: number;
      readonly detail: string;
    }
  | { readonly stage: string; readonly outcome: 'not-run' }
  | {
      readonly stage: string;
      readonly outcome: 'pending';
      readonly slice: string;
    };

/**
 * Runs the stages in order and stops at the first that does not pass; the
 * required stages after it are reported as not run. Later-slice stages are
 * always named explicitly as pending and never counted as passed.
 */
export const runStages = async <World>(
  stages: readonly Stage<World>[],
  world: World,
): Promise<readonly StageReport[]> => {
  const reports: StageReport[] = [];
  let stopped = false;
  for (const stage of stages) {
    if ('pending' in stage) {
      reports.push({
        stage: stage.name,
        outcome: 'pending',
        slice: stage.pending,
      });
      continue;
    }
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
        outcome: 'failed',
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
      report.outcome === 'pending'
        ? `  - ${report.stage}: pending (${report.slice})`
        : report.outcome === 'not-run'
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
