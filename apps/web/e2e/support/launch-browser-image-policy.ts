import { createHash } from 'node:crypto';
import { isDigest, record } from './launch-browser-image-values';
import { launchArchiveFormat } from './launch-browser-image-archive-policy';
import base from './launch-browser-image-base.json';

const proxyNames = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'FTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'ftp_proxy',
  'all_proxy',
  'no_proxy',
];
const safeEnv: readonly string[] = [
  ...base.env,
  ...proxyNames.map((name) => `${name}=`),
];
const isSafeName = /^daisy-image-[a-z0-9]+$/;
export const launchDependencyRevision = base.refresh;
const launchImageStores = ['overlay2', 'containerd-overlayfs'] as const;
export type LaunchImageStore = (typeof launchImageStores)[number];

/** Complete reusable inputs, excluding paths, fixture trust and credentials. */
export function launchImageIdentity(input: {
  readonly version: string;
  readonly coreVersion: string;
  readonly platform: string;
  readonly store: LaunchImageStore;
  readonly recipe: string;
  readonly toolchain: string;
  readonly lock: string;
  readonly refresh: string;
}) {
  const native = base.platforms[input.platform as keyof typeof base.platforms];
  if (
    input.version !== base.version ||
    input.coreVersion !== input.version ||
    !native ||
    !launchImageStores.includes(input.store)
  )
    throw new Error('Unsupported Launch browser image inputs');
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        version: input.version,
        coreVersion: input.coreVersion,
        platform: input.platform,
        store: input.store,
        archiveFormat: launchArchiveFormat,
        recipe: input.recipe,
        toolchain: input.toolchain,
        lock: input.lock,
        refresh: input.refresh,
        base,
      }),
    )
    .digest('hex');
  const preparationLabels = {
    ...base.labels,
    'io.daisy.launch.inputs': key,
    'io.daisy.launch.upstream': base.index,
    'io.daisy.launch.manifest': native.manifest,
    'io.daisy.launch.platform': input.platform,
    'io.daisy.launch.nss': base.nssVersion,
    'io.daisy.launch.nss-artifact': `sha256:${native.nss.sha256}`,
    'io.daisy.launch.refresh': input.refresh,
  };
  return {
    key,
    tag: `daisy-launch-browser:${key}`,
    platform: input.platform,
    store: input.store,
    base: `mcr.microsoft.com/playwright:v${base.version}-noble@${base.index}`,
    native,
    baseLabels: base.labels,
    environment: [...safeEnv] as readonly string[],
    preparationLabels,
    labels: {
      ...preparationLabels,
      ...base.artifactLabels,
    },
  };
}
export type LaunchImage = ReturnType<typeof launchImageIdentity>;

/** Recognized native daemon stores determine which content descriptor is its image ID. */
export function launchDaemonImageContract(raw: unknown) {
  const value = record(raw);
  const architecture = value.Architecture;
  const platform =
    architecture === 'arm64' || architecture === 'aarch64'
      ? 'linux/arm64'
      : architecture === 'amd64' || architecture === 'x86_64'
        ? 'linux/amd64'
        : null;
  if (
    value.OSType !== 'linux' ||
    !platform ||
    !Array.isArray(value.DriverStatus)
  )
    return null;
  const marker = value.DriverStatus.find(
    (entry) => Array.isArray(entry) && entry[0] === 'driver-type',
  )?.[1];
  if (value.Driver === 'overlayfs' && marker === 'io.containerd.snapshotter.v1')
    return { platform, store: 'containerd-overlayfs' as const };
  if (value.Driver === 'overlay2' && marker === undefined)
    return { platform, store: 'overlay2' as const };
  return null;
}

export const launchRecipeCommand = (image: LaunchImage) => [
  'sh',
  '-s',
  '--',
  base.nssVersion,
  image.platform.slice('linux/'.length),
  image.native.nss.url,
  image.native.nss.sha256,
  String(image.native.nss.bytes),
  base.dependencies
    .map(({ name, minimum }) => `${name} (>= ${minimum})`)
    .join(', '),
  ...base.dependencies.flatMap(({ name, minimum }) => [name, minimum]),
];

/** Explicit empty proxy values override Docker CLI's automatic proxy injection. */
export function launchImagePrepareArgs(
  image: LaunchImage,
  name: string,
  baseId: string,
): readonly string[] {
  if (!isDigest(baseId) || !isSafeName.test(name))
    throw new Error('Invalid owned image preparation inputs');
  return [
    'container',
    'create',
    '--pull=never',
    '--name',
    name,
    '--interactive',
    '--network',
    'bridge',
    '--hostname',
    base.preparationHostname,
    '--user',
    '0:0',
    '--workdir',
    '/',
    ...proxyNames.flatMap((key) => ['--env', `${key}=`]),
    ...Object.entries(image.preparationLabels).flatMap(([key, value]) => [
      '--label',
      `${key}=${value}`,
    ]),
    baseId,
    ...launchRecipeCommand(image),
  ];
}

/** Artifact labels are deliberate commit inputs, never inferred daemon defaults. */
export function launchImageCommitArgs(
  name: string,
  tag: string,
  packages: string,
): readonly string[] {
  if (
    !isSafeName.test(name) ||
    !/^daisy-launch-preparing:[a-z0-9]+$/.test(tag) ||
    !isDigest(packages)
  )
    throw new Error('Invalid owned image commit inputs');
  return [
    'container',
    'commit',
    '--change',
    'CMD ["/bin/bash"]',
    ...Object.entries(base.artifactLabels).flatMap(([key, value]) => [
      '--change',
      `LABEL ${key}=${value}`,
    ]),
    '--change',
    `LABEL io.daisy.launch.packages=${packages}`,
    '--message',
    'Daisy Launch NSS preparation',
    name,
    tag,
  ];
}

export function readLaunchPackages(output: string): string | null {
  const match = output.match(/^daisy-image-inventory:([A-Za-z0-9+/=]+)$/m);
  if (!match) return null;
  const inventory = Buffer.from(match[1]!, 'base64').toString();
  if (
    !inventory
      .split('\n')
      .filter(Boolean)
      .every((line) => /^[a-z0-9][a-z0-9+.:_-]*\t\S+$/.test(line)) ||
    !inventory.includes(`libnss3-tools\t${base.nssVersion}\n`)
  )
    return null;
  return `sha256:${createHash('sha256').update(inventory).digest('hex')}`;
}
export const launchPreparationRemaining = (
  budget: number,
  elapsed: number,
  cleanup: boolean,
) => Math.max(0, budget - elapsed - (cleanup ? 0 : 30000));
