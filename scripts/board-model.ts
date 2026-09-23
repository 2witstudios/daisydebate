/**
 * Pure argument handling and page edits for the `bun board:*` commands
 * (board.ts runs them against the pagespace CLI). Page text is edited as
 * raw lines, never stripped of markup, so placeholders such as
 * `debate:&lt;id&gt;:presence` survive.
 */

type RelatedRef = { readonly label: string; readonly id: string };
export type RelatedEntry = RelatedRef & { readonly title: string };

export type BoardCommand =
  | { readonly command: 'read'; readonly pageId: string }
  | {
      readonly command: 'status';
      readonly pageId: string;
      readonly status: string;
    }
  | {
      readonly command: 'relate';
      readonly pageId: string;
      readonly label: string;
      readonly target: string;
    }
  | {
      readonly command: 'create';
      readonly listId: string;
      /** Auto-number the title with this code prefix, e.g. ISSUE or DEC. */
      readonly prefix: string | undefined;
      readonly title: string;
      readonly criteria: readonly string[];
      readonly related: readonly RelatedRef[];
    }
  | {
      readonly command: 'replace';
      readonly pageId: string;
      readonly start: number;
      readonly end: number;
      readonly expectLines: number;
      readonly file: string;
      readonly oldFile: string | undefined;
    };

const BOARD_USAGE = [
  'bun board:read <pageId>',
  'bun board:status <taskPageId> <status-slug>',
  'bun board:relate <pageId> <Label> <targetPageId>',
  'bun board:create <taskListPageId> [--issue | --prefix <CODE>] --title "<Given X, should Y>" [--criterion "<Given A, should B>"]... [--related Label=<pageId>]...',
  'bun board:replace <pageId> --start N --end M --expect-lines L --file <new.html> [--old-file <old.html>]',
].join('\n');

const PAGE_ID = /^[a-z0-9]{20,32}$/;
const SLUG = /^[a-z][a-z0-9_-]*$/;

type Parsed = BoardCommand | { readonly error: string };

const fail = (error: string): Parsed => ({ error: `${error}\n${BOARD_USAGE}` });

function flagValues(args: readonly string[]) {
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--issue') switches.add(arg);
    else if (arg.startsWith('--')) {
      values.set(arg, [...(values.get(arg) ?? []), args[index + 1] ?? '']);
      index += 1;
    } else positional.push(arg);
  }
  return { values, positional, switches };
}

function parseRelated(entries: readonly string[]): RelatedRef[] | undefined {
  const refs = entries.map((entry) => {
    const at = entry.indexOf('=');
    return { label: entry.slice(0, at), id: entry.slice(at + 1) };
  });
  return refs.every((ref) => ref.label !== '' && PAGE_ID.test(ref.id))
    ? refs
    : undefined;
}

function parseCreate(args: readonly string[]): Parsed {
  const { values, positional, switches } = flagValues(args);
  const [listId] = positional;
  const title = values.get('--title')?.[0] ?? '';
  const related = parseRelated(values.get('--related') ?? []);
  if (!PAGE_ID.test(listId ?? '')) return fail('create needs a task list id');
  if (title.trim() === '') return fail('create needs --title');
  if (!related) return fail('--related takes Label=<pageId>');
  const prefix = values.get('--prefix')?.[0];
  if (prefix !== undefined && !/^[A-Z]{2,6}$/.test(prefix))
    return fail('--prefix takes 2-6 capital letters');
  return {
    command: 'create',
    listId,
    prefix: switches.has('--issue') ? 'ISSUE' : values.get('--prefix')?.[0],
    title: title.trim(),
    criteria: values.get('--criterion') ?? [],
    related,
  };
}

function parseReplace(args: readonly string[]): Parsed {
  const { values, positional } = flagValues(args);
  const number = (flag: string) => Number(values.get(flag)?.[0] ?? Number.NaN);
  const [pageId] = positional;
  const [start, end, expectLines] = [
    number('--start'),
    number('--end'),
    number('--expect-lines'),
  ];
  const file = values.get('--file')?.[0];
  const valid =
    PAGE_ID.test(pageId ?? '') &&
    [start, end, expectLines].every(Number.isInteger) &&
    start >= 1 &&
    end >= start &&
    file !== undefined;
  return valid
    ? {
        command: 'replace',
        pageId,
        start,
        end,
        expectLines,
        file,
        oldFile: values.get('--old-file')?.[0],
      }
    : fail(
        'replace needs a page id, --start, --end, --expect-lines and --file',
      );
}

const pageCommands: Readonly<
  Record<
    string,
    (pageId: string, rest: readonly string[]) => Parsed | undefined
  >
> = {
  read: (pageId, rest) =>
    rest.length === 0 ? { command: 'read', pageId } : undefined,
  status: (pageId, [status = '', ...extra]) =>
    SLUG.test(status) && extra.length === 0
      ? { command: 'status', pageId, status }
      : undefined,
  relate: (pageId, [label = '', target = '']) =>
    label !== '' && PAGE_ID.test(target)
      ? { command: 'relate', pageId, label, target }
      : undefined,
};

/** Done is granted from an independent review record, never by the agent. */
const DONE = 'completed';

export function parseBoardArgs(
  argv: readonly string[],
  autonomous = false,
): Parsed {
  const [command = '', first = '', ...rest] = argv;
  if (autonomous && command === 'status' && rest[0] === DONE)
    return fail(
      'An autonomous agent never marks a task Done: Done is granted from an independent review record, by the owner or the reviewing orchestrator.',
    );
  if (command === 'create') return parseCreate(argv.slice(1));
  if (command === 'replace') return parseReplace(argv.slice(1));
  const parsed = PAGE_ID.test(first)
    ? pageCommands[command]?.(first, rest)
    : undefined;
  return (
    parsed ?? fail(`Unknown or malformed board command: ${argv.join(' ')}`)
  );
}

export function findTask(
  list: {
    readonly tasks: readonly { readonly id: string; readonly pageId: string }[];
    readonly availableStatuses: readonly { readonly slug: string }[];
  },
  pageId: string,
):
  | { readonly taskId: string; readonly statuses: readonly string[] }
  | undefined {
  const task = list.tasks.find((candidate) => candidate.pageId === pageId);
  return (
    task && {
      taskId: task.id,
      statuses: list.availableStatuses.map((status) => status.slug),
    }
  );
}

/** One more than the highest `<PREFIX>-n` title; 1 for an empty list. */
export function nextCodeNumber(
  titles: readonly string[],
  prefix: string,
): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)\\b`);
  const numbers = titles
    .map((title) => pattern.exec(title)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  return Math.max(0, ...numbers) + 1;
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const relatedItem = (entry: RelatedEntry): string =>
  [
    '<li>',
    `${escapeHtml(entry.label)}: <a class="mention" data-mention-type="page" data-page-id="${entry.id}">@${escapeHtml(entry.title)}</a>`,
    '</li>',
  ].join('\n');

const RELATED_HEADING = '<h3>\nRelated pages\n</h3>';

export function leafBody(input: {
  readonly criteria: readonly string[];
  readonly related: readonly RelatedEntry[];
}): string {
  const criteria = input.criteria.flatMap((criterion) => [
    '<li>',
    escapeHtml(criterion),
    '</li>',
  ]);
  return [
    '<ul>',
    ...criteria,
    '</ul>',
    RELATED_HEADING,
    '<ul>',
    ...input.related.map(relatedItem),
    '</ul>',
  ].join('\n');
}

export function appendRelated(html: string, entry: RelatedEntry): string {
  const heading = html.lastIndexOf(RELATED_HEADING);
  const close =
    heading === -1
      ? -1
      : html.indexOf('</ul>', heading + RELATED_HEADING.length);
  if (close === -1)
    return `${html}\n${RELATED_HEADING}\n<ul>\n${relatedItem(entry)}\n</ul>`;
  return `${html.slice(0, close)}${relatedItem(entry)}\n${html.slice(close)}`;
}

/** Undefined when the replace is safe to send; otherwise why not. */
export function checkReplace(
  current: string,
  input: {
    readonly start: number;
    readonly end: number;
    readonly expectLines: number;
    readonly oldText?: string;
  },
): string | undefined {
  const lines = current.split('\n');
  if (lines.length !== input.expectLines)
    return `The page has ${lines.length} lines, not ${input.expectLines}: someone edited it. Read it again.`;
  if (input.end > lines.length)
    return `Lines ${input.start}-${input.end} are outside the page (${lines.length} lines).`;
  const old = lines.slice(input.start - 1, input.end).join('\n');
  const trim = (text: string) => text.replace(/\n$/, '');
  return input.oldText !== undefined && trim(old) !== trim(input.oldText)
    ? `Lines ${input.start}-${input.end} changed since you read them. Read the page again.`
    : undefined;
}
