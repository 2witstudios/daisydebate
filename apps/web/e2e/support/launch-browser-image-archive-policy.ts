import { isDigest, record, same, sha256 } from './launch-browser-image-values';
import type { LaunchImage } from './launch-browser-image-policy';

/**
 * The one closed cache format: index -> manifest -> config and ordered layers,
 * the mirrored Docker manifest and the OCI layout, and nothing else. Restore
 * reads only this; recognizing exporter objects lives in the producer policy.
 */
export type LaunchArchiveEntry = {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'other';
  readonly size: number;
  /** Byte offset of the tar header, so a retained entry is copied verbatim. */
  readonly offset: number;
  /** Present only for bounded small files; large blobs are never held in memory. */
  readonly bytes?: Uint8Array;
};
export type LaunchArchiveLayer = {
  readonly entry: LaunchArchiveEntry;
  readonly digest: string;
  readonly diffId: string;
  readonly gzip: boolean;
};
export type LaunchArchiveGraph = {
  readonly manifest: string;
  readonly config: string;
  readonly configBytes: Uint8Array;
  readonly layers: readonly LaunchArchiveLayer[];
  /** Regular files outside the graph. A closed archive has none. */
  readonly extras: readonly LaunchArchiveEntry[];
  readonly retained: readonly LaunchArchiveEntry[];
};
export type LaunchArchiveReceipt = {
  readonly format: typeof launchArchiveFormat;
  readonly key: string;
  readonly store: LaunchImage['store'];
  readonly id: string;
  readonly config: string;
  readonly manifest: string;
};
export type LaunchArchiveRefusal = {
  readonly ok: false;
  readonly reason: string;
};

export const launchArchiveFormat = 2;
export const launchArchiveMaxEntries = 64;
export const launchArchiveMaxDocumentBytes = 262144;

const INDEX = 'application/vnd.oci.image.index.v1+json';
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const CONFIG = 'application/vnd.oci.image.config.v1+json';
const LAYER_MEDIA: Readonly<Record<string, boolean>> = {
  'application/vnd.oci.image.layer.v1.tar': false,
  'application/vnd.docker.image.rootfs.diff.tar': false,
  'application/vnd.oci.image.layer.v1.tar+gzip': true,
  'application/vnd.docker.image.rootfs.diff.tar.gzip': true,
};
const DIRECTORIES = ['blobs/', 'blobs/sha256/'];
const BLOB = /^blobs\/sha256\/[a-f0-9]{64}$/;
const ROOT_FILES = [
  'index.json',
  'manifest.json',
  'oci-layout',
  'repositories',
];

const onlyKeys = (value: object, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
export const launchArchiveBlobPath = (digest: string) =>
  `blobs/sha256/${digest.slice(7)}`;
export const refuseLaunchArchive = (reason: string): LaunchArchiveRefusal => ({
  ok: false,
  reason,
});
const decoded = (entry: LaunchArchiveEntry | undefined): unknown => {
  if (!entry?.bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(entry.bytes));
  } catch {
    return null;
  }
};

/** One ustar header block; anything else (PAX, GNU long names, a bad checksum) is not ours. */
export function readLaunchTarHeader(
  block: Uint8Array,
): Pick<LaunchArchiveEntry, 'name' | 'kind' | 'size'> | null {
  const text = (start: number, length: number) => {
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    return new TextDecoder('latin1').decode(
      end === -1 ? field : field.subarray(0, end),
    );
  };
  const octal = (start: number, length: number) => {
    const value = text(start, length).trim();
    return /^[0-7]+$/.test(value) ? Number.parseInt(value, 8) : null;
  };
  const size = octal(124, 12);
  const checksum = octal(148, 8);
  if (block.length !== 512 || size === null || checksum === null) return null;
  const sum = block.reduce(
    (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  if (sum !== checksum || !text(257, 5).startsWith('ustar')) return null;
  const prefix = text(345, 155);
  const name = `${prefix ? `${prefix}/` : ''}${text(0, 100)}`;
  const flag = text(156, 1);
  return {
    name,
    size,
    kind:
      flag === '' || flag === '0'
        ? 'file'
        : flag === '5'
          ? 'directory'
          : 'other',
  };
}

function closedPaths(entries: readonly LaunchArchiveEntry[]): boolean {
  return (
    new Set(entries.map(({ name }) => name)).size === entries.length &&
    entries.every(({ name, kind }) =>
      kind === 'directory'
        ? DIRECTORIES.includes(name)
        : kind === 'file' && (ROOT_FILES.includes(name) || BLOB.test(name)),
    )
  );
}

/** The single owned reference: anything foreign must never reach the daemon. */
function indexDescriptor(raw: unknown, image: LaunchImage) {
  const index = record(raw);
  if (
    !onlyKeys(index, ['schemaVersion', 'mediaType', 'manifests']) ||
    index.schemaVersion !== 2 ||
    index.mediaType !== INDEX ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== 1
  )
    return null;
  const descriptor = record(index.manifests[0]);
  const platform = descriptor.platform;
  return onlyKeys(descriptor, [
    'mediaType',
    'digest',
    'size',
    'annotations',
    'platform',
  ]) &&
    descriptor.mediaType === MANIFEST &&
    isDigest(descriptor.digest) &&
    same(Object.entries(record(descriptor.annotations)).sort(), [
      ['io.containerd.image.name', `docker.io/library/${image.tag}`],
      ['org.opencontainers.image.ref.name', image.key],
    ]) &&
    (platform == null ||
      same(platform, {
        architecture: image.platform.slice('linux/'.length),
        os: 'linux',
      }))
    ? { digest: descriptor.digest, size: descriptor.size }
    : null;
}

function layerDescriptor(raw: unknown) {
  const layer = record(raw);
  const gzip = LAYER_MEDIA[layer.mediaType as string];
  const annotations = layer.annotations;
  return gzip !== undefined &&
    onlyKeys(layer, ['mediaType', 'digest', 'size', 'annotations']) &&
    isDigest(layer.digest) &&
    Number.isSafeInteger(layer.size) &&
    (annotations === undefined ||
      Object.values(record(annotations)).every(
        (value) => typeof value === 'string',
      ))
    ? {
        mediaType: layer.mediaType as string,
        digest: layer.digest,
        size: layer.size as number,
        gzip,
      }
    : null;
}

function layerDescriptors(raw: readonly unknown[], expected: number) {
  const layers = raw.map(layerDescriptor);
  return layers.length === expected &&
    layers.every((layer) => layer !== null) &&
    new Set(layers.map(({ digest }) => digest)).size === expected
    ? layers
    : null;
}

function manifestDescriptors(raw: unknown) {
  const manifest = record(raw);
  const config = record(manifest.config);
  return onlyKeys(manifest, [
    'schemaVersion',
    'mediaType',
    'config',
    'layers',
  ]) &&
    manifest.schemaVersion === 2 &&
    manifest.mediaType === MANIFEST &&
    config.mediaType === CONFIG &&
    isDigest(config.digest) &&
    onlyKeys(config, ['mediaType', 'digest', 'size']) &&
    Array.isArray(manifest.layers)
    ? {
        config: { digest: config.digest, size: config.size },
        layers: manifest.layers as readonly unknown[],
      }
    : null;
}

function dockerManifestMatches(
  raw: unknown,
  image: LaunchImage,
  config: string,
  layers: readonly (ReturnType<typeof layerDescriptor> & object)[],
  diffIds: readonly string[],
): boolean {
  if (!Array.isArray(raw) || raw.length !== 1) return false;
  const docker = record(raw[0]);
  if (
    !onlyKeys(docker, ['Config', 'RepoTags', 'Layers', 'LayerSources']) ||
    docker.Config !== launchArchiveBlobPath(config) ||
    !same(docker.RepoTags, [image.tag]) ||
    !same(
      docker.Layers,
      layers.map(({ digest }) => launchArchiveBlobPath(digest)),
    )
  )
    return false;
  if (docker.LayerSources === undefined) return true;
  const sources = record(docker.LayerSources);
  return (
    Object.keys(sources).length === layers.length &&
    layers.every(({ mediaType, digest, size }, index) => {
      const source = record(sources[diffIds[index]!]);
      return (
        source.mediaType === mediaType &&
        source.digest === digest &&
        source.size === size
      );
    })
  );
}

function diffIdsOf(raw: unknown, image: LaunchImage): readonly string[] | null {
  const config = record(raw);
  const rootfs = record(config.rootfs);
  const diffIds = rootfs.diff_ids;
  return config.os === 'linux' &&
    config.architecture === image.platform.slice('linux/'.length) &&
    rootfs.type === 'layers' &&
    Array.isArray(diffIds) &&
    diffIds.length === image.native.layers.length + 1 &&
    diffIds.every(isDigest) &&
    same(diffIds.slice(0, -1), image.native.layers)
    ? (diffIds as string[])
    : null;
}

/** Verify the complete graph before anything reaches the daemon; large layer hashes follow. */
export function readLaunchArchiveGraph(
  entries: readonly LaunchArchiveEntry[],
  image: LaunchImage,
): ({ readonly ok: true } & LaunchArchiveGraph) | LaunchArchiveRefusal {
  if (!closedPaths(entries)) return refuseLaunchArchive('inventory');
  const named = new Map(entries.map((entry) => [entry.name, entry]));
  const hashed = (digest: string, size: unknown) => {
    const entry = named.get(launchArchiveBlobPath(digest));
    return entry?.bytes && entry.size === size && sha256(entry.bytes) === digest
      ? entry
      : null;
  };
  if (!same(decoded(named.get('oci-layout')), { imageLayoutVersion: '1.0.0' }))
    return refuseLaunchArchive('layout');
  const descriptor = indexDescriptor(decoded(named.get('index.json')), image);
  if (!descriptor) return refuseLaunchArchive('index');
  const manifestEntry = hashed(descriptor.digest, descriptor.size);
  if (!manifestEntry) return refuseLaunchArchive('manifest-identity');
  const manifest = manifestDescriptors(decoded(manifestEntry));
  if (!manifest) return refuseLaunchArchive('manifest');
  const configDescriptor = manifest.config;
  const configEntry = hashed(configDescriptor.digest, configDescriptor.size);
  if (!configEntry?.bytes) return refuseLaunchArchive('config-identity');
  const diffIds = diffIdsOf(decoded(configEntry), image);
  if (!diffIds) return refuseLaunchArchive('config');
  const resolved = layerDescriptors(manifest.layers, diffIds.length);
  if (!resolved) return refuseLaunchArchive('layers');
  if (
    !dockerManifestMatches(
      decoded(named.get('manifest.json')),
      image,
      configDescriptor.digest,
      resolved,
      diffIds,
    )
  )
    return refuseLaunchArchive('docker-manifest');
  const layerEntries = resolved.map(({ digest, size }) => {
    const entry = named.get(launchArchiveBlobPath(digest));
    return entry?.size === size ? entry : null;
  });
  if (layerEntries.some((entry) => !entry))
    return refuseLaunchArchive('layer-size');
  const required = new Set([
    'index.json',
    'manifest.json',
    'oci-layout',
    manifestEntry.name,
    configEntry.name,
    ...resolved.map(({ digest }) => launchArchiveBlobPath(digest)),
  ]);
  return {
    ok: true,
    manifest: descriptor.digest,
    config: configDescriptor.digest,
    configBytes: configEntry.bytes,
    layers: resolved.map(({ digest, gzip }, index) => ({
      entry: layerEntries[index]!,
      digest,
      diffId: diffIds[index]!,
      gzip,
    })),
    extras: entries.filter(
      ({ name, kind }) => kind === 'file' && !required.has(name),
    ),
    retained: entries.filter(
      ({ name, kind }) => kind === 'directory' || required.has(name),
    ),
  };
}

/** The daemon store family decides which descriptor is its image ID; never either. */
export const launchArchiveImageId = (
  graph: Pick<LaunchArchiveGraph, 'config' | 'manifest'>,
  store: LaunchImage['store'],
) => (store === 'overlay2' ? graph.config : graph.manifest);

export const launchArchiveReceipt = (
  graph: LaunchArchiveGraph,
  image: LaunchImage,
): LaunchArchiveReceipt => ({
  format: launchArchiveFormat,
  key: image.key,
  store: image.store,
  id: launchArchiveImageId(graph, image.store),
  config: graph.config,
  manifest: graph.manifest,
});

/** Restore has one reader: format, input key, measured store family and the verified chain. */
export function launchArchiveReceiptMatches(
  raw: unknown,
  graph: LaunchArchiveGraph,
  image: LaunchImage,
): boolean {
  return same(
    raw && Object.entries(record(raw)).sort(),
    Object.entries(launchArchiveReceipt(graph, image)).sort(),
  );
}
