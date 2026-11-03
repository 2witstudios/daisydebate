import { execFile } from 'node:child_process';
import { systemClock } from '@daisy/clock';
import { promisify } from 'node:util';
import {
  fillCommand,
  type DrillNode,
  type DrillTarget,
} from '../../scripts/node-kill-drill/target';
import { isNodeUp } from '../../scripts/node-kill-drill/measure';

/** The drill's wall clock in milliseconds, to compare with server timestamps. */
export const nowMs = () => Date.parse(systemClock.now());

const COMMAND_LIMIT_MS = 60_000;
const SERVE_LIMIT_MS = 60_000;

const run = async (command: readonly string[]) => {
  const { stdout } = await promisify(execFile)(command[0]!, command.slice(1), {
    timeout: COMMAND_LIMIT_MS,
    maxBuffer: 1_048_576,
  });
  return stdout;
};
/** A polled read never wakes a node: it asks the platform, not the node's own URL. */
export const nodeIsUp = async (target: DrillTarget, node: DrillNode) => {
  try {
    return isNodeUp(await run(fillCommand(target.state, node)));
  } catch {
    return false;
  }
};
export const killNode = (target: DrillTarget, node: DrillNode) =>
  run(fillCommand(target.kill, node));
export const startNode = (target: DrillTarget, node: DrillNode) =>
  run(fillCommand(target.start, node));

const serving = async (node: DrillNode) => {
  try {
    return (await fetch(node.apiUrl, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
};
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Every node started and answering; a stopped one is started first. */
export async function ensureNodesServing(target: DrillTarget) {
  for (const node of target.nodes) {
    if (!(await nodeIsUp(target, node))) await startNode(target, node);
    const deadline = nowMs() + SERVE_LIMIT_MS;
    while (!(await serving(node))) {
      if (nowMs() > deadline)
        throw new Error(`${node.app} did not serve within 60 s`);
      await pause(1000);
    }
  }
}

/** Times the node's return from the kill; the platform may do it, or `startedByDrill`. */
export function watchNodeReturn(
  target: DrillTarget,
  node: DrillNode,
  killMs: number,
) {
  let stopped = false;
  let seenDown = false;
  let backMs: number | null = null;
  let startedByDrill = false;
  const watching = (async () => {
    while (!stopped && backMs === null) {
      const up = await nodeIsUp(target, node);
      if (!up) seenDown = true;
      if (up && seenDown) backMs = nowMs() - killMs;
      await pause(1000);
    }
  })();
  return {
    backMs: () => backMs,
    startedByDrill: () => startedByDrill,
    /** Starts the node if the platform has not, keeping the time it comes back. */
    startIfDown: async () => {
      if (backMs !== null || (await nodeIsUp(target, node))) return;
      startedByDrill = true;
      await startNode(target, node);
    },
    finish: async () => {
      stopped = true;
      await watching;
    },
  };
}
