// Shared fakes for the agent:spawn tests: a pu, PageSpace and transcript
// machine driven entirely in memory.
import { recordPath, serializeRecord } from './agent-registry';
import type { SpawnDeps } from './agent-spawn';
export const repo = '/repo';
export const newPath = '/repo/.pu/worktrees/wt-new';
const projects = '/home/.claude/projects/-repo--pu-worktrees-wt-new';
export const transcript = `${projects}/sess-new.jsonl`;
export const userLine = (text: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const leafId = 'tmzz7plnnrlz21d6qyyjp8sq';
const terms = JSON.stringify([
  { pattern: '\\bUUIDs?\\b', term: 'UUID', adr: '0018', use: 'cuid2' },
]);

type World = {
  worktrees: {
    id: string;
    path: string;
    branch: string;
    agents: Record<string, object>;
  }[];
};

export function fakeMachine(
  options: {
    builders?: number;
    // Running reviewers, registered in the first builder's worktree.
    reviewers?: number;
    // Builders started by a raw pu spawn, with no registry record.
    unregistered?: boolean;
    leaf?: string;
    submitsOnSpawn?: boolean;
    setupFails?: boolean;
    autonomous?: boolean;
  } = {},
) {
  const world: World = {
    worktrees: Array.from({ length: options.builders ?? 0 }, (_, i) => ({
      id: `wt-b${i}`,
      path: `/repo/.pu/worktrees/wt-b${i}`,
      branch: `pu/b${i}`,
      agents: {
        [`ag-b${i}`]: {
          id: `ag-b${i}`,
          status: 'running',
          agentType: 'claude',
        },
      },
    })),
  };
  const reviewerIds = Array.from(
    { length: options.reviewers ?? 0 },
    (_, i) => `ag-r${i}`,
  );
  for (const id of reviewerIds)
    world.worktrees[0].agents[id] = {
      id,
      status: 'running',
      agentType: 'claude',
    };
  const files = new Map<string, string>([
    [`${repo}/policy/superseded-terms.json`, terms],
    ...reviewerIds.map(
      (id) =>
        [
          recordPath(repo, id),
          serializeRecord({
            parent: 'ag-parent',
            role: 'reviewer',
            worktree: world.worktrees[0].path,
          }),
        ] as [string, string],
    ),
    ...(options.unregistered ? [] : world.worktrees).map(
      (w, i) =>
        [
          recordPath(repo, `ag-b${i}`),
          serializeRecord({
            parent: 'ag-parent',
            role: 'builder',
            worktree: w.path,
          }),
        ] as [string, string],
    ),
  ]);
  const calls: string[][] = [];
  const output: string[] = [];
  const run = (args: readonly string[], cwd?: string) => {
    calls.push([...args, ...(cwd ? [`@${cwd}`] : [])]);
    const key = args.slice(0, 2).join(' ');
    if (key === 'pu status') return { code: 0, stdout: JSON.stringify(world) };
    if (key === 'pu spawn' && args.includes('terminal')) {
      world.worktrees.push({
        id: 'wt-new',
        path: newPath,
        branch: `pu/${args[args.indexOf('-n') + 1]}`,
        agents: { 'ag-term': { id: 'ag-term', agentType: 'terminal' } },
      });
      return { code: 0, stdout: '' };
    }
    if (key === 'pu spawn') {
      const target = args[args.indexOf('-w') + 1];
      const created = world.worktrees.find((w) => w.id === target);
      if (created)
        created.agents['ag-new'] = {
          id: 'ag-new',
          agentType: 'claude',
          status: 'running',
          sessionId: 'sess-new',
        };
      files.set(
        transcript,
        options.submitsOnSpawn
          ? userLine(String(args.at(-1)))
          : '{"type":"mode"}',
      );
      return { code: 0, stdout: '' };
    }
    if (key === 'pu send') {
      // An empty send presses Enter on the prompt that sat unsubmitted.
      const text = args[3] === '' ? 'Run the task' : String(args[3]);
      files.set(
        transcript,
        `${files.get(transcript) ?? ''}\n${userLine(text)}`,
      );
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'bun')
      return { code: options.setupFails ? 1 : 0, stdout: '' };
    if (key === 'pagespace pages')
      return {
        code: 0,
        stdout: JSON.stringify({
          content: options.leaf ?? '<h3>Related pages</h3>\n<ul>\n</ul>',
        }),
      };
    return { code: 0, stdout: '' };
  };
  const deps: SpawnDeps = {
    run,
    read: (path) => files.get(path),
    list: (dir) =>
      dir === projects && files.has(transcript) ? [transcript] : [],
    mainCheckout: repo,
    write: (path, text) => void files.set(path, text),
    sleep: async () => undefined,
    // pu cannot measure idleness in the fake; transcripts decide.
    idleOf: () => null,
    home: '/home',
    repoRoot: repo,
    parentId: 'ag-parent',
    autonomous: options.autonomous ?? true,
    out: (text) => void output.push(text),
  };
  return { deps, calls, files, output };
}

export const spawnArgs = [
  '--task',
  leafId,
  '--',
  '-n',
  'grd-9',
  '-a',
  'claude',
  'Run the task',
];
export const spawned = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'pu' && call[1] === 'spawn');
