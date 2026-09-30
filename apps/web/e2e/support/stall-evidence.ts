/**
 * The verdict on a page creation that never finished (ISSUE-279): which
 * layer stopped, from the evidence the shared fixture keeps for the window.
 *
 *   - browser: Playwright sent the page-creation command (or a command after
 *     it) and the browser never answered;
 *   - driver: Playwright's own event loop was starved, so an answer could not
 *     be read, or every command was answered and newPage still did not
 *     resolve, or the command was never sent;
 *   - server: not a cause of a page creation (no page exists yet to reach
 *     it), but its event loop and requests in the window are reported so a
 *     starved host shows on every side.
 *
 * Pure: the fixture collects the inputs and writes the result.
 */

/**
 * One protocol message, reduced to what tells the layers apart: its
 * direction, id and method. Parameters and results are never kept, so no
 * cookie, header or credential reaches the evidence.
 */
export type ProtocolEntry = {
  readonly at: number;
  readonly direction: 'send' | 'recv';
  readonly id?: number | undefined;
  readonly method?: string | undefined;
  readonly error?: string | undefined;
};

export type Layer = 'browser' | 'driver';
export type Verdict = { readonly layer: Layer; readonly detail: string };

/** A driver event-loop delay this long means it could not read an answer. */
export const STARVED_MS = 1_000;

/** Each engine's page-creation command. */
const createMethods = new Set([
  'Target.createTarget',
  'Playwright.createPage',
  'Browser.newPage',
]);

const since = (at: number, from: number) => `+${Math.round(at - from)}ms`;

/** The protocol's verdict for the window that started at `from`. */
export function protocolVerdict(
  entries: readonly ProtocolEntry[],
  from: number,
): Verdict {
  const window = entries.filter(({ at }) => at >= from);
  const answeredIds = new Set(
    window.flatMap(({ direction, id }) =>
      direction === 'recv' && id !== undefined ? [id] : [],
    ),
  );
  const create = window.find(
    ({ direction, method }) =>
      direction === 'send' && method !== undefined && createMethods.has(method),
  );
  if (!create)
    return {
      layer: 'driver',
      detail: 'Playwright sent no page-creation command in the window',
    };
  const heardAfter = (at: number) =>
    window.filter((entry) => entry.direction === 'recv' && entry.at > at)
      .length;
  if (!answeredIds.has(create.id!))
    return {
      layer: 'browser',
      detail: `the browser never answered ${create.method} #${create.id} (sent ${since(create.at, from)}) and sent ${heardAfter(create.at)} other message(s) after it`,
    };
  const pending = window.filter(
    ({ direction, id, at }) =>
      direction === 'send' && at >= create.at && !answeredIds.has(id!),
  );
  const [first] = pending;
  if (first)
    return {
      layer: 'browser',
      detail: `the browser answered ${create.method} #${create.id} but never answered ${pending.length} command(s) after it, first ${first.method} #${first.id} (sent ${since(first.at, from)}); it sent ${heardAfter(first.at)} other message(s) after that`,
    };
  return {
    layer: 'driver',
    detail: `the browser answered every command, ${create.method} #${create.id} included, yet newPage never resolved`,
  };
}

export type ServerWindow = {
  readonly requests: number;
  readonly loopSamples: number;
  readonly loopMaxDelayMs: number;
  readonly loopSilentMs: number;
  readonly lines: readonly string[];
};

/**
 * The server log's lines in [from, to] (epoch ms): requests completed, and
 * the e2e server's once-a-second event-loop samples. `loopSilentMs` is the
 * longest stretch of the window with no sample: a starved or stopped server
 * writes none.
 */
export function serverWindow(
  log: string,
  from: number,
  to: number,
): ServerWindow {
  const records = log.split('\n').flatMap((line) => {
    try {
      const record = JSON.parse(line) as {
        time?: number;
        event?: string;
        maxDelayMs?: number;
      };
      return typeof record.time === 'number' &&
        record.time >= from &&
        record.time <= to
        ? [{ line, ...record, time: record.time }]
        : [];
    } catch {
      return [];
    }
  });
  const samples = records.filter(({ event }) => event === 'e2e.event_loop');
  const times = [from, ...samples.map(({ time }) => time), to];
  return {
    requests: records.filter(({ event }) => event === 'http.request.completed')
      .length,
    loopSamples: samples.length,
    loopMaxDelayMs: Math.max(0, ...samples.map((s) => s.maxDelayMs ?? 0)),
    loopSilentMs: Math.max(
      ...times.slice(1).map((time, index) => time - times[index]!),
    ),
    lines: records.map(({ line }) => line),
  };
}

/** The layer that stopped, weighing the driver's own starvation first. */
export function judgeStall({
  protocol,
  driverMaxDelayMs,
  server,
}: {
  readonly protocol: Verdict;
  readonly driverMaxDelayMs: number;
  readonly server: ServerWindow;
}): Verdict {
  // A starved driver cannot read the browser's answer, so an unanswered
  // command in its log proves nothing about the browser.
  if (driverMaxDelayMs >= STARVED_MS)
    return {
      layer: 'driver',
      detail: `the driver's event loop stalled ${Math.round(driverMaxDelayMs)} ms, so the protocol log cannot show whether the browser answered`,
    };
  const serverNote =
    server.loopSilentMs >= STARVED_MS * 2
      ? `; our server's event loop was also silent for ${server.loopSilentMs} ms (host-wide starvation?)`
      : '';
  return { ...protocol, detail: `${protocol.detail}${serverNote}` };
}

/**
 * One `ps` row as evidence: the executable's name only, never its directory
 * or anything a process wrote into its title after it.
 */
export const psRow = (
  pid: string,
  stat: string,
  cpu: string,
  comm: readonly string[],
) => `${pid} ${stat} ${cpu}% ${comm.join(' ').split('/').pop()}`;

/**
 * The worker's process tree from `ps -Ao pid=,ppid=,stat=,pcpu=,comm=`
 * output: the browser and its helpers, with each one's scheduler state
 * (R running, S sleeping, T stopped, U uninterruptible) and CPU share.
 */
export function processTree(ps: string, root: number): string[] {
  const rows = ps
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/))
    .map(([pid, ppid, stat, cpu, ...comm]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      text: psRow(pid!, stat!, cpu!, comm),
    }));
  const lines: string[] = [];
  const walk = (pid: number, depth: number) => {
    for (const row of rows.filter(({ ppid }) => ppid === pid)) {
      lines.push(`${'  '.repeat(depth)}${row.text}`);
      walk(row.pid, depth + 1);
    }
  };
  walk(root, 0);
  return lines;
}
