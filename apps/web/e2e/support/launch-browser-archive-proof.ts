import { createId } from '@paralleldrive/cuid2';
import { link, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createLaunchPreparationProcess,
  prepareLaunchBrowserImage,
  readLaunchImageInputs,
  restoreLaunchImageArchive,
  saveLaunchImageArchive,
} from './launch-browser-image';

const checkout = resolve(import.meta.dir, '../../../..');
const prepared = await prepareLaunchBrowserImage({ checkout });
const directory = await mkdtemp(join(tmpdir(), 'daisy-launch-archive-'));
const owner = createLaunchPreparationProcess();
let loads = 0;
const run: typeof owner.run = async (args, options) => {
  if (args[0] === 'image' && args[1] === 'load') loads += 1;
  return owner.run(args, options);
};
const observed = { ...owner, run };
const started = performance.now();
try {
  const saved = join(directory, 'valid');
  const saveStarted = performance.now();
  await saveLaunchImageArchive(owner, prepared.image, prepared.id, saved);
  const saveMs = Math.round(performance.now() - saveStarted);
  const bytes = (await stat(join(saved, 'image.tar'))).size;
  // Remove only our exact validated reference to exercise archive loading.
  const removed = await owner.run(['image', 'rm', prepared.image.tag]);
  if (removed.code !== 0)
    throw new Error(
      'Archive proof could not release its owned image reference',
    );
  const loadStarted = performance.now();
  const restored = await restoreLaunchImageArchive(
    observed,
    prepared.image,
    saved,
  );
  if (restored !== prepared.id || loads !== 1)
    throw new Error('Exact Launch archive restoration failed');
  const loadMs = Math.round(performance.now() - loadStarted);
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.archive.proof', case: 'exact-roundtrip', image: prepared.id, inputs: prepared.image.key, platform: prepared.image.platform, bytes, saveMs, loadMs })}\n`,
  );
  const manifest = JSON.parse(
    (await owner.archiveDocument(join(saved, 'image.tar'), 'manifest.json'))
      .stdout,
  );
  const listing = await owner.archiveEntries(join(saved, 'image.tar'));
  const index = listing.stdout.split('\n').includes('index.json')
    ? JSON.parse(
        (await owner.archiveDocument(join(saved, 'image.tar'), 'index.json'))
          .stdout,
      )
    : undefined;
  const foreign = `daisy-launch-foreign-negative:${createId()}`;
  if ((await owner.run(['image', 'inspect', foreign])).code === 0)
    throw new Error('Foreign reference proof requires absence');
  const engine = (
    await owner.run([
      'version',
      '--format',
      '{{.Client.Version}}/{{.Server.Version}}',
    ])
  ).stdout.trim();
  const opposite = (
    await readLaunchImageInputs(
      checkout,
      prepared.image.platform === 'linux/arm64' ? 'linux/amd64' : 'linux/arm64',
      engine,
    )
  ).image;
  for (const mode of [
    'exact-key',
    'receipt-image',
    'corrupt',
    'foreign-tag',
    'foreign-oci-ref',
    'wrong-platform',
    'partial-load',
  ] as const) {
    if (mode === 'foreign-oci-ref' && index === undefined) continue; // Classic saves have no OCI reference table.
    const bad = join(directory, mode);
    await mkdir(bad);
    const expected = mode === 'wrong-platform' ? opposite : prepared.image;
    const receipt = {
      key: mode === 'exact-key' ? 'foreign-key' : expected.key,
      id: mode === 'receipt-image' ? `sha256:${'0'.repeat(64)}` : prepared.id,
    };
    await Bun.write(join(bad, 'receipt.json'), JSON.stringify(receipt));
    if (mode === 'corrupt')
      await Bun.write(join(bad, 'image.tar'), 'not an image archive');
    else if (
      ['foreign-tag', 'foreign-oci-ref', 'partial-load'].includes(mode)
    ) {
      const docker =
        mode === 'foreign-tag'
          ? manifest.map((entry: object) => ({ ...entry, RepoTags: [foreign] }))
          : manifest;
      const oci =
        mode === 'foreign-oci-ref'
          ? {
              ...index,
              manifests: index.manifests.map(
                (entry: { annotations: object }) => ({
                  ...entry,
                  annotations: {
                    ...entry.annotations,
                    'io.containerd.image.name': `docker.io/library/${foreign}`,
                  },
                }),
              ),
            }
          : index;
      await Bun.write(join(bad, 'manifest.json'), JSON.stringify(docker));
      if (oci !== undefined)
        await Bun.write(join(bad, 'index.json'), JSON.stringify(oci));
      const tar = Bun.spawnSync(
        [
          'tar',
          '-cf',
          join(bad, 'image.tar'),
          '-C',
          bad,
          'manifest.json',
          ...(oci === undefined ? [] : ['index.json']),
        ],
        { stdout: 'ignore', stderr: 'ignore', timeout: 5000 },
      );
      if (tar.exitCode !== 0)
        throw new Error('Owned negative archive construction failed');
    } else await link(join(saved, 'image.tar'), join(bad, 'image.tar'));
    const before = loads,
      began = performance.now();
    const result = await restoreLaunchImageArchive(observed, expected, bad);
    const expectedLoads =
      mode === 'partial-load' ||
      (mode === 'receipt-image' && index === undefined)
        ? 1
        : 0;
    if (result !== null || loads - before !== expectedLoads)
      throw new Error(
        `Launch archive ${mode} boundary failed (accepted: ${result !== null}, load attempts: ${loads - before})`,
      );
    if ((await owner.run(['image', 'inspect', foreign])).code === 0)
      throw new Error('Archive restore introduced a foreign reference');
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.archive.proof', case: mode, outcome: 'rejected', loadAttempts: loads - before, elapsedMs: Math.round(performance.now() - began), platform: prepared.image.platform, inputs: prepared.image.key })}\n`,
    );
  }
  if (performance.now() - started > 480000)
    throw new Error('Archive proof exceeded the preparation budget');
} finally {
  owner.close();
  await rm(directory, { recursive: true, force: true });
}
