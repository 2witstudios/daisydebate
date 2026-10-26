import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sanitizeArtifactTree } from './e2e-artifact-sanitizer';

setupRitewayBun();

/** The fake token the fixture report's failing test planted. */
const planted = 'Q7vXk2mN9pR4sT6wY8zA1bC3dE5fG7hJ9kL2mN4pQ6r';
/** A 1x1 PNG: binary data: payloads must survive byte for byte. */
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** The report's own stylesheet declares 43-character custom properties. */
const shellStyle =
  '<style>:root{--color-prettylights-syntax-meta-diff-range:#8250df;--vscode-editorBracketHighlight-foreground1:#ffd700}</style>';

/** Every entry of the report's embedded results zip, as text. */
function embeddedEntries(html: string) {
  const payload = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/.exec(
    html,
  )?.[1];
  if (!payload) throw new Error('no embedded report zip');
  const root = mkdtempSync(join(tmpdir(), 'daisy-report-check-'));
  try {
    const zip = join(root, 'report.zip');
    writeFileSync(zip, Buffer.from(payload, 'base64'));
    const listed = Bun.spawnSync(['unzip', '-Z1', zip]);
    if (listed.exitCode !== 0) throw new Error('embedded zip is undecodable');
    return listed.stdout
      .toString()
      .trim()
      .split('\n')
      .map(
        (name) =>
          Bun.spawnSync(['unzip', '-p', zip, name]).stdout.toString() as string,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a real HTML report stays decodable and loses its planted token (ISSUE-487-r1)', async () => {
  const source = await Bun.file(
    new URL('./fixtures/playwright-report-planted.html', import.meta.url),
  ).text();
  const root = mkdtempSync(join(tmpdir(), 'daisy-report-'));
  try {
    const report = join(root, 'index.html');
    writeFileSync(
      report,
      source.replace('<body>', `<body>${shellStyle}<img src="${pixel}">`),
    );
    const before = embeddedEntries(await Bun.file(report).text());
    sanitizeArtifactTree(root);
    const after = await Bun.file(report).text();
    const entries = embeddedEntries(after);
    assert({
      given:
        "a real Playwright HTML report whose embedded results carry a planted token, beside a binary data: URI and the report's own stylesheet",
      should:
        'keep the embedded zip decodable with every entry, redact the token inside it, and leave the image and the stylesheet untouched',
      actual: {
        plantedBefore: before.some((entry) => entry.includes(planted)),
        entries: entries.length,
        plantedAfter: entries.some((entry) => entry.includes(planted)),
        image: after.includes(pixel),
        shell: after.includes(shellStyle),
      },
      expected: {
        plantedBefore: true,
        entries: before.length,
        plantedAfter: false,
        image: true,
        shell: true,
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
