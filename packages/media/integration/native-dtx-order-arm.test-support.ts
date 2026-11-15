import { createHash } from 'node:crypto';
import { readFileSync, statfsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { totalmem } from 'node:os';
import { observeDtxOrder } from './native-dtx-order.test-support';

import { captureDtxFailures } from './native-dtx-order-failures.test-support';

const argument = process.argv[2];
const arm =
  argument === 'true-first' || argument === 'false-closed-then-true'
    ? argument
    : 'invalid';
const expectedInput =
  '990b04cf3375d86a07c8b73c1264d0ad630e6d6dd9ca66beec59a4fafbdfdfbb';
const output = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + '\n');
const command = (args: string[]) => {
  const result = Bun.spawnSync(args, { timeout: 5000 });
  if (result.exitCode !== 0)
    throw new Error(
      `Diagnostic metadata command failed: ${args[0]} ${args[1]}`,
    );
  return result.stdout.toString().trim();
};
const resources = () => {
  const memory =
    process.platform === 'linux' ? readFileSync('/proc/meminfo', 'utf8') : '';
  const disk = statfsSync(process.cwd());
  return {
    diskAvailableBytes: disk.bavail * disk.bsize,
    memTotalKiB: totalmem() / 1024,
    memAvailableKiB: /^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]
      ? Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1])
      : null,
    peakRssKiB: process.resourceUsage().maxRSS,
  };
};

let stage = 'bootstrap';
let disposeAudio: (() => Promise<void>) | null = null;
const accepted = await captureDtxFailures({
  acquire: async () => {
    const { z } = await import('zod');
    z.enum(['true-first', 'false-closed-then-true']).parse(arm);
    const native = await import('@livekit/rtc-node');
    disposeAudio = native.dispose;
    const { withDtxSource } = await import('./native-dtx.test-support');
    const { observeDtxPublication } =
      await import('./native-dtx-order-observation.test-support');
    stage = 'provenance';
    const qualifiedLinux =
      process.platform === 'linux' && process.arch === 'x64';
    if (process.env.GITHUB_ACTIONS === 'true' && !qualifiedLinux)
      throw new Error('Diagnostic requires native Linux x64');
    const uname = command(['uname', '-sm']);
    if (process.env.GITHUB_ACTIONS === 'true' && uname !== 'Linux x86_64')
      throw new Error('Diagnostic uname does not identify native Linux x64');
    const version = z.object({ version: z.string() });
    const sdkEntry = import.meta.resolve('@livekit/rtc-node');
    const sdk = version.parse(
      await Bun.file(new URL('../package.json', sdkEntry)).json(),
    ).version;
    const requireSdk = createRequire(sdkEntry);
    const ffi = version.parse(
      await Bun.file(
        resolve(
          dirname(requireSdk.resolve('@livekit/rtc-ffi-bindings')),
          'package.json',
        ),
      ).json(),
    ).version;
    const sfuImage = command([
      'docker',
      'inspect',
      '--format',
      '{{.Config.Image}}',
      'daisy-livekit-1',
    ]);
    const sfuArchitecture = command([
      'docker',
      'image',
      'inspect',
      '--format',
      '{{.Architecture}}',
      sfuImage,
    ]);
    if (
      process.versions.bun !== '1.4.2' ||
      sdk !== '1.2.0' ||
      ffi !== '0.13.1' ||
      sfuImage !== 'livekit/livekit-server:v1.13.7' ||
      sfuArchitecture !== (process.arch === 'x64' ? 'amd64' : 'arm64')
    )
      throw new Error('Diagnostic dependency or SFU provenance differs');
    const sourceFiles = [
      'native-dtx-transport.integration.ts',
      'native-dtx.test-support.ts',
      'native-dtx-order.integration.ts',
      'native-dtx-order-arm.test-support.ts',
      'native-dtx-order.test-support.ts',
      'native-dtx-order-failures.test-support.ts',
      'native-dtx-order-output.test-support.ts',
      'native-dtx-order-observation.test-support.ts',
      'native-fixtures.test-support.ts',
      'native-room.test-support.ts',
    ];
    const sourceHashes = await Promise.all(
      sourceFiles.map(async (file) => ({
        file,
        sha256: createHash('sha256')
          .update(
            new Uint8Array(
              await Bun.file(resolve(import.meta.dir, file)).arrayBuffer(),
            ),
          )
          .digest('hex'),
      })),
    );
    output({
      event: 'native.capture.dtxOrder.environment',
      arm,
      pid: process.pid,
      uname,
      qualifiedLinux,
      bun: process.versions.bun,
      sdk,
      ffi,
      sfuImage,
      sfuArchitecture,
      sourceCommit: command(['git', 'rev-parse', 'HEAD']),
      sourceHashes,
      resources: resources(),
    });
    let valid = true;
    stage = 'publication';
    await observeDtxOrder(
      z.enum(['true-first', 'false-closed-then-true']).parse(arm),
      async (requestedDtx) => {
        const startedAtMs = performance.now();
        const observation = await withDtxSource(
          observeDtxPublication,
          requestedDtx,
        );
        const elapsedMs = performance.now() - startedAtMs;
        const withinOriginalDeadline = elapsedMs < 20000;
        const expected = {
          observed: true,
          valid: true,
          sourceSamples: 192000,
          zeroSourceCallbacks: true,
          sparseZeroPackets: true,
          withheldPacketsStationary: true,
          withheldCallbacks: true,
        };
        // The false publication is a control, never relabelled an original PASS.
        const matchesOriginal =
          JSON.stringify(observation.outcome) === JSON.stringify(expected);
        const inputMatches = observation.inputSha256 === expectedInput;
        const matchesControl =
          observation.outcome.observed &&
          observation.outcome.valid &&
          observation.outcome.sourceSamples === 192000 &&
          observation.outcome.zeroSourceCallbacks &&
          observation.outcome.withheldPacketsStationary &&
          observation.outcome.withheldCallbacks;
        valid =
          valid &&
          inputMatches &&
          withinOriginalDeadline &&
          observation.publisher.requestedDtx === requestedDtx &&
          (requestedDtx ? matchesOriginal : matchesControl);
        output({
          event: 'native.capture.dtxOrder.publication',
          arm,
          role: requestedDtx ? 'original-positive' : 'false-control',
          publicationClosed: true,
          elapsedMs,
          withinOriginalDeadline,
          inputMatches,
          matchesOriginal: requestedDtx ? matchesOriginal : null,
          matchesControl: requestedDtx ? null : matchesControl,
          ...observation,
        });
      },
    );
    if (!valid) process.exitCode = 1;
  },
  dispose: async () => {
    if (disposeAudio) await disposeAudio();
  },
  resources: async () => {
    output({
      event: 'native.capture.dtxOrder.resources',
      arm,
      resources: resources(),
    });
  },
  report: (failedStage) => {
    output({
      event: 'native.capture.dtxOrder.failure',
      arm,
      stage: failedStage === 'acquire' ? stage : failedStage,
      category: 'failed',
    });
  },
});
if (!accepted) process.exitCode = 1;
