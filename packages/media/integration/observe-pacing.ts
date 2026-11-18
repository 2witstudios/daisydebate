/** Manual, local-only diagnostic. Run from the root through scripts/heavy.ts. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dispose } from '@livekit/rtc-node';
import { observeNativePacing } from './pacing-observation.test-support';

const output = await mkdtemp(join(tmpdir(), 'daisy-media-pacing-'));
const sourceFile = new URL(
  '../../../apps/web/src/features/round-bots/speaking.ts',
  import.meta.url,
);
const source = await readFile(sourceFile, 'utf8');
const start = source.indexOf('const waitUntilMonotonic =');
const end = source.indexOf('\ntype Claim =', start);
if (start < 0 || end < 0)
  throw new Error('Production pacing adapter boundary changed');
// Execute the private production adapter verbatim without booting the web app.
// This is an observation tool, not a second production timer implementation.
const adapter = source.slice(start, end);
const adapterFile = join(output, 'production-wait.ts');
await writeFile(adapterFile, `export ${adapter}\n`);
try {
  const { waitUntilMonotonic } = (await import(
    pathToFileURL(adapterFile).href
  )) as {
    readonly waitUntilMonotonic: (
      due: number,
      signal: AbortSignal,
    ) => Promise<void>;
  };
  await writeFile(
    join(output, 'provenance.json'),
    JSON.stringify(
      {
        command:
          'bun scripts/heavy.ts bun packages/media/integration/observe-pacing.ts',
        head: Bun.spawnSync(['git', 'rev-parse', 'HEAD'])
          .stdout.toString()
          .trim(),
        bun: Bun.version,
        nodeCompatibility: process.version,
        sourceFile: sourceFile.pathname,
        sourceSha256: new Bun.CryptoHasher('sha256')
          .update(source)
          .digest('hex'),
        adapterSha256: new Bun.CryptoHasher('sha256')
          .update(adapter)
          .digest('hex'),
        adapterMethod:
          'verbatim source extraction; export keyword added; no other rewrite',
        sampleRate: 24000,
        channels: 1,
        queueMs: 500,
        leadMs: 300,
        captureTailMs: 250,
        limits:
          'Synthetic local SFU observation. Writer reported playedSamples is not subscriber proof. Analyze raw PCM with codec-aware source alignment; startup/tail and callback timing alone are not interruption evidence.',
      },
      null,
      2,
    ),
  );
  process.stdout.write(`Native pacing artifacts: ${output}\n`);
  for (const phase of [
    'on-time',
    'initial-fill',
    'established-lead',
  ] as const) {
    const {
      source: original,
      pcm,
      ...metadata
    } = await observeNativePacing({ phase, waitUntilMs: waitUntilMonotonic });
    await Bun.write(join(output, `${phase}-source.pcm`), original);
    await Bun.write(join(output, `${phase}-received.pcm`), pcm);
    await writeFile(
      join(output, `${phase}.json`),
      JSON.stringify(metadata, null, 2),
    );
    process.stdout.write(
      JSON.stringify({
        phase,
        reportedResult: metadata.result,
        receivedSamples: pcm.length,
        delayed: metadata.delayed,
      }) + '\n',
    );
  }
} finally {
  await rm(adapterFile, { force: true });
  await dispose();
}
