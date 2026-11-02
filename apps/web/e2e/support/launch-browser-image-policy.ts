import { isDigest, record, sha256 } from './launch-browser-image-values';
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
export const launchArchiveFormat = 1;
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
  const key = sha256(
    JSON.stringify({
      version: input.version,
      coreVersion: input.coreVersion,
      platform: input.platform,
      store: input.store,
      archiveFormat: launchArchiveFormat,
      recipe: input.recipe,
      toolchain: input.toolchain,
      refresh: input.refresh,
      base,
    }),
  ).slice('sha256:'.length);
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

/**
 * Fixture trust must be absent from the artifact. Runs as pwuser because root
 * without capabilities cannot enter its mode-750 home. Only "no such file" counts
 * as absent: `test ! -e` would also pass on a permission error.
 */
export function launchImageFilesystemArgs(
  image: LaunchImage,
  name: string,
  id: string,
): readonly string[] {
  if (!isDigest(id) && !/^daisy-launch-preparing:[a-z0-9]+$/.test(id))
    throw new Error('Invalid image filesystem inspection input');
  return [
    'run',
    '--rm',
    '--name',
    name,
    '--pull=never',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    'pwuser',
    ...image.environment.flatMap((value) => ['--env', value]),
    '--entrypoint',
    'sh',
    id,
    '-ec',
    [
      'absent() { if out=$(ls -d "$1" 2>&1); then exit 1; fi; case "$out" in *"No such file or directory"*) ;; *) exit 1 ;; esac; }',
      'absent /fixture/ca.crt',
      'absent /usr/local/share/ca-certificates/daisy-isolated-proof.crt',
      'absent /home/pwuser/.local/share/pki/nssdb',
      'absent /home/pwuser/.pki/nssdb',
      'command -v certutil >/dev/null',
      'test -f /usr/local/share/daisy-launch-packages.txt',
      'test ! -L /usr/local/share/daisy-launch-packages.txt',
      'test "$(wc -c < /usr/local/share/daisy-launch-packages.txt)" -le 262144',
      'printf daisy-image-inventory:',
      'base64 -w0 /usr/local/share/daisy-launch-packages.txt',
      'printf "\\n"',
    ].join('; '),
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
  return sha256(inventory);
}
export const launchPreparationRemaining = (
  budget: number,
  elapsed: number,
  cleanup: boolean,
) => Math.max(0, budget - elapsed - (cleanup ? 0 : 30000));
