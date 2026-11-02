import base from './launch-browser-image-base.json';
import {
  launchRecipeCommand,
  type LaunchImage,
} from './launch-browser-image-policy';
import { isDigest, record, same } from './launch-browser-image-values';

type Config = Record<string, unknown>;

const ALLOWED_CONFIG_KEYS = [
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
const knownImageReference = (config: Config, image: LaunchImage) =>
  !config.Image ||
  [
    image.labels['io.daisy.launch.upstream'],
    image.native.manifest,
    image.native.config,
  ].includes(config.Image as string);
const safeHostname = (config: Config, prepared: boolean) =>
  prepared
    ? config.Hostname == null ||
      base.preparedHostnames.includes(config.Hostname as string)
    : config.Hostname === base.preparationHostname;
const safeEnvironment = (config: Config, image: LaunchImage) =>
  Array.isArray(config.Env) &&
  config.Env.every((value) => typeof value === 'string') &&
  same([...config.Env].sort(), [...image.environment].sort());
const noHostIdentity = (config: Config) =>
  !config.Domainname &&
  !config.MacAddress &&
  !config.StopSignal &&
  !config.ExposedPorts;
const noExecutionHooks = (config: Config) =>
  config.Volumes == null &&
  config.OnBuild == null &&
  config.Healthcheck == null &&
  config.Shell == null;
const safeExecution = (config: Config, image: LaunchImage, prepared: boolean) =>
  same(config.Cmd, prepared ? ['/bin/bash'] : launchRecipeCommand(image)) &&
  (config.Entrypoint == null || same(config.Entrypoint, [])) &&
  config.User === '0:0' &&
  config.WorkingDir === '/';

function safeConfig(
  raw: unknown,
  image: LaunchImage,
  prepared: boolean,
): boolean {
  const config = record(raw);
  return (
    Object.keys(config).every((key) => ALLOWED_CONFIG_KEYS.includes(key)) &&
    safeHostname(config, prepared) &&
    noHostIdentity(config) &&
    knownImageReference(config, image) &&
    safeEnvironment(config, image) &&
    safeExecution(config, image, prepared) &&
    noExecutionHooks(config)
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
  const knownIds =
    image.store === 'overlay2'
      ? [image.native.config]
      : [image.labels['io.daisy.launch.upstream'], image.native.manifest];
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
function requiredImageChecks(
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
    labels: Object.entries(image.labels).every(
      ([key, expected]) => labels[key] === expected,
    ),
    labelCount:
      Object.keys(labels).length === Object.keys(image.labels).length + 1,
    packageInventoryDigest: isDigest(labels['io.daisy.launch.packages']),
    nativeLayerPrefix:
      Array.isArray(layers) &&
      same(layers.slice(0, -1), image.native.layers) &&
      isDigest(layers.at(-1)),
    layerCount:
      Array.isArray(layers) && layers.length === image.native.layers.length + 1,
  };
}

export function validateLaunchImage(
  raw: unknown,
  image: LaunchImage,
  receiptId?: string,
): string | null {
  return Object.values(requiredImageChecks(raw, image, receiptId)).every(
    Boolean,
  )
    ? (record(raw).Id as string)
    : null;
}

/** Fixed field categories only: no untrusted metadata, key names or values escape. */
export function launchImageContractChecks(
  raw: unknown,
  image: LaunchImage,
  receiptId?: string,
) {
  const config = record(record(raw).Config);
  return {
    ...requiredImageChecks(raw, image, receiptId),
    // Which part of the configuration refused; each one is inside safeConfiguration.
    hostnameEmpty: config.Hostname == null || config.Hostname === '',
    hostnameOwned: config.Hostname === base.preparationHostname,
    environment: safeEnvironment(config, image),
    command: same(config.Cmd, ['/bin/bash']),
    entrypoint: config.Entrypoint == null || same(config.Entrypoint, []),
    user: config.User === '0:0',
    workingDirectory: config.WorkingDir === '/',
    imageReference: knownImageReference(config, image),
  };
}
