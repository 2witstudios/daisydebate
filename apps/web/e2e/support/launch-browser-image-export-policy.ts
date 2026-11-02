import { createHash } from 'node:crypto';
import {
  launchArchiveBlobPath,
  launchArchiveImageId,
  refuseLaunchArchive,
  type LaunchArchiveGraph,
  type LaunchArchiveRefusal,
} from './launch-browser-image-archive-policy';
import type { LaunchImage } from './launch-browser-image-policy';

/**
 * Producer-only. Restore never imports this: it is not legacy compatibility,
 * only the proof that what a projection omits is exactly what the exporter wrote.
 */
const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Go's encoding/json escapes these even inside json.RawMessage.
const GO_ESCAPED = new RegExp('[<>&\\u2028\\u2029]', 'g');
const goJson = (value: unknown) =>
  JSON.stringify(value).replace(
    GO_ESCAPED,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
const goObject = (fields: readonly (readonly [string, unknown])[]) =>
  `{${fields.map(([key, value]) => `${goJson(key)}:${goJson(value)}`).join(',')}}`;

/** Marshaled zero value of Moby v28 api/types/container.Config. */
const ZERO_CONTAINER_CONFIG = {
  Hostname: '',
  Domainname: '',
  User: '',
  AttachStdin: false,
  AttachStdout: false,
  AttachStderr: false,
  Tty: false,
  OpenStdin: false,
  StdinOnce: false,
  Env: null,
  Cmd: null,
  Image: '',
  Volumes: null,
  WorkingDir: '',
  Entrypoint: null,
  OnBuild: null,
  Labels: null,
};
/** image.V1Image JSON order, for the fields a final layer inherits from its config. */
const V1_FIELDS = [
  'comment',
  'created',
  'container',
  'container_config',
  'docker_version',
  'author',
  'config',
  'architecture',
  'variant',
  'os',
];

/**
 * Exact bytes of the objects Moby v28 tarexport writes outside the graph on a
 * classic store (saveImage, saveConfig, v1.CreateID and reposLegacy). They are
 * fully determined by the config, so any other byte means an unknown object.
 */
export function launchExporterLegacyObjects(
  configBytes: Uint8Array,
  image: Pick<LaunchImage, 'tag' | 'key'>,
): ReadonlyMap<string, string> {
  const config = record(JSON.parse(new TextDecoder().decode(configBytes)));
  const diffIds = record(config.rootfs).diff_ids as string[];
  const objects = new Map<string, string>();
  let chain = '';
  let parent = '';
  diffIds.forEach((diffId, index) => {
    chain = index === 0 ? diffId : sha256(`${chain} ${diffId}`);
    const final = index === diffIds.length - 1;
    const fields: [string, unknown][] = final
      ? V1_FIELDS.flatMap((key): [string, unknown][] => {
          const value =
            key === 'container_config'
              ? (config[key] ?? ZERO_CONTAINER_CONFIG)
              : config[key];
          return value === undefined || value === '' ? [] : [[key, value]];
        })
      : [
          ['created', '1970-01-01T00:00:00Z'],
          ['container_config', ZERO_CONTAINER_CONFIG],
        ];
    const id = sha256(
      goObject(
        [
          ...fields,
          ['layer_id', chain] as [string, unknown],
          ...(parent ? [['parent', parent] as [string, unknown]] : []),
        ].sort(([left], [right]) => (left < right ? -1 : 1)),
      ),
    );
    const bytes = goObject([
      ['id', id.slice(7)],
      ...(parent ? [['parent', parent.slice(7)] as [string, unknown]] : []),
      ...fields,
      ...(final ? [] : [['os', config.os] as [string, unknown]]),
    ]);
    objects.set(launchArchiveBlobPath(sha256(bytes)), bytes);
    parent = id;
  });
  const [name, tag] = image.tag.split(':') as [string, string];
  objects.set(
    'repositories',
    `${goObject([[name, { [tag]: diffIds.at(-1)!.slice(7) }]])}\n`,
  );
  return objects;
}

/** Decide closed-as-is or an exact omission; an unknown extra never gets filtered. */
export function launchArchiveProjection(
  graph: LaunchArchiveGraph,
  image: LaunchImage,
  id: string,
): { readonly ok: true; readonly omitted: number } | LaunchArchiveRefusal {
  if (launchArchiveImageId(graph, image.store) !== id)
    return refuseLaunchArchive('daemon-identity');
  if (graph.extras.length === 0) return { ok: true, omitted: 0 };
  if (image.store !== 'overlay2') return refuseLaunchArchive('unknown-object');
  const expected = launchExporterLegacyObjects(graph.configBytes, image);
  const exact =
    graph.extras.length === expected.size &&
    graph.extras.every(
      ({ name, bytes }) =>
        bytes !== undefined &&
        expected.get(name) === new TextDecoder().decode(bytes),
    );
  return exact
    ? { ok: true, omitted: graph.extras.length }
    : refuseLaunchArchive('unknown-object');
}
