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
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 instant with an offset, or undefined when absent. */
const instant = (value: string | undefined): Date | null | undefined => {
  if (value === undefined) return undefined;
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value)
    : null;
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
  const valid =
    command !== undefined &&
    parsed.positionals.length === 1 &&
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
