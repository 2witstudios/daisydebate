import { tryInstantMs } from '@daisy/clock';
/**
 * `bun season list | activate-beta | open | close`: opens and closes rating
 * seasons (ADR 0055). Seasons are run from an operator's terminal, never from
 * a route in `apps/web` (ADR 0043). Opening the first production season is a
 * human-only task (RATE-H.1).
 */
import { parseArgs } from 'node:util';
import { systemClock, systemId } from '@daisy/clock';
import { withSeasons, type SeasonRecord } from '@daisy/db/seasons';
import { isAppError } from '@daisy/errors';
import {
  idSchema,
  ratingDivisions,
  type RatingDivision,
} from '@daisy/protocol';

const usage = `usage:
  bun season list
  bun season activate-beta
  bun season open --name "<name>" --division <open|youth> [--starts <ISO 8601>]
  bun season close --id <seasonId> [--ends <ISO 8601>]`;

type NewSeason = {
  id: string;
  name: string;
  division: RatingDivision;
  startsAt: Date;
};

export type SeasonCommand =
  | { readonly kind: 'list' }
  /** Each division's Season 1 (ADR 0147), each with its own id. */
  | {
      readonly kind: 'activate-beta';
      readonly seasons: readonly {
        readonly id: string;
        readonly division: RatingDivision;
      }[];
    }
  | { readonly kind: 'open'; readonly season: NewSeason }
  | { readonly kind: 'close'; readonly id: string; readonly endsAt: Date }
  | { readonly kind: 'usage'; readonly message: string };

const INSTANT_WITH_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** An ISO 8601 instant with an offset, null when malformed, undefined when absent. */
const instant = (value: string | undefined): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (!INSTANT_WITH_SECONDS.test(value)) return null;
  const at = tryInstantMs(value);
  return at === undefined ? null : new Date(at);
};

/** The flags each command takes; any other flag is refused, never ignored. */
const allowedFlags: Readonly<Record<string, readonly string[]>> = {
  list: [],
  'activate-beta': [],
  open: ['name', 'division', 'starts'],
  close: ['id', 'ends'],
};

type Flags = {
  readonly command: string;
  readonly name: string | undefined;
  readonly division: RatingDivision | undefined;
  readonly id: string | undefined;
  readonly starts: Date | undefined;
  readonly ends: Date | undefined;
};

const validName = (name: string | undefined) =>
  name === undefined || (name.length > 0 && name.length <= 80);

/** The positional command and its validated flags, or null when malformed. */
function readFlags(argv: readonly string[]): Flags | null {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        name: { type: 'string' },
        division: { type: 'string' },
        id: { type: 'string' },
        starts: { type: 'string' },
        ends: { type: 'string' },
      },
    });
  } catch {
    return null;
  }
  const [command] = parsed.positionals;
  const name = parsed.values.name?.trim();
  const { id } = parsed.values;
  const division = ratingDivisions.find(
    (known) => known === parsed.values.division,
  );
  const starts = instant(parsed.values.starts);
  const ends = instant(parsed.values.ends);
  const allowed = allowedFlags[command ?? ''] ?? [];
  const valid =
    command !== undefined &&
    parsed.positionals.length === 1 &&
    Object.keys(parsed.values).every((flag) => allowed.includes(flag)) &&
    starts !== null &&
    ends !== null &&
    validName(name) &&
    (parsed.values.division === undefined || division !== undefined) &&
    (id === undefined || idSchema.safeParse(id).success);
  return valid ? { command, name, division, id, starts, ends } : null;
}

/**
 * Reads the command line. Pure: `now` and `newId` are the caller's clock and
 * id source, so a test pins both.
 */
export function parseSeasonCommand(
  argv: readonly string[],
  edge: { readonly now: string; readonly newId: () => string },
): SeasonCommand {
  const refusal: SeasonCommand = { kind: 'usage', message: usage };
  const flags = readFlags(argv);
  if (!flags) return refusal;
  const { command, name, division, id, starts, ends } = flags;
  if (command === 'list') return { kind: 'list' };
  if (command === 'activate-beta')
    return {
      kind: 'activate-beta',
      seasons: ratingDivisions.map((each) => ({
        id: edge.newId(),
        division: each,
      })),
    };
  if (command === 'open' && name && division)
    return {
      kind: 'open',
      season: {
        id: edge.newId(),
        name,
        division,
        startsAt: starts ?? new Date(edge.now),
      },
    };
  if (command === 'close' && id)
    return { kind: 'close', id, endsAt: ends ?? new Date(edge.now) };
  return refusal;
}

/**
 * How an operation's refusal reaches the operator: its code and message.
 * Never the stack, nor the cause chain, which carries the failed SQL and its
 * parameters. Null for anything else, which is left to fail loudly.
 */
export function refusalLine(error: unknown): string | null {
  return isAppError(error) ? `${error.code}: ${error.message}` : null;
}

const line = (season: SeasonRecord) =>
  [
    season.id,
    season.division,
    season.status,
    season.startsAt,
    season.endsAt ?? '-',
    season.name,
  ].join('\t');

async function main() {
  const command = parseSeasonCommand(Bun.argv.slice(2), {
    now: systemClock.now(),
    newId: () => systemId.next(),
  });
  if (command.kind === 'usage') {
    console.error(command.message);
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  await withSeasons(url, async (seasons) => {
    switch (command.kind) {
      case 'list':
        for (const season of await seasons.listSeasons())
          console.log(line(season));
        return;
      case 'activate-beta':
        for (const season of command.seasons)
          console.log(line(await seasons.activateBetaSeason(season)));
        return;
      case 'open':
        console.log(line(await seasons.openSeason(command.season)));
        return;
      case 'close':
        console.log(line(await seasons.closeSeason()));
    }
  });
}

if (import.meta.main)
  await main().catch((error: unknown) => {
    const refusal = refusalLine(error);
    if (refusal === null) throw error;
    console.error(refusal);
    process.exit(1);
  });
