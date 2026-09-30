import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, openPage, test } from './support/fixtures';
import {
  judgeStall,
  protocolVerdict,
  serverWindow,
  type ProtocolEntry,
} from './support/stall-evidence';

/**
 * ISSUE-279: a page creation that never finishes must leave the evidence
 * that says which layer stopped: the browser (a page-creation command it
 * never answered), the driver (Playwright's own event loop starved, so an
 * answer could not be read), or our server (its event loop silent in the
 * window). The pure verdicts come first; the live controls then freeze each
 * layer for real and check that the evidence names it.
 */
const sent = (at: number, id: number, method: string): ProtocolEntry => ({
  at,
  direction: 'send',
  id,
  method,
});
const answered = (at: number, id: number): ProtocolEntry => ({
  at,
  direction: 'recv',
  id,
});
const event = (at: number, method: string): ProtocolEntry => ({
  at,
  direction: 'recv',
  method,
});

test.describe('the stall verdict (pure)', () => {
  test('names the layer from the protocol, the driver and the server', () => {
    const neverAnswered = [sent(10, 7, 'Target.createTarget')];
    const createdThenStuck = [
      sent(10, 7, 'Target.createTarget'),
      answered(20, 7),
      event(21, 'Target.attachedToTarget'),
      sent(22, 8, 'Page.enable'),
    ];
    const allAnswered = [
      sent(10, 7, 'Playwright.createPage'),
      answered(20, 7),
      sent(22, 8, 'Page.enable'),
      answered(30, 8),
    ];
    const noCommand = [sent(1, 3, 'Target.setAutoAttach'), answered(2, 3)];
    expect({
      neverAnswered: protocolVerdict(neverAnswered, 5).layer,
      createdThenStuck: protocolVerdict(createdThenStuck, 5).layer,
      allAnswered: protocolVerdict(allAnswered, 5).layer,
      noCommand: protocolVerdict(noCommand, 5).layer,
      starvedDriverWins: judgeStall({
        protocol: protocolVerdict(neverAnswered, 5),
        driverMaxDelayMs: 2_500,
        server: serverWindow('', 0, 10_000),
      }).layer,
    }).toEqual({
      neverAnswered: 'browser',
      createdThenStuck: 'browser',
      allAnswered: 'driver',
      noCommand: 'driver',
      starvedDriverWins: 'driver',
    });
  });

  test('reads the server log for the window: requests, loop delay and silence', () => {
    const line = (time: number, fields: object) =>
      JSON.stringify({ time, ...fields });
    const log = [
      line(500, { event: 'http.request.completed', status: 200 }),
      line(1_000, { event: 'e2e.event_loop', maxDelayMs: 4 }),
      line(2_000, { event: 'http.request.completed', status: 200 }),
      line(2_000, { event: 'e2e.event_loop', maxDelayMs: 40 }),
      line(9_000, { event: 'e2e.event_loop', maxDelayMs: 6_900 }),
      'not json',
    ].join('\n');
    const { requests, loopMaxDelayMs, loopSilentMs } = serverWindow(
      log,
      1_000,
      9_000,
    );
    expect({ requests, loopMaxDelayMs, loopSilentMs }).toEqual({
      requests: 1,
      loopMaxDelayMs: 6_900,
      loopSilentMs: 7_000,
    });
  });
});

/** The pids of this worker's descendants: its browser and their helpers. */
const descendants = () => {
  const rows = execFileSync('ps', ['-Ao', 'pid=,ppid=,comm='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/, 3));
  const found = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid, comm] of rows)
      if (found.has(Number(ppid)) && !found.has(Number(pid)) && comm !== 'ps') {
        found.add(Number(pid));
        grew = true;
      }
  }
  found.delete(process.pid);
  return [...found];
};
const signal = (pids: number[], name: NodeJS.Signals) => {
  for (const pid of pids)
    try {
      process.kill(pid, name);
    } catch {
      // A helper that exited meanwhile needs no signal.
    }
};

test.describe('the stall evidence (live controls)', () => {
  test('a frozen browser is named as the browser, with the server heard in the window', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const frozen = descendants();
    signal(frozen, 'SIGSTOP');
    let failure: Error | undefined;
    try {
      await openPage(context, 'a page in a frozen browser', 2_000);
    } catch (error) {
      failure = error as Error;
    } finally {
      signal(frozen, 'SIGCONT');
    }
    const evidence = await readFile(
      testInfo.outputPath('stall-evidence.log'),
      'utf8',
    );
    await context.close();
    expect({
      frozen: frozen.length > 0,
      message: failure?.message,
      cause: evidence.match(/^cause: (\w+)/m)?.[1],
      unanswered: /never answered Target\.createTarget/.test(evidence),
      serverHeard: /server event loop: \d+ samples/.test(evidence),
    }).toEqual({
      frozen: true,
      message:
        'opening a page in a frozen browser did not finish within 2000 ms; cause: browser (see stall-evidence.log)',
      cause: 'browser',
      unanswered: true,
      serverHeard: true,
    });
  });

  test('a starved driver is named as the driver, not the browser', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const opening = openPage(context, 'a page from a starved driver', 1_000);
    const blockedUntil = performance.now() + 2_500;
    while (performance.now() < blockedUntil);
    const failure = await opening.then(
      () => undefined,
      (error: Error) => error,
    );
    const evidence = await readFile(
      testInfo.outputPath('stall-evidence.log'),
      'utf8',
    );
    await context.close();
    expect({
      message: failure?.message,
      cause: evidence.match(/^cause: (\w+)/m)?.[1],
    }).toEqual({
      message:
        'opening a page from a starved driver did not finish within 1000 ms; cause: driver (see stall-evidence.log)',
      cause: 'driver',
    });
  });
});
