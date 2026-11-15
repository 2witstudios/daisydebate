import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { statfsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectArchiveDirectory,
  inspectVendorSource,
  readArchiveBody,
} from './native-sdk-archive.test-support';

const rustPin = '7187f6a42ca6382b73c631b75a9d560253f5b90f';
const nodePin = '31d9d7e306e6c70c2eb748efde5afbded95a170e';
const tag = 'webrtc-89d790b';
const assets = [
  {
    name: 'webrtc-linux-x64-release.zip',
    id: 520873748,
    bytes: 156139058,
    sha256: 'b167adad5291cea0e4d66a0454d9d52d2ad714e6b0ed70f4410317d3ebde70c5',
  },
  {
    name: 'webrtc-mac-arm64-release.zip',
    id: 520873749,
    bytes: 277148750,
    sha256: '9f25fea48588deac18d68e120d18b33af7ef10f921f74b7c57f66b642262c348',
  },
];
const started = performance.now();
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 900000);
const allowance = 2 * 1024 ** 3;
let downloadedBytes = 0;
let stage = 'capacity';
const output = (value: unknown) =>
  process.stdout.write(
    JSON.stringify({ event: 'native.sdkFootprint', ...Object(value) }) + '\n',
  );
const resources = () => {
  const disk = statfsSync(tmpdir());
  const mem = readFileSync('/proc/meminfo', 'utf8');
  return {
    diskAvailableBytes: disk.bavail * disk.bsize,
    memTotalKiB: Number(/^MemTotal:\s+(\d+)/m.exec(mem)?.[1]),
    memAvailableKiB: Number(/^MemAvailable:\s+(\d+)/m.exec(mem)?.[1]),
    acquisitionPeakRssKiB: process.resourceUsage().maxRSS,
  };
};
const receive = async (
  url: string,
  maxBytes: number,
  accept: (chunk: Uint8Array) => Promise<void>,
) => {
  if (performance.now() - started >= 900000)
    throw new Error('Acquisition deadline');
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 'Accept-Encoding': 'identity' },
    redirect: 'follow',
  });
  const declared = response.headers.get('content-length');
  if (
    !response.ok ||
    !response.body ||
    (declared !== null && Number(declared) > maxBytes)
  ) {
    await response.body?.cancel();
    throw new Error('Acquisition response refused');
  }
  const result = await readArchiveBody(
    response.body,
    Math.min(maxBytes, allowance - downloadedBytes),
    async (chunk) => {
      downloadedBytes += chunk.byteLength;
      await accept(chunk);
    },
  );
  return result;
};
const directory = await mkdtemp(join(tmpdir(), 'daisy-dec419-'));
try {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Requires native Linux x64');
  const commit = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { timeout: 5000 });
  if (commit.exitCode !== 0) throw new Error('Cannot identify checkout');
  output({
    stage: 'before',
    rustPin,
    nodePin,
    tag,
    releaseId: 372887836,
    sourceCommit: commit.stdout.toString().trim(),
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    budgetSeconds: 900,
    budgetBytes: allowance,
    ...resources(),
  });
  for (const source of [
    {
      repo: 'rust-sdks',
      pin: rustPin,
      path: 'webrtc-sys/build.rs',
      blob: '3791253050956a0d6ffc09dc8f03ace44905843f',
    },
    {
      repo: 'rust-sdks',
      pin: rustPin,
      path: 'webrtc-sys/build/src/lib.rs',
      blob: '586b6675123cffb1f8b5d99ce0ffa6d8744e9250',
    },
    {
      repo: 'node-sdks',
      pin: nodePin,
      path: 'packages/livekit-rtc/src/audio_source.ts',
      blob: '42d3d279f977fd204c98bca2d9ff3b55b015c902',
    },
  ]) {
    stage = source.path;
    const url = `https://raw.githubusercontent.com/livekit/${source.repo}/${source.pin}/${source.path}`;
    const chunks: Uint8Array[] = [];
    const result = await receive(url, 1024 * 1024, async (chunk) => {
      chunks.push(chunk);
    });
    const bytes = Buffer.concat(chunks);
    const identity = inspectVendorSource(bytes);
    const isPrebuiltHelper = source.path === 'webrtc-sys/build/src/lib.rs';
    const identityMatches = identity.gitBlob === source.blob;
    const helperMatches = !isPrebuiltHelper || identity.prebuiltTag === tag;
    const routesToHelper =
      source.path !== 'webrtc-sys/build.rs' ||
      bytes.toString('utf8').includes('webrtc_sys_build::download_webrtc()');
    // Keep the measured identity before refusing; no raw transport cause is needed.
    output({
      stage: 'vendor-source',
      url,
      ...source,
      ...result,
      ...identity,
      identityMatches,
      helperMatches,
      routesToHelper,
      measuredBuildPeaks: null,
    });
    if (!identityMatches || !helperMatches || !routesToHelper)
      throw new Error('Vendor source identity differs');
  }
  // Optional pinned build definitions are configuration, never measured build peaks.
  for (const path of [
    '.github/workflows/node-builds.yml',
    '.github/workflows/webrtc-builds.yml',
  ]) {
    stage = 'vendor';
    const url = `https://raw.githubusercontent.com/livekit/rust-sdks/${rustPin}/${path}`;
    const chunks: Uint8Array[] = [];
    const result = await receive(url, 1024 * 1024, async (chunk) => {
      chunks.push(chunk);
    }).catch(() => null);
    if (result === null) {
      output({
        stage,
        url,
        path,
        status: 'unavailable',
        measuredBuildPeaks: null,
      });
      continue;
    }
    const text = Buffer.concat(chunks).toString('utf8');
    output({
      stage,
      url,
      path,
      ...result,
      text,
      measuredCargoObjectLinkDiskBytes: null,
      measuredCompilerLinkRssKiB: null,
    });
  }
  for (const asset of assets) {
    stage = asset.name;
    const path = join(directory, asset.name);
    const file = Bun.file(path).writer();
    let result;
    try {
      result = await receive(
        `https://github.com/livekit/rust-sdks/releases/download/${tag}/${asset.name}`,
        asset.bytes,
        async (chunk) => {
          file.write(chunk);
          await file.flush();
        },
      );
    } finally {
      await file.end();
    }
    if (result.bytes !== asset.bytes || result.sha256 !== asset.sha256)
      throw new Error('Pinned archive identity differs');
    const inventory = inspectArchiveDirectory(await readFile(path));
    output({
      stage: 'archive',
      ...asset,
      actualBytes: result.bytes,
      actualSha256: result.sha256,
      ...inventory,
      expandedSizeMeaning:
        'central-directory declared member bytes; no extraction',
      downloadedBytes,
      elapsedMs: Math.round(performance.now() - started),
      ...resources(),
    });
    await rm(path);
  }
  output({
    stage: 'complete',
    downloadedBytes,
    elapsedMs: Math.round(performance.now() - started),
    measuredBuildPeaks: null,
    ...resources(),
  });
} catch {
  output({
    stage: 'failure',
    failedStage: stage,
    downloadedBytes,
    elapsedMs: Math.round(performance.now() - started),
    category: controller.signal.aborted ? 'deadline' : 'acquisition-refused',
    measuredBuildPeaks: null,
  });
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await rm(directory, { recursive: true, force: true });
}
