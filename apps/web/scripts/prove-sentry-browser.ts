import { chromium } from 'playwright-core';
import { openPage } from '../e2e/support/fixtures';

const build = await Bun.build({
  entrypoints: [
    new URL(
      '../src/features/telemetry/sentry-browser.test-support.ts',
      import.meta.url,
    ).pathname,
  ],
  target: 'browser',
  format: 'iife',
  define: { 'process.env': '{}', 'process.turbopack': 'false' },
});
if (!build.success)
  throw new Error('Browser SDK proof bundle failed', { cause: build.logs });
const script = await build.outputs[0]!.text();
const requests: Array<{
  path: string;
  trusted: boolean;
  trace: boolean;
  baggage: boolean;
}> = [];
const serve = (trusted: boolean) =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/')
        return new Response(
          '<!doctype html><html><body>SDK proof</body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      requests.push({
        path,
        trusted,
        trace: request.headers.has('sentry-trace'),
        baggage: request.headers.has('baggage'),
      });
      return Response.json(
        { ok: true },
        { headers: { 'access-control-allow-origin': '*' } },
      );
    },
  });
const trusted = serve(true),
  untrusted = serve(false);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await openPage(context, 'installed Sentry browser SDK proof');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(trusted.url.href);
  await page.addScriptTag({ content: script });
  if (
    !(await page.evaluate(
      () =>
        typeof (window as unknown as { proveSentryBrowser?: unknown })
          .proveSentryBrowser === 'function',
    ))
  )
    throw new Error(`SDK browser entry failed: ${JSON.stringify(pageErrors)}`);
  const result = await page.evaluate(
    async (url) =>
      (
        window as unknown as {
          proveSentryBrowser: (url: string) => Promise<{
            recording: boolean[];
            restored: boolean;
            envelopes: unknown[];
            containsSecret: boolean;
          }>;
        }
      ).proveSentryBrowser(url),
    `${untrusted.url.origin}/untrusted`,
  );
  const output = JSON.stringify(result.envelopes);
  const spanOutput = JSON.stringify(
    result.envelopes.flatMap((envelope) =>
      (envelope as [unknown, Array<[{ type: string }, unknown]>])[1]
        .filter(([header]) => header.type === 'span')
        .map(([, payload]) => payload),
    ),
  );
  const probeRequests = requests.filter(
    (r) =>
      r.path === '/api/rounds/probe/check-in' ||
      r.path === '/api/auth/get-session',
  );
  const ordinary = requests.find((r) => r.path === '/ordinary');
  const external = requests.find((r) => r.path === '/untrusted');
  const passed =
    JSON.stringify(result.recording) ===
      JSON.stringify([false, false, false, true]) &&
    result.restored &&
    !result.containsSecret &&
    !spanOutput.includes('/api/rounds/abc/check-in') &&
    !spanOutput.includes('/api/health/ready') &&
    output.includes('[scrubbed]') &&
    probeRequests.length === 2 &&
    probeRequests.every((r) => !r.trace && !r.baggage) &&
    ordinary?.trace &&
    ordinary.baggage &&
    external &&
    !external.trace &&
    !external.baggage;
  process.stdout.write(
    JSON.stringify({
      passed,
      recording: result.recording,
      restored: result.restored,
      containsSecret: result.containsSecret,
      requests,
      envelopes: result.envelopes,
    }) + '\n',
  );
  if (!passed) throw new Error('Native browser SDK acceptance failed');
} finally {
  await browser.close();
  await trusted.stop(true);
  await untrusted.stop(true);
}
