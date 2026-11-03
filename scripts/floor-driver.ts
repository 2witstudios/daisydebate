import { readFileSync, statSync } from 'node:fs';
import { SQL } from 'bun';
import { approveBetaAccess } from '@daisy/db/testing';
import { speechesFor } from './floor-driver/format';
import { createHttpSession, signUpMember } from './floor-driver/http-session';
import {
  compareControl,
  deadlineCell,
  summarizeServerLog,
} from './floor-driver/report';
import { driveRound } from './floor-driver/round-driver';
import { startSystemSampler } from './floor-driver/system-sampler';
import {
  parseDriverArgs,
  readTarget,
  targetRefusals,
} from './floor-driver/target';
import { openBrowserSeats } from './floor-driver/browser-control';

/**
 * Drives N concurrent Rounds with no browser (FLOOR-3): real HTTP sessions,
 * rtc-node seats, real LiveKit and PostgreSQL. Prints one cell. Seats join but
 * publish no media, so this measures floor control and not media capacity.
 */
const args = parseDriverArgs(Bun.argv.slice(2));
const target = readTarget(process.env);
const refused = targetRefusals(target);
if (refused.length > 0) {
  for (const reason of refused) console.error(`refused: ${reason}`);
  process.exit(2);
}
const client = new SQL(target.databaseUrl, { max: 1 });
const [identity] = (await client`select current_database() as name`) as {
  name: string;
}[];
if (!identity || !/_(e2e|rig)$/.test(identity.name))
  throw new Error(
    `Connected database ${identity?.name} is not a test or a rig`,
  );

const httpRefusals = new Map<string, number>();
const refusedBy = (operation: string, status: number) => {
  const key = `${operation} ${status}`;
  httpRefusals.set(key, (httpRefusals.get(key) ?? 0) + 1);
};
const approve = async (email: string) => {
  const [row] = (await client`select id from users where email = ${email}`) as {
    id: string;
  }[];
  if (!row) throw new Error('No account for that address');
  await approveBetaAccess(client, row.id);
};
const member = async () => {
  const session = createHttpSession({
    origin: target.origin,
    refused: refusedBy,
  });
  await signUpMember({
    session,
    mailCaptureUrl: target.mailCaptureUrl,
    approve,
  });
  return session;
};
const pair = async () =>
  [
    { session: await member(), role: 'affirmative' as const },
    { session: await member(), role: 'negative' as const },
  ] as const;

// Sign-up is sequential so its rate limits do not count against the cell.
const pairs: Awaited<ReturnType<typeof pair>>[] = [];
for (let at = 0; at < args.n; at += 1) pairs.push(await pair());
const controlPair = args.control ? await pair() : null;
process.stderr.write(`signed up ${pairs.length * 2} members\n`);

const logOffsets = new Map(
  target.serverLogs.map((path) => [path, statSync(path).size]),
);
const startedAt = Date.now();
const stopAt = startedAt + args.maxMinutes * 60_000;
const samplesMs: number[] = [];
const failures: string[] = [];
let missed = 0;
let rounds = 0;
const enough = () =>
  samplesMs.length + missed >= args.deadlines || Date.now() >= stopAt;
const sampler = startSystemSampler(target.databaseUrl);
const progress = setInterval(() => {
  process.stderr.write(
    `${Math.round((Date.now() - startedAt) / 1000)}s deadlines=${samplesMs.length} missed=${missed} rounds=${rounds} failures=${failures.length}\n`,
  );
}, 30_000);
const loop = async (seats: (typeof pairs)[number]) => {
  while (!enough()) {
    rounds += 1;
    const failure = await driveRound({
      seats,
      target,
      args,
      speeches: speechesFor(
        Math.ceil((args.deadlines - samplesMs.length) / args.n),
      ),
      shouldStop: enough,
      deadline: (ms) => samplesMs.push(ms),
      miss: () => {
        missed += 1;
      },
    });
    if (failure) {
      failures.push(failure);
      if (failures.length > args.n * 5)
        throw new Error(`Too many Round failures: ${failure}`);
    }
  }
};
const browserMs: number[] = [];
const control = controlPair
  ? driveRound({
      seats: controlPair,
      target,
      args,
      speeches: 64,
      seatsHeldElsewhere: {
        open: (roundId) =>
          openBrowserSeats({
            origin: target.origin,
            roundId,
            profile: args.profile,
            seats: controlPair,
          }),
      },
      shouldStop: enough,
      deadline: (ms) => browserMs.push(ms),
      miss: () => {
        missed += 1;
      },
    })
  : null;
const loops = await Promise.allSettled(pairs.map(loop));
clearInterval(progress);
const controlFailure = control ? await control : null;
const system = await sampler.stop();
await client.close();
const readLogs = () =>
  [...logOffsets].flatMap(([path, offset]) =>
    readFileSync(path)
      .subarray(offset)
      .toString('utf8')
      .split('\n')
      .flatMap((line) => {
        if (!line.startsWith('{')) return [];
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      }),
  );
const report = {
  cell: deadlineCell({
    n: args.n,
    profile: args.profile,
    required: args.deadlines,
    samplesMs,
    missed,
  }),
  rounds,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  roundFailures: failures,
  loopFailures: loops.flatMap((loop) =>
    loop.status === 'rejected' ? [String(loop.reason)] : [],
  ),
  httpRefusalsSeen: Object.fromEntries(httpRefusals),
  system,
  server: target.serverLogs.length
    ? summarizeServerLog(readLogs())
    : 'not available: no FLOOR_SERVER_LOGS',
  control: controlPair
    ? {
        failure: controlFailure,
        ...compareControl({
          driverMs: samplesMs,
          browserMs,
          boundMs: args.controlBoundMs,
        }),
      }
    : 'not run',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.cell.valid && report.loopFailures.length === 0 ? 0 : 1);
