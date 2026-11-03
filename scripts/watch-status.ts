#!/usr/bin/env bun
/**
 * `bun progress:watch [--apply]`: renders the Watch Status canvas the way
 * `bun progress:sync` renders Project Status, through the same Score blocks,
 * drift rule and hash-checked writer. Task state and PR state come from the
 * board and GitHub on every run. Scores, notes and the page's reference
 * sections are authored in watch-status-source.html and name tasks by code,
 * so this file holds no status and the canvas is never edited by hand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bucketPageIds,
  ISSUES_LIST_ID,
  escapeHtml as escape,
} from './board-model';
import { TASK_CODE } from './notify-drive';
import { DAISY_DEBATE_DRIVE_ID } from './pagespace-docs';
import {
  bar,
  liveCanvasEdge,
  mean,
  NA,
  NOW_END,
  NOW_START,
  overall,
  readScoreBlocks,
  scoreBlockArea,
  STYLE,
  syncCanvas,
  type Area,
} from './progress-canvas';

const WATCH_STATUS_ID = 'e5hjou7otmh08rnogdy6vwig';
const WATCH_EPIC_ID = 'nug3qqezinpfft2flo0rewn0';
const PLAN_ID = 'n2v8aalsu3ef6cnpl0imyart';
const PROJECT_STATUS_ID = 'qndsohpp7nihje7a2dw3a2kl';
const WATCH_PR = 553;
const REPOSITORY = '2witstudios/daisydebate';
const SOURCE_FILE = 'watch-status-source.html';
const SOURCE_PAGE = { id: `scripts/${SOURCE_FILE}`, title: SOURCE_FILE };

const CATEGORIES = [
  'Audience experience',
  'Broadcast and recording core',
  'Trust and business',
] as const;

const CHANGES_MARK = '<!-- changes -->';
const STANDING_MARK = '<!-- standing -->';
const REFERENCE_MARK = '<!-- reference -->';
const UNPLACED_MARK = '<!-- unplaced -->';

export type WatchTask = {
  readonly code: string;
  readonly pageId: string;
  readonly title: string;
  readonly status: string;
  readonly statusLabel: string;
  /** The status group its list declares: todo, in_progress or done. */
  readonly group: string;
};

export type WatchBoard = {
  /** Every coded task the page can name: the epic's and the Issues buckets'. */
  readonly tasks: readonly WatchTask[];
  /** The epic's codes that carry work, in board order; parents are not leaves. */
  readonly epicLeaves: readonly string[];
};

type StatusCheck = {
  readonly status?: string;
  readonly conclusion?: string;
  readonly state?: string;
};

export type WatchPr = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly mergeable: string;
  readonly headRefName: string;
  readonly statusCheckRollup: readonly StatusCheck[];
};

type TaskListing = {
  readonly availableStatuses: readonly {
    readonly slug: string;
    readonly label: string;
    readonly group: string;
  }[];
  readonly tasks: readonly {
    readonly pageId: string;
    readonly title: string;
    readonly status: string;
    readonly subTaskCount?: number;
  }[];
};

// Sign-off leaves (WATCH-H) are this page's business, though the merge
// pipeline's TASK_CODE leaves them out on purpose.
const CODE = String.raw`(?:${TASK_CODE}|[A-Z]{2,6}-H)`;
const CODED_TITLE = new RegExp(String.raw`^(${CODE})\s+—`);
const MENTIONED_CODE = new RegExp(String.raw`\b${CODE}\b`, 'g');
const SIGN_OFF = /^[A-Z]{2,6}-H$/;
const TASK_TAG = /<task>([^<]+)<\/task>/g;

const coded = (listing: TaskListing) =>
  listing.tasks.flatMap((task) => {
    const code = CODED_TITLE.exec(task.title)?.[1];
    if (!code) return [];
    const status = listing.availableStatuses.find(
      ({ slug }) => slug === task.status,
    );
    const item: WatchTask = {
      code,
      pageId: task.pageId,
      title: task.title,
      status: task.status,
      statusLabel: status?.label ?? task.status,
      group: status?.group ?? 'todo',
    };
    return [{ item, parent: (task.subTaskCount ?? 0) > 0 }];
  });

/**
 * The epic with its nested lists, then Issues and each of its buckets. A code
 * the source names that lives anywhere else (a leaf moved to another epic)
 * is read from the list `locate` finds it in; one it cannot find stays
 * missing, and the render refuses it.
 */
export function readWatchBoard(
  list: (id: string) => TaskListing,
  named: readonly string[],
  locate: (code: string) => string | undefined,
  { epicId = WATCH_EPIC_ID, issuesId = ISSUES_LIST_ID } = {},
): WatchBoard {
  const walkEpic = (id: string) => {
    const seen: WatchTask[] = [];
    const leaves: string[] = [];
    for (const { item, parent } of coded(list(id))) {
      seen.push(item);
      if (!parent) {
        leaves.push(item.code);
        continue;
      }
      const nested = walkEpic(item.pageId);
      seen.push(...nested.seen);
      leaves.push(...nested.leaves);
    }
    return { seen, leaves };
  };
  const epic = walkEpic(epicId);
  const issues = list(issuesId);
  const buckets = bucketPageIds(issues.tasks, 'ISSUE').map(list);
  const filed = [issues, ...buckets].flatMap((listing) =>
    coded(listing).map(({ item }) => item),
  );
  const inEpic = new Set(epic.seen.map((task) => task.code));
  const walked = [
    ...epic.seen,
    ...filed.filter((task) => !inEpic.has(task.code)),
  ];
  const found = new Set(walked.map((task) => task.code));
  const elsewhere = named
    .filter((code) => !found.has(code))
    .flatMap((code) => {
      const listId = locate(code);
      if (!listId) return [];
      return coded(list(listId))
        .map(({ item }) => item)
        .filter((task) => task.code === code);
    });
  return { tasks: [...walked, ...elsewhere], epicLeaves: epic.leaves };
}

const pageUrl = (id: string) =>
  `https://pagespace.ai/dashboard/${DAISY_DEBATE_DRIVE_ID}/${id}`;

const statusClass = ({ status, group }: WatchTask): string => {
  if (group === 'done') return ' st-done';
  if (status === 'blocked') return ' st-blocked';
  if (status === 'in_review') return ' st-review';
  return group === 'todo' ? '' : ' st-active';
};

const chip = (task: WatchTask): string =>
  `<a class="code${statusClass(task)}" title="${escape(task.statusLabel)}" href="${escape(pageUrl(task.pageId))}">${escape(task.code)}</a>`;

type Chips = (code: string) => string;

const CHECK_OUTCOMES: Record<string, 'passed' | 'failed' | 'skipped'> = {
  SUCCESS: 'passed',
  NEUTRAL: 'passed',
  FAILURE: 'failed',
  ERROR: 'failed',
  TIMED_OUT: 'failed',
  CANCELLED: 'failed',
  ACTION_REQUIRED: 'failed',
  STARTUP_FAILURE: 'failed',
  SKIPPED: 'skipped',
};

const checksSummary = (checks: readonly StatusCheck[]): string => {
  if (checks.length === 0) return 'no checks';
  const outcomes = checks.map(
    (check) =>
      CHECK_OUTCOMES[check.conclusion || check.state || ''] ?? 'pending',
  );
  const count = (outcome: string) =>
    outcomes.filter((item) => item === outcome).length;
  return ['passed', 'failed', 'pending', 'skipped']
    .map((outcome) => `${count(outcome)} ${outcome}`)
    .join(', ');
};

const prState = ({ state, isDraft }: WatchPr): string =>
  state !== 'OPEN' ? state.toLowerCase() : isDraft ? 'draft' : 'ready';

const groupBy = <T>(items: readonly T[], key: (item: T) => string) =>
  [...new Set(items.map(key))]
    .sort()
    .map((name) => [name, items.filter((item) => key(item) === name)] as const);

const nowSection = (
  leaves: readonly WatchTask[],
  pr: WatchPr,
  chips: Chips,
): string => {
  const counts = groupBy(leaves, (task) => task.statusLabel)
    .map(([label, tasks]) => `${tasks.length} ${escape(label)}`)
    .join(', ');
  const moving = groupBy(
    leaves.filter((task) => task.group !== 'todo' && task.group !== 'done'),
    (task) => task.statusLabel,
  ).map(
    ([label, tasks]) =>
      `<p class="p">${escape(label)}: ${tasks.map((task) => chips(task.code)).join(' ')}</p>`,
  );
  return `${NOW_START}
<div class="cat"><h2>Now</h2><div class="scroll"><table><tr><th>PR</th><th>Title</th><th>Branch</th><th>State</th><th>Merge</th><th>Checks</th></tr><tr><td><a href="https://github.com/${REPOSITORY}/pull/${pr.number}">#${pr.number}</a></td><td class="txt">${escape(pr.title)}</td><td class="txt">${escape(pr.headRefName)}</td><td>${escape(prState(pr))}</td><td>${escape(pr.mergeable.toLowerCase())}</td><td class="txt">${checksSummary(pr.statusCheckRollup)}</td></tr></table></div>
<p class="p">Board: ${leaves.length} tasks: ${counts}.</p>
${moving.join('\n')}
</div>
${NOW_END}`;
};

const decisionsSection = (
  named: ReadonlySet<string>,
  leaves: readonly WatchTask[],
  tasks: readonly WatchTask[],
  chips: Chips,
): string => {
  const epicCodes = new Set(leaves.map((task) => task.code));
  const open = tasks.filter(
    (task) =>
      task.code.startsWith('DEC-') &&
      task.group !== 'done' &&
      (named.has(task.code) ||
        (task.title.match(MENTIONED_CODE) ?? []).some((code) =>
          epicCodes.has(code),
        )),
  );
  const signOffs = leaves.filter(
    (task) => SIGN_OFF.test(task.code) && task.group !== 'done',
  );
  const tag = open.length ? `${open.length} open` : 'none open';
  const list = open.length
    ? `<dl>${open.map((task) => `<dt>${chips(task.code)}</dt><dd>${escape(task.title)}</dd>`).join('')}</dl>`
    : '';
  const humans = signOffs.length
    ? `<p class="p">Human sign-off still open: ${signOffs.map((task) => chips(task.code)).join(' ')}.</p>`
    : '';
  return `<div class="cat"><h2>Owner decisions needed <span class="tag">${tag}</span></h2>${list}${humans}</div>`;
};

const HEADER = `<tr><th>Area</th><th>Features</th><th>Stable</th><th>Hardened</th><th class="hide-sm">Scale</th><th class="hide-sm">Spec</th><th>Overall</th><th class="hide-sm">Where it stands</th><th>Tasks</th></tr>`;

const areaRow = ({ area, codes }: WatchArea, chips: Chips): string => {
  const cells = area.scores.map((score, index) => {
    const hide = index >= 3 ? ' class="hide-sm"' : '';
    return `<td${hide}>${score === undefined ? NA : bar(score)}</td>`;
  });
  return `<tr><td class="name">${escape(area.name)}<small>${escape(area.subtitle)}</small></td>${cells.join('')}<td>${bar(overall(area))}</td><td class="note hide-sm">${escape(area.status)}</td><td class="tasks">${codes.map(chips).join(' ')}</td></tr>`;
};

const STATUS_STYLE = `<style>
.scroll{overflow-x:auto}.code{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 7px;margin:1px 2px 1px 0;border-radius:10px;background:#efe8d8;color:var(--ink);text-decoration:none;white-space:nowrap}
.code.st-active{background:#f5e3b3}.code.st-review{background:#d9e4f2}.code.st-done{background:#dcebdc;color:var(--g)}.code.st-blocked{background:#f2d5cd;color:var(--r)}
td.tasks{min-width:110px}td.txt{font-size:13.5px}td.ev{font-size:12px;color:var(--muted);width:20%;overflow-wrap:anywhere}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two .cat{margin-bottom:14px}dl{margin:0;padding:6px 16px 12px}dt{font-weight:600;margin-top:8px}dd{margin:0;color:var(--muted);font-size:13.5px}
ol.dec{margin:0;padding:10px 16px 12px 36px}ol.dec li{margin:7px 0}ol.dec span{display:block;color:var(--muted);font-size:13.5px}.p{padding:12px 16px;margin:0}
@media (max-width:760px){.two{grid-template-columns:1fr}}
</style>`;

const SUB = `One page for live spectating, recordings and replay, plus everything else in the app that has to change for them. Generated by <code>bun progress:watch</code>: task colours and the Now section come from the board and the PR. Scores and notes are estimates, not measurements, kept in <code>scripts/${SOURCE_FILE}</code>; change them there, never here. Design: <a href="${pageUrl(PLAN_ID)}">Plan</a> · Board: <a href="${pageUrl(WATCH_EPIC_ID)}">Watch epic</a> · <a href="${pageUrl(PROJECT_STATUS_ID)}">Project Status</a>`;

const LEGEND = `<div class="legend"><span><b>Features</b> fleshed out</span><span><b>Stable</b> reliable, proven on staging</span><span><b>Hardened</b> security + privacy</span><span><b>Scale</b> performance and load</span><span><b>Spec</b> intent clear enough for agents</span></div>
<div class="legend"><span><b>Tasks</b></span><span class="code">To Do</span><span class="code st-active">In progress</span><span class="code st-review">In Review</span><span class="code st-blocked">Blocked</span><span class="code st-done">Done</span></div>`;

type WatchArea = { readonly area: Area; readonly codes: readonly string[] };

function readSource(source: string) {
  const standingAt = source.indexOf(STANDING_MARK);
  const changesAt = source.indexOf(CHANGES_MARK);
  const referenceAt = source.indexOf(REFERENCE_MARK);
  if (standingAt < 0 || changesAt < standingAt || referenceAt < changesAt)
    throw new Error(
      `Watch Status source needs the ${STANDING_MARK}, ${CHANGES_MARK} and ${REFERENCE_MARK} markers`,
    );
  const standing = source
    .slice(standingAt + STANDING_MARK.length, changesAt)
    .trim();
  const changes = source
    .slice(changesAt + CHANGES_MARK.length, referenceAt)
    .trim();
  const reference = source.slice(referenceAt + REFERENCE_MARK.length).trim();

  const areas: readonly WatchArea[] = readScoreBlocks(
    source.slice(0, standingAt),
    SOURCE_PAGE,
  ).map((block) => ({
    area: scoreBlockArea(block, CATEGORIES),
    codes: (block.fields.get('Tasks') ?? '').split(' ').filter(Boolean),
  }));

  const named = new Set([
    ...areas.flatMap(({ codes }) => codes),
    ...[...`${standing}\n${changes}\n${reference}`.matchAll(TASK_TAG)].map(
      ([, code]) => code,
    ),
  ]);
  return { areas, standing, changes, reference, named };
}

/** Every task code the authored source names. */
export const namedCodes = (source: string): readonly string[] => [
  ...readSource(source).named,
];

/** The whole Watch Status canvas: no clock, so an unchanged board renders identically. */
export function renderWatchStatus(
  source: string,
  board: WatchBoard,
  pr: WatchPr,
): string {
  const { areas, standing, changes, reference, named } = readSource(source);
  const byCode = new Map(board.tasks.map((task) => [task.code, task]));
  const missing = [...named].filter((code) => !byCode.has(code)).sort();
  if (missing.length)
    throw new Error(
      `Watch Status source names tasks missing from the board: ${missing.join(', ')}`,
    );
  const leaves = board.epicLeaves.flatMap((code) => {
    const task = byCode.get(code);
    return task ? [task] : [];
  });
  const chips: Chips = (code) => {
    const task = byCode.get(code);
    return task ? chip(task) : escape(code);
  };
  const withChips = (html: string) =>
    html.replace(TASK_TAG, (_, code: string) => chips(code));

  const scored = areas.map(({ area }) => overall(area));
  const whole = scored.length ? mean(scored) : 0;
  const lowest = [...areas]
    .sort((a, b) => overall(a.area) - overall(b.area))
    .slice(0, 3)
    .map(({ area }) => area.name);
  const changeCount = (changes.match(/<td class="name">/g) ?? []).length;
  const categories = CATEGORIES.map((name) => {
    const rows = areas.filter(({ area }) => area.category === name);
    return rows.length
      ? `<div class="cat"><h2>${escape(name)}</h2><div class="scroll"><table>${HEADER}\n${rows.map((row) => areaRow(row, chips)).join('\n')}\n</table></div></div>`
      : '';
  }).filter(Boolean);

  const unplaced = leaves.filter((task) => !named.has(task.code));
  const unplacedRow = unplaced.length
    ? `<tr><td class="name">Not yet placed</td><td class="txt">On the epic, with no place on this page yet.</td><td class="tasks">${unplaced.map((task) => chips(task.code)).join(' ')}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Watch Status</title>
${STYLE}
${STATUS_STYLE}
</head>
<body>
<div class="wrap">
<h1>Watch: the full picture</h1>
<p class="sub">${SUB}</p>
${LEGEND}
<div class="overall big"><table><tr><td class="name">Watch overall<small>average of ${areas.length} areas</small></td><td>${bar(whole)}</td><td class="note">Furthest from done: ${escape(lowest.join(', '))}. ${changeCount} changes needed outside Watch itself.</td></tr></table></div>
${nowSection(leaves, pr, chips)}
${withChips(standing)}
${decisionsSection(named, leaves, board.tasks, chips)}
<h1 style="font-size:20px;margin:22px 0 10px">Watch capabilities</h1>
${categories.join('\n')}
${withChips(changes)}
${withChips(reference).replace(UNPLACED_MARK, unplacedRow)}
</div>
</body>
</html>
`;
}

export type WatchStatusDeps = {
  readonly source: () => string;
  readonly board: () => WatchBoard;
  readonly pr: () => WatchPr;
  readonly canvas: () => string;
  readonly write: (before: string, after: string) => void;
  readonly out: (text: string) => void;
};

export const runWatchStatusSync = (
  deps: WatchStatusDeps,
  apply: boolean,
): number =>
  syncCanvas(
    deps,
    {
      name: 'Watch Status',
      sources: 'the board and its source',
      command: 'bun progress:watch',
      desired: renderWatchStatus(deps.source(), deps.board(), deps.pr()),
    },
    apply,
  );

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('usage: bun progress:watch [--apply]');
  const { run, pagespace, read, write } = liveCanvasEdge();
  process.exitCode = runWatchStatusSync(
    {
      source: () => readFileSync(join(import.meta.dir, SOURCE_FILE), 'utf8'),
      board: () => {
        // Read once, and only when a named code is off the walked lists.
        let tree: readonly { id: string; title: string }[] | undefined;
        const treePage = (code: string) => {
          tree ??= pagespace<{ pages: { id: string; title: string }[] }>([
            'pages',
            'tree',
            '--drive',
            DAISY_DEBATE_DRIVE_ID,
          ]).pages;
          return tree.find(({ title }) => title.startsWith(`${code} —`));
        };
        return readWatchBoard(
          (id) => pagespace<TaskListing>(['tasks', 'list', id]),
          namedCodes(readFileSync(join(import.meta.dir, SOURCE_FILE), 'utf8')),
          (code) => {
            const page = treePage(code);
            return page
              ? (pagespace<{ parentId: string | null }>([
                  'pages',
                  'read-details',
                  page.id,
                ]).parentId ?? undefined)
              : undefined;
          },
        );
      },
      pr: () =>
        JSON.parse(
          run([
            'gh',
            'pr',
            'view',
            String(WATCH_PR),
            '--json',
            'number,title,state,isDraft,mergeable,headRefName,statusCheckRollup',
          ]),
        ) as WatchPr,
      canvas: () => read(WATCH_STATUS_ID),
      write: (before, after) =>
        write(WATCH_STATUS_ID, 'Watch Status', before, after),
      out: (text) => process.stdout.write(text),
    },
    args.includes('--apply'),
  );
}
