import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Browser } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { CAPTURE_BUDGET_MS } from './support/stall-capture';
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
const sent = (
  at: number,
  id: number,
  method: string,
  session?: string,
): ProtocolEntry => ({ at, direction: 'send', id, method, session });
const answered = (at: number, id: number): ProtocolEntry => ({
  at,
  direction: 'recv',
  id,
});
const event = (at: number, method: string, opens?: string): ProtocolEntry => ({
  at,
  direction: 'recv',
  method,
  opens,
});

test.describe('the stall verdict (pure)', () => {
  test('names the layer from the protocol, the driver and the server', () => {
    const neverAnswered = [sent(10, 7, 'Target.createTarget')];
    const createdThenStuck = [
      sent(10, 7, 'Target.createTarget'),
      answered(20, 7),
      event(21, 'Target.attachedToTarget', 'p1'),
      sent(22, 8, 'Page.enable', 'p1'),
    ];
    const allAnswered = [
      sent(10, 7, 'Playwright.createPage'),
      event(15, 'Playwright.pageProxyCreated', 'p1'),
      answered(20, 7),
      sent(22, 8, 'Page.enable', 'p1'),
      answered(30, 8),
    ];
    const neverAttached = [sent(10, 7, 'Target.createTarget'), answered(20, 7)];
    const noCommand = [sent(1, 3, 'Target.setAutoAttach'), answered(2, 3)];
    expect({
      neverAnswered: protocolVerdict(neverAnswered, 5).layer,
      createdThenStuck: protocolVerdict(createdThenStuck, 5).layer,
      allAnswered: protocolVerdict(allAnswered, 5).layer,
      neverAttached: protocolVerdict(neverAttached, 5).layer,
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
      neverAttached: 'browser',
      noCommand: 'driver',
      starvedDriverWins: 'driver',
    });
  });

  test('tells a page that never answers apart from a silent browser process', () => {
    // The shape of the first stall captured (aa636ef, load 222): the target
    // was created, then the new page's session answered nothing while the
    // browser session still answered.
    const { layer, detail } = protocolVerdict(
      [
        sent(10, 7, 'Target.createTarget'),
        event(11, 'Target.attachedToTarget', 'page-1'),
        answered(12, 7),
        sent(13, 8, 'Page.startScreencast', 'page-1'),
        sent(13, 9, 'Page.enable', 'page-1'),
        sent(14, 10, 'Browser.setWindowBounds'),
        answered(15, 10),
      ],
      5,
    );
    expect({ layer, detail }).toEqual({
      layer: 'browser',
      detail:
        'the browser answered Target.createTarget #7 but never answered 2 command(s) to the new page (session page-1), first Page.startScreencast #8 (sent +8ms); meanwhile it answered 1 command(s) sent after that (Browser.setWindowBounds #10 on the browser session), so the browser process was running while the page did not answer',
    });
  });

  test("judges only the new page's session, never another page's call in flight (ISSUE-284)", () => {
    // Another page's long call (session page-a), sent before and after the
    // create, is still pending; every command to the new page (page-b) was
    // answered, so the browser did its part and the driver is left.
    const { layer, detail } = protocolVerdict(
      [
        sent(8, 6, 'Runtime.callFunctionOn', 'page-a'),
        sent(10, 7, 'Target.createTarget'),
        event(11, 'Target.attachedToTarget', 'page-b'),
        answered(12, 7),
        sent(13, 8, 'Page.enable', 'page-b'),
        answered(14, 8),
        sent(15, 9, 'Runtime.evaluate', 'page-a'),
      ],
      5,
    );
    expect({ layer, detail }).toEqual({
      layer: 'driver',
      detail:
        'the browser answered every command to the new page (session page-b), Target.createTarget #7 included, yet newPage never resolved',
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

/**
 * Freezes this worker's browser (SIGSTOP), opens a page in it through
 * openPage, and thaws it: the failure, how long the whole attempt took,
 * evidence capture included, and the evidence written.
 */
const openInFrozenBrowser = async (
  browser: Browser,
  outputPath: string,
  purpose: string,
  options: Parameters<typeof openPage>[2],
) => {
  const context = await browser.newContext();
  const frozen = descendants();
  signal(frozen, 'SIGSTOP');
  // Thaws the browser even if openPage never returns and the test times out
  // before its finally runs: a stopped browser must not outlive the control.
  const thaw = setTimeout(() => signal(frozen, 'SIGCONT'), 10_000);
  const started = performance.now();
  let failure: Error | undefined;
  try {
    await openPage(context, purpose, options);
  } catch (error) {
    failure = error as Error;
  } finally {
    clearTimeout(thaw);
    signal(frozen, 'SIGCONT');
  }
  const elapsedMs = performance.now() - started;
  const evidence = await readFile(outputPath, 'utf8');
  await context.close();
  return { frozen: frozen.length > 0, failure, elapsedMs, evidence };
};

test.describe('the stall evidence (live controls)', () => {
  test('a frozen browser is named as the browser, with the server heard in the window', async ({
    browser,
  }, testInfo) => {
    const { frozen, failure, evidence } = await openInFrozenBrowser(
      browser,
      testInfo.outputPath('stall-evidence.log'),
      'a page in a frozen browser',
      { limitMs: 2_000 },
    );
    expect({
      frozen,
      message: failure?.message,
      cause: evidence.match(/^cause: (\w+)/m)?.[1],
      unanswered: /never answered Target\.createTarget/.test(evidence),
      serverHeard: /server event loop: [1-9]\d* samples/.test(evidence),
    }).toEqual({
      frozen: true,
      message:
        'opening a page in a frozen browser did not finish within 2000 ms; cause: browser (see stall-evidence.log)',
      cause: 'browser',
      unanswered: true,
      serverHeard: true,
    });
  });

  test('on a starved host the capture keeps its budget, so the failure is still named (ISSUE-282)', async ({
    browser,
  }, testInfo) => {
    // A process listing that never returns stands in for the starved host
    // of the first capture, where ps and the log read outlived the test's
    // 30 s and the stall surfaced as a bare "Test timeout".
    const { failure, elapsedMs, evidence } = await openInFrozenBrowser(
      browser,
      testInfo.outputPath('stall-evidence.log'),
      'a page on a starved host',
      { limitMs: 2_000, processSnapshot: () => new Promise<string>(() => {}) },
    );
    expect({
      message: failure?.message,
      withinBudget: elapsedMs < 2_000 + CAPTURE_BUDGET_MS + 1_000,
      cause: evidence.match(/^cause: (\w+)/m)?.[1],
      snapshotCut: /the process snapshot did not finish within \d+ ms/.test(
        evidence,
      ),
    }).toEqual({
      message:
        'opening a page on a starved host did not finish within 2000 ms; cause: browser (see stall-evidence.log)',
      withinBudget: true,
      cause: 'browser',
      snapshotCut: true,
    });
  });

  test('a starved driver is named as the driver, not the browser', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const opening = openPage(context, 'a page from a starved driver', {
      limitMs: 1_000,
    });
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
