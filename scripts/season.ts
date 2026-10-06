/**
 * `bun season list | open | close | rollover`: opens and closes rating
 * seasons (ADR 0055). Seasons are run from an operator's terminal, never from
 * a route in `apps/web` (ADR 0043). Opening the first production season is a
 * human-only task (RATE-H.1).
 */
import { parseArgs } from 'node:util';
import { systemClock, systemId } from '@daisy/clock';
import { withSeasons, type SeasonRecord } from '@daisy/db/seasons';
import { idSchema } from '@daisy/protocol';

const usage = `usage:
  bun season list
  bun season open --name "<name>" [--starts <ISO 8601>]
  bun season close --id <seasonId> [--ends <ISO 8601>]
  bun season rollover --name "<name>" [--starts <ISO 8601>]`;

type NewSeason = { id: string; name: string; startsAt: Date };

export type SeasonCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'open'; readonly season: NewSeason }
  | { readonly kind: 'close'; readonly id: string; readonly endsAt: Date }
  | { readonly kind: 'rollover'; readonly season: NewSeason }
  | { readonly kind: 'usage'; readonly message: string };

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Whether every calendar and clock component is real: `Date.parse` would
 * roll 2026-02-30 over to March 2 rather than refuse it.
 */
function realInstant(match: RegExpExecArray): boolean {
  const part = (index: number) => Number(match[index] ?? 0);
  const [year, month] = [part(1), part(2)];
  const bounds: ReadonlyArray<readonly [number, number, number]> = [
    [month, 1, 12],
    [part(3), 1, daysIn(year, month)],
    [part(4), 0, 23],
    [part(5), 0, 59],
    [part(6), 0, 59],
    [part(9), 0, 23],
    [part(10), 0, 59],
  ];
  return bounds.every(([value, low, high]) => value >= low && value <= high);
}

/** An ISO 8601 instant with an offset, null when malformed, undefined when absent. */
const instant = (value: string | undefined): Date | null | undefined => {
  if (value === undefined) return undefined;
  const match = ISO_INSTANT.exec(value);
  return match && realInstant(match) ? new Date(value) : null;
};

/** The flags each command takes; any other flag is refused, never ignored. */
const allowedFlags: Readonly<Record<string, readonly string[]>> = {
  list: [],
  open: ['name', 'starts'],
  rollover: ['name', 'starts'],
  close: ['id', 'ends'],
};

type Flags = {
  readonly command: string;
  readonly name: string | undefined;
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
    (id === undefined || idSchema.safeParse(id).success);
  return valid ? { command, name, id, starts, ends } : null;
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
  const { command, name, id, starts, ends } = flags;
  if (command === 'list') return { kind: 'list' };
  if ((command === 'open' || command === 'rollover') && name)
    return {
      kind: command,
      season: {
        id: edge.newId(),
        name,
        startsAt: starts ?? new Date(edge.now),
      },
    };
  if (command === 'close' && id)
    return { kind: 'close', id, endsAt: ends ?? new Date(edge.now) };
  return refusal;
}

const line = (season: SeasonRecord) =>
  [
    season.id,
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
      case 'open':
        console.log(line(await seasons.openSeason(command.season)));
        return;
      case 'close':
        console.log(line(await seasons.closeSeason(command)));
        return;
      case 'rollover': {
        const active = (await seasons.listSeasons()).find(
          ({ status }) => status === 'active',
        );
        if (!active) throw new Error('No active season to roll over');
        const { closed, opened } = await seasons.rolloverSeason({
          closeId: active.id,
          open: command.season,
        });
        console.log(line(closed));
        console.log(line(opened));
      }
    }
  });
}

if (import.meta.main) await main();
