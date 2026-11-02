import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  launchArchiveProjection,
  launchExporterLegacyObjects,
} from '../e2e/support/launch-browser-image-export-policy';
import {
  launchArchiveImageId,
  launchArchiveReceipt,
  launchArchiveReceiptMatches,
  readLaunchArchiveGraph,
  type LaunchArchiveEntry,
} from '../e2e/support/launch-browser-image-archive-policy';
import {
  launchArchiveLayersMatch,
  readLaunchArchiveInventory,
  writeClosedLaunchArchive,
} from '../e2e/support/launch-browser-image-archive';
import { launchImageIdentity } from '../e2e/support/launch-browser-image-policy';

setupRitewayBun();
const sha = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const blob = (digest: string) => `blobs/sha256/${digest.slice(7)}`;
const directories: string[] = [];
const scratch = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-archive-test-'));
  directories.push(directory);
  return directory;
};
afterAll(() =>
  Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  ),
);
const unbounded = () => undefined;

function tarEntry(
  name: string,
  data: Uint8Array | string,
  flag = '0',
  magic = 'ustar\0',
): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(flag, 156);
  header.write(magic, 257);
  header.write('00', 263);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}
const tarOf = (entries: Record<string, string | Uint8Array>) =>
  Buffer.concat([
    ...Object.entries(entries).map(([name, data]) =>
      name.endsWith('/') ? tarEntry(name, '', '5') : tarEntry(name, data),
    ),
    Buffer.alloc(1024),
  ]);

const ZERO_CONFIG =
  '{"Hostname":"","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":null,"Cmd":null,"Image":"","Volumes":null,"WorkingDir":"","Entrypoint":null,"OnBuild":null,"Labels":null}';

/**
 * Written from Moby v28.0.4 image/tarexport/save.go and image/v1/imagev1.go,
 * independently of the policy under test.
 */
function classicExport() {
  const layers = ['base-one', 'base-two', 'nss-tools'].map((text) =>
    Buffer.from(`${text} layer tar bytes`),
  );
  const diffIds = layers.map((layer) => sha(layer));
  const finalConfig = '{"Cmd":["/bin/bash"],"Labels":{"a":"b"}}';
  const configBytes = `{"architecture":"arm64","config":${finalConfig},"created":"2026-11-01T00:00:00Z","history":[],"os":"linux","rootfs":{"type":"layers","diff_ids":${JSON.stringify(diffIds)}}}`;
  const config = sha(configBytes);
  const base = launchImageIdentity({
    version: '1.63.0',
    coreVersion: '1.63.0',
    platform: 'linux/arm64',
    store: 'overlay2',
    recipe: 'recipe',
    toolchain: 'adapter',
    lock: 'lock',
    refresh: 'refresh',
  });
  const image = {
    ...base,
    native: { ...base.native, layers: diffIds.slice(0, -1) },
  };
  const descriptors = layers.map((layer, index) => ({
    mediaType: 'application/vnd.oci.image.layer.v1.tar',
    digest: diffIds[index]!,
    size: layer.length,
  }));
  const manifestBytes = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: {
      mediaType: 'application/vnd.oci.image.config.v1+json',
      digest: config,
      size: configBytes.length,
    },
    layers: descriptors,
  });
  const manifest = sha(manifestBytes);
  const index = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: manifest,
        size: manifestBytes.length,
        annotations: {
          'io.containerd.image.name': `docker.io/library/${image.tag}`,
          'org.opencontainers.image.ref.name': image.key,
        },
      },
    ],
  };
  const docker = [
    {
      Config: blob(config),
      RepoTags: [image.tag],
      Layers: diffIds.map(blob),
      LayerSources: Object.fromEntries(
        diffIds.map((diffId, position) => [diffId, descriptors[position]]),
      ),
    },
  ];
  const closed: Record<string, string | Uint8Array> = {
    'blobs/': '',
    'blobs/sha256/': '',
    [blob(manifest)]: manifestBytes,
    [blob(config)]: configBytes,
    ...Object.fromEntries(
      layers.map((layer, position) => [blob(diffIds[position]!), layer]),
    ),
    'index.json': JSON.stringify(index),
    'manifest.json': `${JSON.stringify(docker)}\n`,
    'oci-layout': '{"imageLayoutVersion": "1.0.0"}',
  };
  // saveImage + v1.CreateID: fixed zero objects below the final layer.
  const chain0 = diffIds[0]!;
  const chain1 = sha(`${chain0} ${diffIds[1]}`);
  const chain2 = sha(`${chain1} ${diffIds[2]}`);
  const id0 = sha(
    `{"container_config":${ZERO_CONFIG},"created":"1970-01-01T00:00:00Z","layer_id":"${chain0}"}`,
  );
  const v0 = `{"id":"${id0.slice(7)}","created":"1970-01-01T00:00:00Z","container_config":${ZERO_CONFIG},"os":"linux"}`;
  const id1 = sha(
    `{"container_config":${ZERO_CONFIG},"created":"1970-01-01T00:00:00Z","layer_id":"${chain1}","parent":"${id0}"}`,
  );
  const v1 = `{"id":"${id1.slice(7)}","parent":"${id0.slice(7)}","created":"1970-01-01T00:00:00Z","container_config":${ZERO_CONFIG},"os":"linux"}`;
  const id2 = sha(
    `{"architecture":"arm64","config":${finalConfig},"container_config":${ZERO_CONFIG},"created":"2026-11-01T00:00:00Z","layer_id":"${chain2}","os":"linux","parent":"${id1}"}`,
  );
  const v2 = `{"id":"${id2.slice(7)}","parent":"${id1.slice(7)}","created":"2026-11-01T00:00:00Z","container_config":${ZERO_CONFIG},"config":${finalConfig},"architecture":"arm64","os":"linux"}`;
  const legacy = {
    [blob(sha(v0))]: v0,
    [blob(sha(v1))]: v1,
    [blob(sha(v2))]: v2,
    repositories: `{"daisy-launch-browser":{"${image.key}":"${diffIds[2]!.slice(7)}"}}\n`,
  };
  return { image, closed, legacy, config, manifest, diffIds, layers };
}

const read = async (entries: Record<string, string | Uint8Array>) => {
  const path = join(await scratch(), 'image.tar');
  await Bun.write(path, tarOf(entries));
  return {
    path,
    inventory: (await readLaunchArchiveInventory(path, unbounded))!,
  };
};
const reasonOf = (
  entries: readonly LaunchArchiveEntry[],
  image: ReturnType<typeof classicExport>['image'],
) => {
  const graph = readLaunchArchiveGraph(entries, image);
  return graph.ok ? 'ok' : graph.reason;
};

test('a classic config-ID export projects to the closed format with bytes preserved', async () => {
  const fixture = classicExport();
  const raw = await read({ ...fixture.closed, ...fixture.legacy });
  const graph = readLaunchArchiveGraph(raw.inventory, fixture.image);
  if (!graph.ok) throw new Error(graph.reason);
  const projection = launchArchiveProjection(
    graph,
    fixture.image,
    fixture.config,
  );
  const target = join(await scratch(), 'closed.tar');
  await writeClosedLaunchArchive(raw.path, target, graph.retained, unbounded);
  const closed = (await readLaunchArchiveInventory(target, unbounded))!;
  const closedGraph = readLaunchArchiveGraph(closed, fixture.image);
  if (!closedGraph.ok) throw new Error(closedGraph.reason);
  const contents = Object.fromEntries(
    closed
      .filter(({ bytes, kind }) => kind === 'file' && bytes)
      .map(({ name, bytes }) => [name, new TextDecoder().decode(bytes)]),
  );
  assert({
    given: 'the exact exporter V1 configs and repositories object',
    should: 'omit only those, retaining every graph byte and identity',
    actual: {
      projection,
      extras: closedGraph.extras.length,
      config: closedGraph.config,
      manifest: closedGraph.manifest,
      identity: launchArchiveImageId(closedGraph, 'overlay2'),
      layers: await launchArchiveLayersMatch(
        target,
        closedGraph.layers,
        unbounded,
      ),
      contents,
    },
    expected: {
      projection: { ok: true, omitted: 4 },
      extras: 0,
      config: fixture.config,
      manifest: fixture.manifest,
      identity: fixture.config,
      layers: true,
      contents: Object.fromEntries(
        Object.entries(fixture.closed)
          .filter(([name]) => !name.endsWith('/'))
          .map(([name, value]) => [
            name,
            typeof value === 'string' ? value : new TextDecoder().decode(value),
          ]),
      ),
    },
  });
});

test('recognition is exact: a substituted, injected or missing V1 object is refused', async () => {
  const fixture = classicExport();
  const [first, second] = Object.keys(fixture.legacy);
  const refused = async (entries: Record<string, string | Uint8Array>) => {
    const raw = await read(entries);
    const graph = readLaunchArchiveGraph(raw.inventory, fixture.image);
    return graph.ok
      ? launchArchiveProjection(graph, fixture.image, fixture.config)
      : graph;
  };
  const unknown = { ok: false as const, reason: 'unknown-object' };
  const rewritten = '{"id":"payload","os":"linux"}';
  const missing = Object.fromEntries(
    Object.entries(fixture.legacy).filter(([name]) => name !== first),
  );
  assert({
    given: 'an extra hash-named blob beside the real auxiliaries',
    should: 'reject rather than filter it',
    actual: await refused({
      ...fixture.closed,
      ...fixture.legacy,
      [blob(sha('injected'))]: 'injected',
    }),
    expected: unknown,
  });
  assert({
    given: 'one auxiliary replaced by a correctly addressed foreign object',
    should: 'reject the substitution',
    actual: await refused({
      ...fixture.closed,
      ...missing,
      [blob(sha(rewritten))]: rewritten,
    }),
    expected: unknown,
  });
  assert({
    given: 'an auxiliary missing from the exact exporter set',
    should: 'reject the unexplained inventory',
    actual: await refused({ ...fixture.closed, ...missing }),
    expected: unknown,
  });
  assert({
    given: 'a repositories object naming a foreign reference',
    should: 'reject the legacy reference',
    actual: await refused({
      ...fixture.closed,
      ...fixture.legacy,
      repositories: '{"foreign":{"latest":"00"}}\n',
    }),
    expected: unknown,
  });
  assert({
    given: 'a second V1 object that only matches by name',
    should: 'compare bytes, not the claimed path',
    actual: await refused({
      ...fixture.closed,
      ...fixture.legacy,
      [second!]: rewritten,
    }),
    expected: unknown,
  });
});

test('auxiliaries are never a reason to accept anything at restore or on containerd', async () => {
  const fixture = classicExport();
  const raw = await read({ ...fixture.closed, ...fixture.legacy });
  const graph = readLaunchArchiveGraph(raw.inventory, fixture.image);
  if (!graph.ok) throw new Error(graph.reason);
  const containerd = {
    ...fixture.image,
    store: 'containerd-overlayfs',
  } as const;
  assert({
    given: 'the same legacy objects on a containerd store',
    should: 'refuse them, since that exporter writes none',
    actual: launchArchiveProjection(graph, containerd, fixture.manifest),
    expected: { ok: false, reason: 'unknown-object' },
  });
  assert({
    given: 'a daemon identity that is not the store family descriptor',
    should: 'refuse before any projection',
    actual: [
      launchArchiveProjection(graph, fixture.image, fixture.manifest),
      launchArchiveProjection(graph, containerd, fixture.config),
    ],
    expected: [
      { ok: false, reason: 'daemon-identity' },
      { ok: false, reason: 'daemon-identity' },
    ],
  });
});

test('receipts bind format, input, measured store family and the verified chain', async () => {
  const fixture = classicExport();
  const raw = await read(fixture.closed);
  const graph = readLaunchArchiveGraph(raw.inventory, fixture.image);
  if (!graph.ok) throw new Error(graph.reason);
  const receipt = launchArchiveReceipt(graph, fixture.image);
  const check = (value: unknown) =>
    launchArchiveReceiptMatches(value, graph, fixture.image);
  assert({
    given: 'the exact receipt and each single-field mutation',
    should: 'accept only the exact one, with no either-ID path',
    actual: [
      receipt.id,
      check(receipt),
      check({ ...receipt, format: 1 }),
      check({ ...receipt, key: 'foreign' }),
      check({ ...receipt, store: 'containerd-overlayfs' }),
      check({ ...receipt, id: receipt.manifest }),
      check({ ...receipt, config: receipt.manifest }),
      check({ ...receipt, extra: true }),
      check({ key: fixture.image.key, id: receipt.id }),
      check(null),
    ],
    expected: [
      fixture.config,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  });
});

test('closed graph preflight refuses every path, type, reference and substitution', async () => {
  const fixture = classicExport();
  const { image, closed, diffIds, manifest } = fixture;
  const index = JSON.parse(closed['index.json'] as string);
  const docker = JSON.parse(closed['manifest.json'] as string);
  const entries = async (changed: Record<string, string | Uint8Array>) =>
    (await read({ ...closed, ...changed })).inventory;
  const withoutManifestBlob = { ...closed };
  delete withoutManifestBlob[blob(manifest)];
  const cases: [string, Record<string, string | Uint8Array>, string][] = [
    ['traversal path', { '../escape': 'x' }, 'inventory'],
    ['foreign root object', { 'config.json': 'x' }, 'inventory'],
    ['foreign directory', { 'layers/': '' }, 'inventory'],
    [
      'foreign OCI reference',
      {
        'index.json': JSON.stringify({
          ...index,
          manifests: [
            {
              ...index.manifests[0],
              annotations: {
                ...index.manifests[0].annotations,
                'io.containerd.image.name': 'docker.io/library/foreign:tag',
              },
            },
          ],
        }),
      },
      'index',
    ],
    [
      'second OCI image',
      {
        'index.json': JSON.stringify({
          ...index,
          manifests: [index.manifests[0], index.manifests[0]],
        }),
      },
      'index',
    ],
    [
      'foreign platform',
      {
        'index.json': JSON.stringify({
          ...index,
          manifests: [
            {
              ...index.manifests[0],
              platform: { architecture: 'amd64', os: 'linux' },
            },
          ],
        }),
      },
      'index',
    ],
    [
      'foreign Docker tag',
      {
        'manifest.json': JSON.stringify([
          { ...docker[0], RepoTags: ['foreign:latest'] },
        ]),
      },
      'docker-manifest',
    ],
    [
      'Docker manifest naming a different layer order',
      {
        'manifest.json': JSON.stringify([
          { ...docker[0], Layers: [...docker[0].Layers].reverse() },
        ]),
      },
      'docker-manifest',
    ],
    [
      'second Docker image',
      { 'manifest.json': JSON.stringify([docker[0], docker[0]]) },
      'docker-manifest',
    ],
    [
      'substituted manifest bytes',
      {
        [blob(manifest)]: (closed[blob(manifest)] as string).replace('2', '3'),
      },
      'manifest-identity',
    ],
    [
      'substituted config bytes',
      {
        [blob(fixture.config)]: (
          closed[blob(fixture.config)] as string
        ).replace('arm64', 'amd64'),
      },
      'config-identity',
    ],
    [
      'foreign layout',
      { 'oci-layout': '{"imageLayoutVersion":"9"}' },
      'layout',
    ],
  ];
  for (const [given, changed, expected] of cases)
    assert({
      given,
      should: `refuse before any daemon load (${expected})`,
      actual: reasonOf(await entries(changed), image),
      expected,
    });
  assert({
    given: 'a missing manifest blob',
    should: 'refuse the broken chain',
    actual: reasonOf((await read(withoutManifestBlob)).inventory, image),
    expected: 'manifest-identity',
  });
  assert({
    given: 'an image whose verified layers differ from the pinned native base',
    should: 'refuse the foreign rootfs',
    actual: reasonOf((await read(closed)).inventory, {
      ...image,
      native: { ...image.native, layers: [diffIds[1]!, diffIds[0]!] },
    }),
    expected: 'config',
  });
});

test('inventory rejects anything but one well-formed ustar stream', async () => {
  const fixture = classicExport();
  const directory = await scratch();
  const inventoryOf = async (name: string, bytes: Buffer) => {
    const path = join(directory, name);
    await Bun.write(path, bytes);
    return readLaunchArchiveInventory(path, unbounded);
  };
  const valid = tarOf(fixture.closed);
  const flipped = Buffer.from(valid);
  flipped[3] = flipped[3]! ^ 1;
  const bigEntry = tarEntry('blobs/sha256/x', 'x');
  bigEntry.write('77777777777\0', 124);
  assert({
    given:
      'a corrupt header, truncation, symlink, PAX header, trailing payload, oversized claim and too many entries',
    should: 'fail closed',
    actual: [
      await inventoryOf('checksum.tar', flipped),
      await inventoryOf('text.tar', Buffer.from('not an image archive')),
      await inventoryOf(
        'truncated.tar',
        valid.subarray(0, valid.length - 1536),
      ),
      (
        await inventoryOf(
          'symlink.tar',
          Buffer.concat([tarEntry('index.json', '', '2'), Buffer.alloc(1024)]),
        )
      )?.[0]?.kind,
      (
        await inventoryOf(
          'pax.tar',
          Buffer.concat([tarEntry('pax', 'x', 'x'), Buffer.alloc(1024)]),
        )
      )?.[0]?.kind,
      await inventoryOf(
        'trailing.tar',
        Buffer.concat([valid, Buffer.from('hidden payload')]),
      ),
      await inventoryOf(
        'claim.tar',
        Buffer.concat([bigEntry, Buffer.alloc(1024)]),
      ),
      await inventoryOf(
        'many.tar',
        Buffer.concat([
          ...Array.from({ length: 65 }, (_, position) =>
            tarEntry(`f${position}`, ''),
          ),
          Buffer.alloc(1024),
        ]),
      ),
    ],
    expected: [null, null, null, 'other', 'other', null, null, null],
  });
  assert({
    given: 'a symlink or PAX entry in an inventory',
    should: 'be refused by the closed inventory check',
    actual: readLaunchArchiveGraph(
      [{ name: 'index.json', kind: 'other', size: 0, offset: 0 }],
      fixture.image,
    ),
    expected: { ok: false, reason: 'inventory' },
  });
});

test('layer measurement verifies payload and DiffID, including gzip layers, under the deadline', async () => {
  const directory = await scratch();
  const tarBytes = Buffer.from('uncompressed layer tar'.repeat(2000));
  const zipped = gzipSync(tarBytes);
  const path = join(directory, 'layers.tar');
  await Bun.write(
    path,
    Buffer.concat([
      tarEntry('blobs/sha256/raw', tarBytes),
      tarEntry('blobs/sha256/zip', zipped),
      Buffer.alloc(1024),
    ]),
  );
  const [plain, gz] = (await readLaunchArchiveInventory(path, unbounded))!;
  const raw = {
    entry: plain!,
    digest: sha(tarBytes),
    diffId: sha(tarBytes),
    gzip: false,
  };
  const compressed = {
    entry: gz!,
    digest: sha(zipped),
    diffId: sha(tarBytes),
    gzip: true,
  };
  const check = (layer: typeof raw) =>
    launchArchiveLayersMatch(path, [layer], unbounded);
  assert({
    given: 'matching layers and each substituted identity or non-gzip payload',
    should: 'accept only the exact content and uncompressed identity',
    actual: [
      await check(raw),
      await check(compressed),
      await check({ ...raw, digest: sha('other') }),
      await check({ ...compressed, digest: sha('other') }),
      await check({ ...compressed, diffId: sha('other') }),
      await check({ ...raw, gzip: true }),
    ],
    expected: [true, true, false, false, false, false],
  });
  let thrown = '';
  await launchArchiveLayersMatch(path, [raw], () => {
    throw new Error('deadline');
  }).catch((error: Error) => {
    thrown = error.message;
  });
  assert({
    given: 'a preparation deadline during streaming',
    should: 'stop the hash through the injected checkpoint',
    actual: thrown,
    expected: 'deadline',
  });
});

test('the legacy objects are exactly what the Moby writer derives from a config', () => {
  const fixture = classicExport();
  const configBytes = new TextEncoder().encode(
    fixture.closed[blob(fixture.config)] as string,
  );
  assert({
    given: 'a final config',
    should: 'derive the exact V1 chain and legacy reference file',
    actual: Object.fromEntries(
      launchExporterLegacyObjects(configBytes, fixture.image),
    ),
    expected: fixture.legacy,
  });
});
