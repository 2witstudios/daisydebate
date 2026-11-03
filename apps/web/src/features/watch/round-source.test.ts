import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { countHub, listLive } from './list-live';
import { defaultLiveQuery } from './live-query';
import { openSpectate } from './open-spectate';
import { watchSource } from './round-source';
import { defaultSpectateQuery } from './spectate-query';

setupRitewayBun();

const member = { signedIn: true, handle: 'someone' } as const;

describe('watchSource', () => {
  test('holds no Round until the real reads exist', () => {
    assert({
      given: 'the source the Watch pages read',
      should: 'list nothing, count nothing and open nothing',
      actual: {
        live: listLive(defaultLiveQuery, watchSource).total,
        counts: countHub(watchSource),
        spectate: openSpectate(
          'top-of-the-ladder',
          member,
          defaultSpectateQuery,
          watchSource,
        ).kind,
        following: watchSource.following(member),
      },
      expected: {
        live: 0,
        counts: { live: 0, recordings: 0 },
        spectate: 'unavailable',
        following: { people: [], history: [] },
      },
    });
  });

  test('no shipped Watch code imports a sample', async () => {
    const root = join(import.meta.dir, '../..');
    const sources = [
      'features/watch',
      'features/recording',
      'ui/watch',
      'ui/recording',
      'app/(shell)/watch',
      'app/(shell)/recordings',
    ]
      .flatMap((directory) =>
        [...new Glob('**/*.{ts,tsx}').scanSync(join(root, directory))].map(
          (file) => join(directory, file),
        ),
      )
      .filter((file) => !/\.test(-support)?\.tsx?$/.test(file));
    const offenders: string[] = [];
    for (const file of sources)
      if ((await Bun.file(join(root, file)).text()).includes('ui/mock/'))
        offenders.push(file);
    assert({
      given: 'the shipped Watch files, an empty scan failing',
      should: 'import nothing from ui/mock',
      actual: { scanned: sources.length > 50, offenders },
      expected: { scanned: true, offenders: [] },
    });
  });
});
