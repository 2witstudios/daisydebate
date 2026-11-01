import { createHash } from 'node:crypto';

const indexDigest =
  'sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const manifests: Readonly<Record<string, string>> = {
  'linux/arm64':
    'sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717',
  'linux/amd64':
    'sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7',
};
const buildkitManifests: Readonly<Record<string, string>> = {
  'linux/arm64':
    'sha256:5a8cd84cb3fcfd082789a08f92bd36f8e745c6231edd78e24a3bf34fd471a823',
  'linux/amd64':
    'sha256:040d34121c27906c4ff9ac152a30d52bf2c5d328d3bb748916bb3d2743c02528',
};
export const launchBuildkitImage =
  'moby/buildkit:v0.32.2@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8';
export const launchNssVersion = '2:3.98-1ubuntu0.3';
export const launchDependencyRevision = 'noble-nss-2026-11-01';

/** All reusable inputs, excluding the checkout path and per-run trust material. */
export function launchImageIdentity(input: {
  readonly version: string;
  readonly coreVersion: string;
  readonly platform: string;
  readonly dockerfile: string;
  readonly toolchain: string;
  readonly lock: string;
  readonly refresh: string;
}) {
  const manifest = manifests[input.platform];
  if (
    input.version !== '1.63.0' ||
    input.coreVersion !== input.version ||
    !manifest
  )
    throw new Error('Unsupported Launch browser image inputs');
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        version: input.version,
        coreVersion: input.coreVersion,
        platform: input.platform,
        dockerfile: input.dockerfile,
        toolchain: input.toolchain,
        lock: input.lock,
        refresh: input.refresh,
        indexDigest,
        manifest,
        buildkit: launchBuildkitImage,
        buildkitManifest: buildkitManifests[input.platform],
        nss: launchNssVersion,
      }),
    )
    .digest('hex');
  return {
    key,
    tag: `daisy-launch-browser:${key}`,
    platform: input.platform,
    base: `mcr.microsoft.com/playwright:v${input.version}-noble@${indexDigest}`,
    labels: {
      'io.daisy.launch.inputs': key,
      'io.daisy.launch.upstream': indexDigest,
      'io.daisy.launch.manifest': manifest,
      'io.daisy.launch.platform': input.platform,
      'io.daisy.launch.nss': launchNssVersion,
      'io.daisy.launch.refresh': input.refresh,
      'io.daisy.launch.buildkit': launchBuildkitImage,
      'io.daisy.launch.buildkit-manifest': buildkitManifests[input.platform]!,
    },
  };
}
export type LaunchImage = ReturnType<typeof launchImageIdentity>;

/** Empty-context build, explicitly owned backend and local output only. */
export function launchImageBuildArgs(
  image: LaunchImage,
  builder: string,
): readonly string[] {
  return [
    'buildx',
    'build',
    '--builder',
    builder,
    '--platform',
    image.platform,
    '--load',
    '--provenance=false',
    '--tag',
    image.tag,
    '--build-arg',
    `BASE_IMAGE=${image.base}`,
    '--build-arg',
    `NSS_VERSION=${launchNssVersion}`,
    ...Object.entries(image.labels).flatMap(([key, value]) => [
      '--label',
      `${key}=${value}`,
    ]),
    '-',
  ];
}

/** Cache metadata is a consistency check inside the declared repository/event trust boundary. */
export function validateLaunchImage(
  raw: unknown,
  image: LaunchImage,
  receiptId?: string,
): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as {
    Id?: unknown;
    Os?: unknown;
    Architecture?: unknown;
    Config?: { Labels?: Record<string, unknown> };
  };
  if (
    typeof value.Id !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.Id) ||
    value.Os !== 'linux' ||
    `linux/${value.Architecture}` !== image.platform ||
    (receiptId !== undefined && receiptId !== value.Id)
  )
    return null;
  const labels = value.Config?.Labels;
  return labels &&
    Object.entries(image.labels).every(
      ([key, expected]) => labels[key] === expected,
    )
    ? value.Id
    : null;
}

/** Fixed total budget; backend cleanup is reserved rather than added later. */
export const launchPreparationRemaining = (
  budget: number,
  elapsed: number,
  cleanup: boolean,
) => Math.max(0, budget - elapsed - (cleanup ? 0 : 30000));

export function readLaunchArchiveReceipt(
  value: unknown,
  key: string,
): string | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    value.key !== key ||
    !('id' in value)
  )
    return null;
  return typeof value.id === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.id)
    ? value.id
    : null;
}
