import { createHash } from 'node:crypto';
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
const safeEnv = [...base.env, ...proxyNames.map((name) => `${name}=`)];
const same = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const launchNssVersion = base.nssVersion;
export const launchDependencyRevision = base.refresh;

/** Complete reusable inputs, excluding paths, fixture trust and credentials. */
export function launchImageIdentity(input: {
  readonly version: string;
  readonly coreVersion: string;
  readonly platform: string;
  readonly recipe: string;
  readonly toolchain: string;
  readonly lock: string;
  readonly refresh: string;
}) {
  const native = base.platforms[input.platform as keyof typeof base.platforms];
  if (
    input.version !== base.version ||
    input.coreVersion !== input.version ||
    !native
  )
    throw new Error('Unsupported Launch browser image inputs');
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        version: input.version,
        coreVersion: input.coreVersion,
        platform: input.platform,
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

const recipeCommand = (image: LaunchImage) => [
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
  if (!isDigest(baseId) || !/^daisy-image-[a-z0-9]+$/.test(name))
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
    'daisy-launch-preparation',
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
    ...recipeCommand(image),
  ];
}

/** Artifact labels are deliberate commit inputs, never inferred daemon defaults. */
export function launchImageCommitArgs(
  name: string,
  tag: string,
  packages: string,
): readonly string[] {
  if (
    !/^daisy-image-[a-z0-9]+$/.test(name) ||
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

function safeConfig(
  raw: unknown,
  image: LaunchImage,
  prepared: boolean,
): boolean {
  const config = record(raw);
  const allowed = [
    'Hostname',
    'Domainname',
    'User',
    'AttachStdin',
    'AttachStdout',
    'AttachStderr',
    'ExposedPorts',
    'Tty',
    'OpenStdin',
    'StdinOnce',
    'Env',
    'Cmd',
    'Healthcheck',
    'ArgsEscaped',
    'Image',
    'Volumes',
    'WorkingDir',
    'Entrypoint',
    'NetworkDisabled',
    'MacAddress',
    'OnBuild',
    'Labels',
    'StopSignal',
    'StopTimeout',
    'Shell',
  ];
  if (Object.keys(config).some((key) => !allowed.includes(key))) return false;
  if (
    prepared
      ? config.Hostname != null && config.Hostname !== ''
      : config.Hostname !== 'daisy-launch-preparation'
  )
    return false;
  if (
    config.Domainname ||
    config.MacAddress ||
    config.StopSignal ||
    config.ExposedPorts
  )
    return false;
  if (
    config.Image &&
    ![
      image.labels['io.daisy.launch.upstream'],
      image.native.manifest,
      image.native.config,
    ].includes(config.Image as string)
  )
    return false;
  const environment = config.Env;
  if (
    !Array.isArray(environment) ||
    !environment.every((value) => typeof value === 'string') ||
    !same([...environment].sort(), [...image.environment].sort())
  )
    return false;
  return (
    same(config.Cmd, prepared ? ['/bin/bash'] : recipeCommand(image)) &&
    (config.Entrypoint == null || same(config.Entrypoint, [])) &&
    config.User === '0:0' &&
    config.WorkingDir === '/' &&
    config.Volumes == null &&
    config.OnBuild == null &&
    config.Healthcheck == null &&
    config.Shell == null
  );
}

/** Verify immutable native base bytes/config instead of trusting a mutable tag or labels. */
export function validateLaunchBase(
  raw: unknown,
  image: LaunchImage,
): string | null {
  const value = record(raw),
    config = record(value.Config),
    layers = record(value.RootFS).Layers;
  const knownIds = [
    image.labels['io.daisy.launch.upstream'],
    image.native.manifest,
    image.native.config,
  ];
  if (
    !isDigest(value.Id) ||
    !knownIds.includes(value.Id) ||
    value.Os !== 'linux' ||
    `linux/${value.Architecture}` !== image.platform ||
    !same(layers, image.native.layers)
  )
    return null;
  return same(config.Env, base.env) &&
    Object.keys(record(config.Labels)).length ===
      Object.keys(base.labels).length &&
    Object.entries(base.labels).every(
      ([key, value]) => record(config.Labels)[key] === value,
    ) &&
    same(config.Cmd, ['/bin/bash']) &&
    config.Entrypoint == null &&
    !config.User &&
    !config.WorkingDir &&
    config.Volumes == null &&
    config.OnBuild == null
    ? value.Id
    : null;
}

/** Inspect before start AND before commit; injected configuration never executes or persists. */
export function validateLaunchPreparation(
  raw: unknown,
  image: LaunchImage,
  baseId: string,
  exited = false,
): boolean {
  const value = record(raw),
    config = record(value.Config),
    host = record(value.HostConfig),
    state = record(value.State);
  return (
    value.Image === baseId &&
    safeConfig(config, image, false) &&
    Object.keys(record(config.Labels)).length ===
      Object.keys(image.preparationLabels).length &&
    Object.entries(image.preparationLabels).every(
      ([key, value]) => record(config.Labels)[key] === value,
    ) &&
    same(value.Mounts, []) &&
    host.Binds == null &&
    !host.Privileged &&
    host.CapAdd == null &&
    host.NetworkMode === 'bridge' &&
    (exited
      ? state.Status === 'exited' && state.ExitCode === 0
      : state.Status === 'created')
  );
}

/** The cache trust boundary is repository/event scoped; consistency checks are not signatures. */
export function validateLaunchImage(
  raw: unknown,
  image: LaunchImage,
  receiptId?: string,
): string | null {
  const value = record(raw),
    config = record(value.Config),
    labels = record(config.Labels),
    layers = record(value.RootFS).Layers;
  if (
    !isDigest(value.Id) ||
    value.Os !== 'linux' ||
    `linux/${value.Architecture}` !== image.platform ||
    (receiptId !== undefined && receiptId !== value.Id) ||
    !safeConfig(config, image, true)
  )
    return null;
  if (
    !Array.isArray(layers) ||
    layers.length !== image.native.layers.length + 1 ||
    !same(layers.slice(0, -1), image.native.layers) ||
    !isDigest(layers.at(-1))
  )
    return null;
  if (
    !Object.entries(image.labels).every(
      ([key, expected]) => labels[key] === expected,
    ) ||
    !isDigest(labels['io.daisy.launch.packages']) ||
    Object.keys(labels).length !== Object.keys(image.labels).length + 1
  )
    return null;
  return value.Id;
}

/** Fixed field categories only: no untrusted metadata, key names or values escape. */
export function launchImageContractChecks(
  raw: unknown,
  image: LaunchImage,
  receiptId?: string,
) {
  const value = record(raw),
    config = record(value.Config),
    labels = record(config.Labels),
    layers = record(value.RootFS).Layers;
  return {
    immutableId: isDigest(value.Id),
    receiptId: receiptId === undefined || receiptId === value.Id,
    linux: value.Os === 'linux',
    nativeArchitecture: `linux/${value.Architecture}` === image.platform,
    safeConfiguration: safeConfig(config, image, true),
    hostnameEmpty: config.Hostname == null || config.Hostname === '',
    hostnameOwned: config.Hostname === 'daisy-launch-preparation',
    environment:
      Array.isArray(config.Env) &&
      same([...config.Env].sort(), [...image.environment].sort()),
    command: same(config.Cmd, ['/bin/bash']),
    entrypoint: config.Entrypoint == null || same(config.Entrypoint, []),
    user: config.User === '0:0',
    workingDirectory: config.WorkingDir === '/',
    imageReference:
      !config.Image ||
      [
        image.labels['io.daisy.launch.upstream'],
        image.native.manifest,
        image.native.config,
      ].includes(config.Image as string),
    labels: Object.entries(image.labels).every(
      ([key, expected]) => labels[key] === expected,
    ),
    labelCount:
      Object.keys(labels).length === Object.keys(image.labels).length + 1,
    packageInventoryDigest: isDigest(labels['io.daisy.launch.packages']),
    nativeLayerPrefix:
      Array.isArray(layers) && same(layers.slice(0, -1), image.native.layers),
    layerCount:
      Array.isArray(layers) && layers.length === image.native.layers.length + 1,
  };
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
export function readLaunchArchiveReceipt(
  value: unknown,
  key: string,
): string | null {
  const receipt = record(value);
  return receipt.key === key && isDigest(receipt.id) ? receipt.id : null;
}

/** Load may touch only this exact local cache reference, never foreign tags. */
export function validateLaunchArchive(
  value: unknown,
  image: LaunchImage,
  index?: unknown,
  receiptId?: string,
): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const manifest = record(value[0]);
  const path = (value: unknown) =>
    typeof value === 'string' &&
    /^(?:[a-f0-9]{64}\.json|[a-f0-9]{64}\/layer\.tar|blobs\/sha256\/[a-f0-9]{64})$/.test(
      value,
    );
  const dockerManifest =
    same(manifest.RepoTags, [image.tag]) &&
    path(manifest.Config) &&
    Array.isArray(manifest.Layers) &&
    manifest.Layers.length === image.native.layers.length + 1 &&
    manifest.Layers.every(path);
  if (!dockerManifest || index === undefined) return dockerManifest;
  const oci = record(index);
  if (
    oci.schemaVersion !== 2 ||
    oci.mediaType !== 'application/vnd.oci.image.index.v1+json' ||
    !Array.isArray(oci.manifests) ||
    oci.manifests.length !== 1
  )
    return false;
  const descriptor = record(oci.manifests[0]);
  const annotations = record(descriptor.annotations);
  return (
    descriptor.mediaType === 'application/vnd.oci.image.manifest.v1+json' &&
    isDigest(receiptId) &&
    descriptor.digest === receiptId &&
    (descriptor.platform == null ||
      same(descriptor.platform, {
        os: 'linux',
        architecture: image.platform.slice('linux/'.length),
      })) &&
    Object.keys(annotations).length === 2 &&
    annotations['io.containerd.image.name'] ===
      `docker.io/library/${image.tag}` &&
    annotations['org.opencontainers.image.ref.name'] === image.key
  );
}
