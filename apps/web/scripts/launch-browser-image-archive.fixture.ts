import { createHash } from 'node:crypto';
import { launchImageIdentity } from '../e2e/support/launch-browser-image-policy';

export const sha = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const blob = (digest: string) => `blobs/sha256/${digest.slice(7)}`;

export function tarEntry(
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
export const tarOf = (entries: Record<string, string | Uint8Array>) =>
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
export function classicExport() {
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
