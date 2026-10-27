#!/usr/bin/env bun
/**
 * `bun progress:sync [--apply]`: renders the drive's Project Status canvas
 * from the Score blocks on the Product intent area pages, plus a Now section
 * of the open PRs. A dry run exits 1 only when the scores drifted (a stale
 * Now section is reported, not failed); --apply writes the canvas through the
 * board writer's content-hash check and reads it back. Scores are edited on
 * the area pages, never on the canvas.
 *
 * A Score block is an `<h3>Score: <Area></h3>` followed directly by a table
 * whose rows are `Field | Value | Evidence`: Category, Subtitle, Features,
 * Stable, Hardened, Scale, Spec (0-100 or n/a, at least one scored), Status
 * and an optional Tag. A Score heading it cannot read throws rather than
 * dropping the area.
 */
import { escapeHtml as escape } from './board-model';
import { liveBoardDeps, writePage } from './board';
import { DAISY_DEBATE_DRIVE_ID } from './pagespace-docs';

const PROJECT_STATUS_ID = 'qndsohpp7nihje7a2dw3a2kl';
const PRODUCT_INTENT_ID = 'duob5mufa4ie0pimv0sbwvg5';
const REPOSITORY = '2witstudios/daisydebate';

const CATEGORIES = [
  { name: 'Competition', tag: 'core' },
  { name: 'AI', tag: undefined },
  { name: 'Social', tag: undefined },
  { name: 'Accounts & access', tag: undefined },
  { name: 'Platform', tag: undefined },
  { name: 'Business & legal', tag: undefined },
] as const;

const DIMENSIONS = ['Features', 'Stable', 'Hardened', 'Scale', 'Spec'] as const;

export type Area = {
  readonly name: string;
  readonly pageId: string;
  readonly category: string;
  readonly subtitle: string;
  /** Features, Stable, Hardened, Scale, Spec; undefined is n/a. */
  readonly scores: readonly (number | undefined)[];
  readonly status: string;
  readonly tag: string | undefined;
};

export type OpenPr = {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
  '#39': "'",
  nbsp: ' ',
};

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#x27|#39|amp|lt|gt|quot|nbsp);/g,
      (_, name: string) => ENTITIES[name],
    )
    .replace(/\s+/g, ' ')
    .trim();

/** Every Score block on one area page; a malformed block throws. */
export function parseScoreBlocks(
  html: string,
  page: { readonly id: string; readonly title: string },
): readonly Area[] {
  // Each h3 on its own, so a heading never runs into the next one.
  const headings = [
    ...html.matchAll(/<h3[^>]*>((?:(?!<\/h3>)[\s\S])*)<\/h3>/g),
  ].filter(([, heading]) => text(heading).startsWith('Score:'));
  return headings.map((match) => {
    const name = text(match[1]).slice('Score:'.length).trim();
    if (name === '')
      throw new Error(
        `${page.title} (${page.id}): a Score heading needs an area name`,
      );
    const where = `${page.title} (${page.id}), Score: ${name}`;
    const after = html.slice((match.index ?? 0) + match[0].length);
    const table = /^\s*<table[^>]*>([\s\S]*?)<\/table>/.exec(after)?.[1];
    if (table === undefined)
      throw new Error(`${where}: the table must follow the heading directly`);
    const fields = new Map(
      [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
        .map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)])
        .filter((cells) => cells.length >= 2)
        .map((cells) => [text(cells[0][1]), text(cells[1][1])] as const),
    );
    const category = fields.get('Category') ?? '';
    if (!CATEGORIES.some((known) => known.name === category))
      throw new Error(`${where}: unknown Category "${category}"`);
    const scores = DIMENSIONS.map((dimension) => {
      const value = fields.get(dimension) ?? '';
      if (value === 'n/a') return undefined;
      if (!/^\d{1,3}$/.test(value) || Number(value) > 100)
        throw new Error(
          `${where}: ${dimension} must be 0-100 or n/a, not "${value}"`,
        );
      return Number(value);
    });
    if (scores.every((score) => score === undefined))
      throw new Error(`${where}: needs at least one scored dimension`);
    return {
      name,
      pageId: page.id,
      category,
      subtitle: fields.get('Subtitle') ?? '',
      scores,
      status: fields.get('Status') ?? '',
      tag: fields.get('Tag') || undefined,
    };
  });
}

const mean = (values: readonly number[]): number =>
  Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

const overall = (area: Area): number =>
  mean(area.scores.filter((score): score is number => score !== undefined));

const bar = (value: number): string => {
  const band = value < 40 ? 'lo' : value < 66 ? 'mid' : 'hi';
  return `<div class="bar ${band}"><i style="width:${value}%"></i><span>${value}%</span></div>`;
};

const NOW_START = '<!-- now:start -->';
const NOW_END = '<!-- now:end -->';

/** The canvas without its Now section or trailing whitespace: what the scores decide. */
const scoresOnly = (canvas: string): string => {
  const start = canvas.indexOf(NOW_START);
  const end = canvas.indexOf(NOW_END);
  const cut =
    start >= 0 && end > start
      ? canvas.slice(0, start) + canvas.slice(end + NOW_END.length)
      : canvas;
  return cut.trimEnd();
};

const NA = '<span style="color:var(--muted);font-size:12px">n/a</span>';

const pageUrl = (id: string) =>
  `https://pagespace.ai/dashboard/${DAISY_DEBATE_DRIVE_ID}/${id}`;

const STYLE = `<style>
:root{--bg:#f6f1e7;--card:#fffdf8;--ink:#2b2a26;--muted:#77736a;--line:#e4dccb;--g:#3f7a4a;--y:#c9962b;--r:#b5533c;--track:#ece5d6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:24px 16px}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 18px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted);margin-bottom:18px}
.legend b{color:var(--ink)}
.overall{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px}
.cat{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:14px;overflow:hidden}
.cat>h2{margin:0;padding:12px 16px;font-size:17px;background:#efe8d8;display:flex;justify-content:space-between;align-items:center}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border-top:1px solid var(--line);text-align:left;vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;background:#faf6ed}
td.name{width:22%;font-weight:600}
td.name a{color:inherit;text-decoration:none;border-bottom:1px dotted var(--muted)}
td.name small{display:block;font-weight:400;color:var(--muted);font-size:12px}
td.note{width:24%;font-size:12.5px;color:var(--muted)}
.bar{position:relative;height:16px;background:var(--track);border-radius:8px;min-width:58px}
.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:8px}
.bar span{position:absolute;right:6px;top:-1px;font-size:11px;font-weight:600}
.big .bar{height:22px}.big .bar span{top:2px;font-size:13px}
.lo i{background:var(--r)}.mid i{background:var(--y)}.hi i{background:var(--g)}
.tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#e6efe3;color:var(--g);font-weight:600}
.tag.fut{background:#f1e6d9;color:#8a5a2b}
@media (max-width:760px){.hide-sm{display:none}td.name{width:40%}}
</style>`;

const HEADER = `<tr><th>Area</th><th>Features</th><th>Stable</th><th>Hardened</th><th class="hide-sm">Scale</th><th class="hide-sm">Spec</th><th>Overall</th><th class="hide-sm">Where it stands</th></tr>`;

function row(area: Area): string {
  const cells = area.scores.map((score, index) => {
    const hide = index >= 3 ? ' class="hide-sm"' : '';
    return `<td${hide}>${score === undefined ? NA : bar(score)}</td>`;
  });
  const tag = area.tag
    ? `<span class="tag fut">${escape(area.tag)}</span> `
    : '';
  return `<tr><td class="name"><a href="${escape(pageUrl(area.pageId))}">${escape(area.name)}</a><small>${escape(area.subtitle)}</small></td>${cells.join('')}<td>${bar(overall(area))}</td><td class="note hide-sm">${tag}${escape(area.status)}</td></tr>`;
}

/** The whole Project Status canvas: no clock, so an unchanged board renders identically. */
export function renderStatus(
  areas: readonly Area[],
  prs: readonly OpenPr[],
): string {
  const scored = areas.map(overall);
  const whole = scored.length ? mean(scored) : 0;
  const lowest = [...areas]
    .sort((a, b) => overall(a) - overall(b))
    .slice(0, 3)
    .map((area) => area.name);
  const categories = CATEGORIES.map(({ name, tag }) => {
    const rows = areas.filter((area) => area.category === name);
    if (!rows.length) return '';
    const label = tag ? ` <span class="tag">${tag}</span>` : '';
    return `<div class="cat"><h2>${escape(name)}${label}</h2><table>\n${HEADER}\n${rows.map(row).join('\n')}\n</table></div>`;
  }).filter(Boolean);
  const now = prs.length
    ? `<table>\n<tr><th>PR</th><th>Title</th><th>State</th></tr>\n${[...prs]
        .sort((a, b) => a.number - b.number)
        .map(
          (pr) =>
            `<tr><td><a href="https://github.com/${REPOSITORY}/pull/${pr.number}">#${pr.number}</a></td><td>${escape(pr.title)}</td><td>${pr.isDraft ? 'draft' : 'ready'}</td></tr>`,
        )
        .join('\n')}\n</table>`
    : '<p class="sub">No open PRs.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project Status</title>
${STYLE}
</head>
<body>
<div class="wrap">
<h1>Daisy: distance to a finished product</h1>
<p class="sub">Generated by <code>bun progress:sync</code> from the Score blocks on the Product intent area pages; change a score there, never here. 100% = fully fleshed out, stable, hardened, secure, performant under load, and specified well enough for agents to build it without asking. Area names link to their page.</p>
<div class="legend"><span><b>Features</b> fleshed out</span><span><b>Stable</b> reliable, green CI, proven on staging</span><span><b>Hardened</b> security + privacy</span><span><b>Scale</b> performance and load</span><span><b>Spec</b> intent clear enough for agents</span></div>

<div class="overall big"><table><tr><td class="name">Whole product<small>average of ${areas.length} areas</small></td><td>${bar(whole)}</td><td class="note">Furthest from 100%: ${escape(lowest.join(', '))}.</td></tr></table></div>

${NOW_START}
<div class="cat"><h2>Now</h2>
${now}
</div>
${NOW_END}

${categories.join('\n\n')}
</div>
</body>
</html>
`;
}

export type ProgressDeps = {
  readonly areaPages: () => readonly {
    readonly id: string;
    readonly title: string;
    readonly content: string;
  }[];
  readonly openPrs: () => readonly OpenPr[];
  readonly canvas: () => string;
  readonly write: (before: string, after: string) => void;
  readonly out: (text: string) => void;
};

export function runProgressSync(deps: ProgressDeps, apply: boolean): number {
  const areas = deps
    .areaPages()
    .flatMap((page) => parseScoreBlocks(page.content, page));
  const repeated = areas.find((area, index) =>
    areas.slice(index + 1).some((other) => other.name === area.name),
  );
  if (repeated) {
    const pages = areas
      .filter((area) => area.name === repeated.name)
      .map((area) => area.pageId);
    deps.out(
      `Area "${repeated.name}" is scored on more than one page (${pages.join(', ')}); Project Status left unchanged\n`,
    );
    return 1;
  }
  if (areas.length === 0) {
    deps.out(
      'No Score blocks found on the Product intent pages; Project Status left unchanged\n',
    );
    return 1;
  }
  const desired = renderStatus(areas, deps.openPrs());
  const current = deps.canvas();
  if (current.trimEnd() === desired.trimEnd()) {
    deps.out(`Project Status in sync with ${areas.length} areas\n`);
    return 0;
  }
  const scoresDrifted = scoresOnly(current) !== scoresOnly(desired);
  if (!apply) {
    deps.out(
      scoresDrifted
        ? `Project Status drifted from ${areas.length} areas; run bun progress:sync --apply\n`
        : `Project Status scores in sync with ${areas.length} areas; the Now section is out of date (run --apply to refresh it)\n`,
    );
    return scoresDrifted ? 1 : 0;
  }
  deps.write(current, desired);
  deps.out(`Project Status updated from ${areas.length} areas\n`);
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('usage: bun progress:sync [--apply]');
  const board = liveBoardDeps();
  const run = (command: string[]): string => {
    const result = Bun.spawnSync(command, {
      stdout: 'pipe',
      stderr: 'inherit',
    });
    if (result.exitCode !== 0)
      throw new Error(`${command.slice(0, 3).join(' ')} failed`);
    return result.stdout.toString();
  };
  const pagespace = <T>(argv: string[]): T =>
    JSON.parse(run(['pagespace', ...argv, '--json'])) as T;
  const read = (id: string) =>
    pagespace<{ content: string }>(['pages', 'read', id]).content;
  process.exitCode = runProgressSync(
    {
      areaPages: () => {
        const listed = pagespace<
          | { pages: { id: string; title: string; type: string }[] }
          | { id: string; title: string; type: string }[]
        >([
          'pages',
          'list',
          '--drive',
          DAISY_DEBATE_DRIVE_ID,
          PRODUCT_INTENT_ID,
        ]);
        const pages = Array.isArray(listed) ? listed : listed.pages;
        return pages
          .filter((page) => page.type === 'DOCUMENT')
          .map((page) => ({
            id: page.id,
            title: page.title,
            content: read(page.id),
          }));
      },
      openPrs: () =>
        JSON.parse(
          run([
            'gh',
            'pr',
            'list',
            '--state',
            'open',
            '--limit',
            '1000',
            '--json',
            'number,title,isDraft',
          ]),
        ) as OpenPr[],
      canvas: () => read(PROJECT_STATUS_ID),
      write: (before, after) => {
        // The board writer checks the content hash and refuses with a reason.
        writePage(board, PROJECT_STATUS_ID, before, after);
        if (read(PROJECT_STATUS_ID).trimEnd() !== after.trimEnd())
          throw new Error('Project Status readback differs from the render');
      },
      out: (text) => process.stdout.write(text),
    },
    args.includes('--apply'),
  );
}
