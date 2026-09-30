import type { TestInfo } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, freemem, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { promisify } from 'node:util';
import utilsBundle from 'playwright-core/lib/utilsBundle';
import { resolveE2EPorts } from '../../playwright.config';
import {
  judgeStall,
  processTree,
  psRow,
  protocolVerdict,
  serverWindow,
  type ProtocolEntry,
} from './stall-evidence';

/**
 * Collects what a stalled page creation leaves behind (ISSUE-279), so the
 * next stall says whether the browser, the driver or our server stopped:
 * Playwright's protocol traffic for the test, the driver's event-loop
 * delay, the server log's requests and event-loop samples, and the host's
 * load and the worker's process states. The verdict itself is pure
 * (stall-evidence.ts).
 */
const RING = 4_000;
const entries: ProtocolEntry[] = [];
const markers = ['SEND ► ', '◀ RECV '] as const;

/** Reduces one pw:protocol line to its direction, id, method and session. */
const entryOf = (text: string): ProtocolEntry | undefined => {
  const marker = markers.find((candidate) => text.includes(candidate));
  if (!marker) return undefined;
  const at = performance.now();
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const { id, method, error, sessionId, pageProxyId } = JSON.parse(body) as {
      id?: number;
      method?: string;
      error?: { message?: string };
      sessionId?: string;
      pageProxyId?: string;
    };
    // Chromium and Firefox address a page by sessionId, WebKit by
    // pageProxyId; an opaque handle, shortened to stay readable.
    const session = sessionId ?? pageProxyId;
    return {
      at,
      direction: marker === markers[0] ? 'send' : 'recv',
      id,
      method,
      error: error?.message?.slice(0, 200),
      session: session === undefined ? undefined : String(session).slice(0, 8),
    };
  } catch {
    return { at, direction: marker === markers[0] ? 'send' : 'recv' };
  }
};

/**
 * Records Playwright's protocol log (pw:protocol) for the running test into
 * a bounded ring, keeping only each message's direction, id, method and
 * session, and
 * returns the function that stops recording. Other DEBUG namespaces keep
 * reaching the original log.
 */
export function recordProtocol(): () => void {
  const { debug } = utilsBundle;
  entries.length = 0;
  const userWanted = debug.enabled('pw:protocol');
  const previous = debug.disable();
  const log = debug.log;
  debug.log = (...args: unknown[]) => {
    const entry = entryOf(String(args[0]));
    if (!entry || userWanted) log(...args);
    if (!entry) return;
    entries.push(entry);
    if (entries.length > RING * 2) entries.splice(0, RING);
  };
  debug.enable(previous ? `${previous},pw:protocol` : 'pw:protocol');
  return () => {
    debug.disable();
    debug.log = log;
    if (previous) debug.enable(previous);
  };
}

const line = (entry: ProtocolEntry, from: number) =>
  `+${Math.round(entry.at - from)}ms ${entry.direction === 'send' ? 'SEND ►' : '◀ RECV'} ${
    entry.id === undefined ? 'event' : `#${entry.id}`
  }${entry.method ? ` ${entry.method}` : ''}${entry.session ? ` [${entry.session}]` : ''}${entry.error ? ` error: ${entry.error}` : ''}`;

/** The whole test's protocol tail, for a failed test's protocol.log. */
export const protocolLog = () =>
  entries.map((entry) => line(entry, entries[0]?.at ?? 0)).join('\n');

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

/** Marks the start of a page creation the evidence will describe. */
export function startWindow() {
  loop.reset();
  return performance.now();
}

const ps = async () => {
  try {
    const { stdout } = await promisify(execFile)(
      'ps',
      ['-Ao', 'pid=,ppid=,stat=,pcpu=,comm='],
      { timeout: 10_000 },
    );
    return stdout;
  } catch (error) {
    // The first captured stall lost this to a bare "Command failed" at load
    // 222: keep how it failed (exit code, signal, timeout kill, stderr).
    const { code, signal, killed, stderr } = error as {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stderr?: unknown;
    };
    return `ps failed: code ${String(code)}, signal ${String(signal)}, killed ${String(killed)}: ${String(
      stderr ?? '',
    )
      .trim()
      .slice(0, 200)}`;
  }
};

/**
 * Writes stall-evidence.log for a page creation that started at `from` and
 * outlived its limit, and returns the layer the evidence names.
 */
export async function recordStall(
  testInfo: TestInfo,
  { step, from, limitMs }: { step: string; from: number; limitMs: number },
): Promise<string> {
  const to = performance.now();
  // The bound's own timer firing late is the driver's delay too: a starved
  // loop runs it late (and may not have sampled the histogram yet).
  const lateMs = to - from - limitMs;
  const driverMaxDelayMs = Math.max(loop.max / 1e6, lateMs);
  const epoch = (at: number) => performance.timeOrigin + at;
  const serverLogPath = join(
    dirname(testInfo.config.configFile ?? '.'),
    'test-results',
    `server-${resolveE2EPorts(process.env).app}.log`,
  );
  const serverLog = await readFile(serverLogPath, 'utf8').catch(
    (error: Error) => `unreadable: ${error.message}`,
  );
  const server = serverWindow(serverLog, epoch(from), epoch(to));
  const protocol = protocolVerdict(entries, from);
  const verdict = judgeStall({ protocol, driverMaxDelayMs, server });
  const processes = await ps();
  const top = processes
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/))
    .sort((a, b) => Number(b[3]) - Number(a[3]))
    .slice(0, 10)
    .map(([pid, , stat, cpu, ...comm]) => psRow(pid!, stat!, cpu!, comm));
  const report = [
    `cause: ${verdict.layer}`,
    verdict.detail,
    `step: ${step}; limit ${limitMs} ms; the bound fired ${Math.round(lateMs)} ms late`,
    `driver event loop: max ${Math.round(loop.max / 1e6)} ms, mean ${Math.round(loop.mean / 1e6)} ms`,
    `server event loop: ${server.loopSamples} samples, max ${server.loopMaxDelayMs} ms, longest silence ${Math.round(server.loopSilentMs)} ms; requests completed: ${server.requests}`,
    `host: load ${loadavg()
      .map((load) => load.toFixed(1))
      .join(
        ' ',
      )} on ${cpus().length} CPUs, ${Math.round(freemem() / 2 ** 20)} MiB free`,
    '',
    `worker ${process.pid} and its processes (pid stat cpu command):`,
    ...processTree(processes, process.pid),
    '',
    'top CPU on the host:',
    ...top,
    '',
    'protocol in the window:',
    ...entries.filter(({ at }) => at >= from).map((entry) => line(entry, from)),
    '',
    `server log in the window (${serverLogPath}):`,
    ...server.lines,
  ];
  await writeFile(
    testInfo.outputPath('stall-evidence.log'),
    `${report.join('\n')}\n`,
  );
  return verdict.layer;
}
