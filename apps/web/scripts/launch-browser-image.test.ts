import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import {
  launchImageIdentity,
  launchImagePrepareArgs,
  launchImageCommitArgs,
  validateLaunchBase,
  validateLaunchImage,
  validateLaunchPreparation,
  readLaunchArchiveReceipt,
  launchPreparationRemaining,
  validateLaunchArchive,
} from '../e2e/support/launch-browser-image-policy';
setupRitewayBun();
const inputs = {
  version: '1.63.0',
  coreVersion: '1.63.0',
  platform: 'linux/arm64',
  recipe: 'recipe',
  toolchain: 'adapter',
  lock: 'lock',
  refresh: 'noble-nss-2026-11-01-container-1',
};
const imageId = `sha256:${'a'.repeat(64)}`;
const packageHash = `sha256:${'b'.repeat(64)}`;
const imageMetadata = (image: ReturnType<typeof launchImageIdentity>) => ({
  Id: imageId,
  Os: 'linux',
  Architecture: 'arm64',
  Config: {
    Env: image.environment,
    Cmd: ['/bin/bash'],
    Entrypoint: [],
    User: '0:0',
    WorkingDir: '/',
    Labels: { ...image.labels, 'io.daisy.launch.packages': packageHash },
  },
  RootFS: { Layers: [...image.native.layers, packageHash] },
});
const preparationMetadata = (
  image: ReturnType<typeof launchImageIdentity>,
) => ({
  Image: imageId,
  Config: {
    ...imageMetadata(image).Config,
    Cmd: launchImagePrepareArgs(image, 'daisy-image-fixture', imageId).slice(
      launchImagePrepareArgs(image, 'daisy-image-fixture', imageId).indexOf(
        imageId,
      ) + 1,
    ),
    Entrypoint: null,
    Labels: image.preparationLabels,
    Hostname: 'daisy-launch-preparation',
  },
  HostConfig: {
    Binds: null,
    Privileged: false,
    CapAdd: null,
    NetworkMode: 'bridge',
  },
  Mounts: [],
  State: { Status: 'created' },
});

describe('prepared Launch browser identity', () => {
  test('the reviewed port scheme is an explicit exact artifact contract', () => {
    const image = launchImageIdentity(inputs),
      valid = imageMetadata(image);
    const changed = (Labels: Record<string, string>) =>
      validateLaunchImage(
        { ...valid, Config: { ...valid.Config, Labels } },
        image,
      );
    const absent = { ...valid.Config.Labels } as Record<string, string>;
    delete absent['desktop.docker.io/ports.scheme'];
    assert({
      given:
        'the explicit public port scheme, its absence, substitution or an extra Desktop key',
      should: 'construct and accept only the exact reviewed artifact labels',
      actual: [
        launchImageCommitArgs(
          'daisy-image-owned',
          'daisy-launch-preparing:fixture',
          packageHash,
        ).includes('LABEL desktop.docker.io/ports.scheme=v2'),
        validateLaunchImage(valid, image) === imageId,
        changed(absent) === null,
        changed({
          ...valid.Config.Labels,
          'desktop.docker.io/ports.scheme': 'synthetic-credential',
        }) === null,
        changed({
          ...valid.Config.Labels,
          'desktop.docker.io/foreign': 'v2',
        }) === null,
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('only compatible native browser artifacts are admitted', () => {
    for (const changed of [
      { version: '^1.63.0' },
      { coreVersion: '1.62.0' },
      { platform: 'linux/ppc64le' },
    ])
      expect(() => launchImageIdentity({ ...inputs, ...changed })).toThrow(
        'Unsupported Launch browser image inputs',
      );
  });
  test('each preparation input invalidates both image and archive', () => {
    const original = launchImageIdentity(inputs);
    assert({
      given: 'a changed recipe, toolchain, lock, refresh or native platform',
      should: 'never reuse the earlier image identity',
      actual: ['recipe', 'toolchain', 'lock', 'refresh']
        .map(
          (key) =>
            launchImageIdentity({ ...inputs, [key]: 'changed' }).key !==
            original.key,
        )
        .concat(
          launchImageIdentity({ ...inputs, platform: 'linux/amd64' }).key !==
            original.key,
        ),
      expected: [true, true, true, true, true],
    });
  });
  test('preparation cannot inherit proxy credentials or filesystem inputs', () => {
    const image = launchImageIdentity(inputs);
    const args = launchImagePrepareArgs(image, 'daisy-image-owned', imageId);
    assert({
      given: 'the exact native upstream image ID',
      should:
        'create a mount-free owner with explicit empty proxy overrides and no runtime pull',
      actual: {
        image: args.includes(imageId),
        pull: args.includes('--pull=never'),
        stdin: args.includes('--interactive'),
        mounts: args.some((arg) =>
          ['--mount', '-v', '--env-file', '--privileged'].includes(arg),
        ),
        env: args.flatMap((arg, index) =>
          arg === '--env' ? [args[index + 1]] : [],
        ),
      },
      expected: {
        image: true,
        pull: true,
        stdin: true,
        mounts: false,
        env: [
          'HTTP_PROXY=',
          'HTTPS_PROXY=',
          'FTP_PROXY=',
          'ALL_PROXY=',
          'NO_PROXY=',
          'http_proxy=',
          'https_proxy=',
          'ftp_proxy=',
          'all_proxy=',
          'no_proxy=',
        ],
      },
    });
  });
  test('cache metadata, config and native layers are checked even on a cache hit', () => {
    const image = launchImageIdentity(inputs),
      valid = imageMetadata(image);
    assert({
      given:
        'valid, corrupt, wrong-platform, wrong-provenance and wrong-receipt images',
      should: 'accept only the exact expected artifact',
      actual: [
        validateLaunchImage(valid, image, imageId),
        validateLaunchImage(null, image),
        validateLaunchImage({ ...valid, Architecture: 'amd64' }, image),
        validateLaunchImage({ ...valid, RootFS: { Layers: [] } }, image),
        validateLaunchImage(valid, image, packageHash),
      ],
      expected: [imageId, null, null, null, null],
    });
  });
  test('synthetic credentials and unexpected execution config cannot enter an image', () => {
    const image = launchImageIdentity(inputs),
      valid = imageMetadata(image);
    const configs = [
      {
        ...valid.Config,
        Env: [
          ...image.environment.filter(
            (value) => !value.startsWith('HTTP_PROXY='),
          ),
          'HTTP_PROXY=http://synthetic:credential@proxy.invalid',
        ],
      },
      {
        ...valid.Config,
        Env: [...image.environment, 'REGISTRY_AUTH=synthetic-credential'],
      },
      {
        ...valid.Config,
        Labels: { ...valid.Config.Labels, 'private.credential': 'synthetic' },
      },
      { ...valid.Config, Shell: ['sh', '-c'] },
      { ...valid.Config, Hostname: 'synthetic-credential' },
      { ...valid.Config, Image: 'synthetic-credential' },
    ];
    assert({
      given:
        'forged labels alongside synthetic proxy, registry or unexpected config',
      should:
        'reject every credential-bearing artifact without returning its values',
      actual: configs.map(
        (Config) => validateLaunchImage({ ...valid, Config }, image) === null,
      ),
      expected: [true, true, true, true, true, true],
    });
  });
  test('preparation is validated before start and again before commit', () => {
    const image = launchImageIdentity(inputs),
      valid = preparationMetadata(image);
    assert({
      given:
        'created, exited-success, failed and mounted preparation containers',
      should:
        'allow execution/commit only at the expected state with no mounted fixture input',
      actual: [
        validateLaunchPreparation(valid, image, imageId),
        validateLaunchPreparation(
          { ...valid, State: { Status: 'exited', ExitCode: 0 } },
          image,
          imageId,
          true,
        ),
        validateLaunchPreparation(
          { ...valid, State: { Status: 'exited', ExitCode: 1 } },
          image,
          imageId,
          true,
        ),
        validateLaunchPreparation(
          { ...valid, Mounts: [{ Destination: '/fixture' }] },
          image,
          imageId,
        ),
      ],
      expected: [true, true, false, false],
    });
  });
  test('base validation checks published native layers and safe base config', () => {
    const image = launchImageIdentity(inputs);
    const valid = {
      Id: image.labels['io.daisy.launch.upstream'],
      Os: 'linux',
      Architecture: 'arm64',
      RootFS: { Layers: image.native.layers },
      Config: {
        Env: image.environment.slice(0, 4),
        Cmd: ['/bin/bash'],
        Labels: image.baseLabels,
      },
    };
    assert({
      given:
        'the exact native base and a same-label base with injected environment',
      should: 'verify original bytes/config rather than trusting labels',
      actual: [
        validateLaunchBase(valid, image),
        validateLaunchBase(
          {
            ...valid,
            Config: { ...valid.Config, Env: ['HTTP_PROXY=synthetic'] },
          },
          image,
        ),
      ],
      expected: [valid.Id, null],
    });
  });
});
test('a restored receipt cannot supply a foreign content identity', () => {
  const image = launchImageIdentity(inputs);
  assert({
    given: 'matching, stale, corrupt and malformed image receipts',
    should: 'admit only the expected immutable image reference',
    actual: [
      readLaunchArchiveReceipt({ key: image.key, id: imageId }, image.key),
      readLaunchArchiveReceipt({ key: 'old', id: imageId }, image.key),
      readLaunchArchiveReceipt({ key: image.key, id: 'latest' }, image.key),
      readLaunchArchiveReceipt(null, image.key),
    ],
    expected: [imageId, null, null, null],
  });
});
test('preparation leaves a real reserved cleanup window', () => {
  assert({
    given:
      'an eight-minute budget at start, operation deadline and cleanup deadline',
    should:
      'stop work before the backend cleanup reserve and never grant extra time',
    actual: [
      launchPreparationRemaining(480000, 0, false),
      launchPreparationRemaining(480000, 450000, false),
      launchPreparationRemaining(480000, 450000, true),
      launchPreparationRemaining(480000, 480001, true),
    ],
    expected: [450000, 0, 30000, 0],
  });
});
test('equivalent image inputs have one identity independent of insertion order', () => {
  assert({
    given: 'the same logical preparation inputs in a different property order',
    should: 'reuse the exact image and archive key',
    actual: launchImageIdentity(
      Object.fromEntries(Object.entries(inputs).reverse()) as typeof inputs,
    ).key,
    expected: launchImageIdentity(inputs).key,
  });
});
test('only the committed recipe provisions tooling; fixture trust remains runtime-only', async () => {
  const recipe = await Bun.file(
    new URL('../e2e/support/launch-browser-image-recipe.sh', import.meta.url),
  ).text();
  const shell = await Bun.file(
    new URL('../e2e/support/launch-browser-container.sh', import.meta.url),
  ).text();
  assert({
    given: 'the committed preparation recipe and runtime entry point',
    should:
      'bound package acquisition and record packages without importing fixture trust',
    actual: {
      bounded:
        recipe.includes('--max-time 45') &&
        recipe.includes('--retry-max-time 90'),
      inventory: recipe.includes('dpkg-query -W'),
      noApt: !recipe.includes('apt-get'),
      verifiesArtifact:
        recipe.includes('sha256sum -c') &&
        recipe.includes('dpkg-deb -f') &&
        recipe.includes('dpkg --compare-versions'),
      importsTrust: /certutil -A|update-ca-certificates|cp .*ca\.crt/.test(
        recipe,
      ),
      runtimeApt: /apt-get/.test(shell),
      freshCa: shell.includes('-i /fixture/ca.crt'),
    },
    expected: {
      bounded: true,
      inventory: true,
      noApt: true,
      verifiesArtifact: true,
      importsTrust: false,
      runtimeApt: false,
      freshCa: true,
    },
  });
});

test('Docker-normalized label order and explicit bridge mode preserve safe preparation', () => {
  const image = launchImageIdentity(inputs),
    valid = preparationMetadata(image);
  const normalized = {
    ...valid,
    Config: {
      ...valid.Config,
      Labels: Object.fromEntries(
        Object.entries(image.preparationLabels).reverse(),
      ),
    },
    HostConfig: { ...valid.HostConfig, NetworkMode: 'bridge' },
  };
  assert({
    given:
      'Docker returns the same labels in another order and resolves its network to bridge',
    should: 'admit the exact safe native preparation configuration',
    actual: validateLaunchPreparation(normalized, image, imageId),
    expected: true,
  });
});

test('archive preflight cannot overwrite foreign daemon image references', () => {
  const image = launchImageIdentity(inputs);
  const manifest = {
    Config: `${'c'.repeat(64)}.json`,
    RepoTags: [image.tag],
    Layers: Array.from(
      { length: image.native.layers.length + 1 },
      () => `${'d'.repeat(64)}/layer.tar`,
    ),
  };
  assert({
    given:
      'one exact artifact, a foreign tag, multiple images and unsafe paths',
    should: 'allow only the owned cache reference before Docker load',
    actual: [
      validateLaunchArchive([manifest], image),
      validateLaunchArchive(
        [{ ...manifest, RepoTags: ['foreign:latest'] }],
        image,
      ),
      validateLaunchArchive([manifest, manifest], image),
      validateLaunchArchive([{ ...manifest, Config: '../../private' }], image),
    ],
    expected: [true, false, false, false],
  });
});

test('native artifact and complete dependency contract are explicit recipe inputs', () => {
  const image = launchImageIdentity(inputs),
    args = launchImagePrepareArgs(image, 'daisy-image-artifact', imageId);
  assert({
    given: 'the published arm64 NSS binary and frozen base dependency contract',
    should:
      'bind HTTPS URL, SHA256, size, version, architecture and Debian minimum versions into the recipe invocation',
    actual: args.slice(args.indexOf(imageId) + 1),
    expected: [
      'sh',
      '-s',
      '--',
      '2:3.98-1ubuntu0.3',
      'arm64',
      'https://ports.ubuntu.com/ubuntu-ports/pool/main/n/nss/libnss3-tools_3.98-1ubuntu0.3_arm64.deb',
      'f6f1f244dcf90322f2c8733589c35ee0c66f647ea065b1ac9f5452afe110c4dd',
      '597572',
      'libc6 (>= 2.34), libnspr4 (>= 2:4.34), libnss3 (>= 2:3.94), zlib1g (>= 1:1.1.4)',
      'libc6',
      '2.34',
      'libnspr4',
      '2:4.34',
      'libnss3',
      '2:3.94',
      'zlib1g',
      '1:1.1.4',
    ],
  });
});

test('preparation preserves the verified base entrypoint instead of inheriting a shell', () => {
  const image = launchImageIdentity(inputs),
    args = launchImagePrepareArgs(image, 'daisy-image-entrypoint', imageId);
  assert({
    given: 'a verified upstream image with no entrypoint',
    should:
      'run the recipe as an explicit command so commit cannot inherit a preparation shell',
    actual: {
      override: args.includes('--entrypoint'),
      command: args[args.indexOf(imageId) + 1],
    },
    expected: { override: false, command: 'sh' },
  });
});
test('a committed image has the canonical empty hostname without accepting foreign host data', () => {
  const image = launchImageIdentity(inputs),
    valid = imageMetadata(image);
  assert({
    given: 'Docker clears the disposable container hostname at commit',
    should:
      'admit only absent or empty final hostname and reject foreign values',
    actual: [
      validateLaunchImage(
        { ...valid, Config: { ...valid.Config, Hostname: '' } },
        image,
      ),
      validateLaunchImage(
        {
          ...valid,
          Config: { ...valid.Config, Hostname: 'synthetic-private' },
        },
        image,
      ),
    ],
    expected: [imageId, null],
  });
});
