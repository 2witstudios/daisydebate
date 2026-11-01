import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import {
  launchImageIdentity,
  launchImageBuildArgs,
  validateLaunchImage,
  readLaunchArchiveReceipt,
  launchPreparationRemaining,
} from '../e2e/support/launch-browser-image-policy';
setupRitewayBun();
const inputs = {
  version: '1.63.0',
  coreVersion: '1.63.0',
  platform: 'linux/arm64',
  dockerfile: 'recipe',
  toolchain: 'adapter',
  lock: 'lock',
  refresh: 'noble-nss-2026-11-01',
};
describe('prepared Launch browser identity', () => {
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
      actual: ['dockerfile', 'toolchain', 'lock', 'refresh']
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
  test('preparation has no checkout context or publication', () => {
    const image = launchImageIdentity(inputs);
    const args = launchImageBuildArgs(image, 'owned-builder');
    assert({
      given: 'the exact prepared image contract',
      should:
        'build only stdin using an explicit owned builder, native platform and immutable base',
      actual: {
        context: args.at(-1),
        builder: args[args.indexOf('--builder') + 1],
        platform: args[args.indexOf('--platform') + 1],
        publishes: args.includes('--push'),
        loads: args.includes('--load'),
        pinned: args.some((arg) =>
          arg.includes(
            'sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27',
          ),
        ),
      },
      expected: {
        context: '-',
        builder: 'owned-builder',
        platform: 'linux/arm64',
        publishes: false,
        loads: true,
        pinned: true,
      },
    });
  });
  test('cache metadata is consistency checked even on a cache hit', () => {
    const image = launchImageIdentity(inputs);
    const id = `sha256:${'a'.repeat(64)}`;
    const valid = {
      Id: id,
      Os: 'linux',
      Architecture: 'arm64',
      Config: { Labels: image.labels },
    };
    assert({
      given:
        'valid, corrupt, wrong-platform, wrong-provenance and wrong-receipt images',
      should: 'accept only the exact expected artifact',
      actual: [
        validateLaunchImage(valid, image, id),
        validateLaunchImage(null, image),
        validateLaunchImage({ ...valid, Architecture: 'amd64' }, image),
        validateLaunchImage({ ...valid, Config: { Labels: {} } }, image),
        validateLaunchImage(valid, image, `sha256:${'b'.repeat(64)}`),
      ],
      expected: [id, null, null, null, null],
    });
  });
});

test('a restored receipt cannot supply a foreign content identity', () => {
  const image = launchImageIdentity(inputs);
  const id = `sha256:${'a'.repeat(64)}`;
  assert({
    given: 'matching, stale, corrupt and malformed image receipts',
    should: 'admit only the expected immutable image reference',
    actual: [
      readLaunchArchiveReceipt({ key: image.key, id }, image.key),
      readLaunchArchiveReceipt({ key: 'old', id }, image.key),
      readLaunchArchiveReceipt({ key: image.key, id: 'latest' }, image.key),
      readLaunchArchiveReceipt(null, image.key),
    ],
    expected: [id, null, null, null],
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

test('equivalent image inputs have one identity independent of object insertion order', () => {
  assert({
    given: 'the same logical preparation inputs in a different property order',
    should: 'reuse the exact image and archive key',
    actual: launchImageIdentity(
      Object.fromEntries(Object.entries(inputs).reverse()) as typeof inputs,
    ).key,
    expected: launchImageIdentity(inputs).key,
  });
});
