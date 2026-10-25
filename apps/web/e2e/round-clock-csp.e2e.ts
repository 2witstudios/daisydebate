import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { oneOnOneRoomConfig } from '@daisy/db/reference-formats';
import { expect, test } from './support/fixtures';
import { watchCspViolations } from './support/csp';

test('the shared Round reader advances under the actual production nonce CSP', async ({
  page,
}) => {
  const resolved = resolveRoomConfiguration(
    oneOnOneFormatFixture,
    oneOnOneRoomConfig,
  );
  if (!resolved.ok) throw new Error(resolved.refusal.message);
  const origin = '2026-10-06T09:00:00.000Z';
  const snapshot = {
    round: {
      status: 'active',
      startedAt: origin,
      completedAt: null,
      outcome: null,
    },
    rules: resolved.rules,
    segments: [],
    checkpoint: {
      version: 1,
      prep_consumed_ms: { affirmative: 0, negative: 0 },
      active_prep: null,
      floor: null,
    },
    nowMs: Date.parse(origin) + 450_000,
  };
  const folder = mkdtempSync(join(tmpdir(), 'daisy-round-clock-csp-'));
  let bundle: string;
  try {
    const entry = join(folder, 'clock.ts');
    writeFileSync(
      entry,
      `import { roundPositionAt } from ${JSON.stringify(import.meta.resolve('@daisy/debate-engine/position').replace('file://', ''))}; globalThis.__roundClockResult = roundPositionAt(${JSON.stringify(snapshot)});`,
    );
    bundle = execFileSync('bun', ['build', entry, '--target=browser'], {
      encoding: 'utf8',
      maxBuffer: 5_000_000,
    });
  } finally {
    rmSync(folder, { recursive: true });
  }
  const violations = await watchCspViolations(page);
  const response = await page.goto('/');
  const policy = response?.headers()['content-security-policy'];
  expect(policy).not.toContain("'unsafe-eval'");
  const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) throw new Error('Production CSP nonce missing');
  await page.evaluate(
    ({ bundle, nonce }) => {
      const script = document.createElement('script');
      script.nonce = nonce;
      script.textContent = bundle;
      document.head.append(script);
    },
    { bundle, nonce },
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(window, '__roundClockResult')?.openSegment?.key,
      ),
    )
    .toBe('NC');
  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});
