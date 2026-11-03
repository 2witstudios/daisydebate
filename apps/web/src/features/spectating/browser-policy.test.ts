import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  broadcastDocumentStale,
  broadcastPlaybackOrigin,
} from './browser-policy';

setupRitewayBun();

const FEED = 'https://bucket.t3.tigrisfiles.io';

describe('broadcastPlaybackOrigin', () => {
  test('only the Round page plays a feed', () => {
    assert({
      given: 'the Round page',
      should: 'allow the configured origin',
      actual: broadcastPlaybackOrigin('/watch/abc', FEED),
      expected: FEED,
    });
    assert({
      given: 'the hub, a deeper path and any other page',
      should: 'allow nothing',
      actual: ['/watch', '/watch/abc/more', '/lobby', '/recordings/abc'].map(
        (path) => broadcastPlaybackOrigin(path, FEED),
      ),
      expected: [null, null, null, null],
    });
  });

  test('a bad or missing origin', () => {
    assert({
      given: 'no origin, and a value that is no URL',
      should: 'allow nothing',
      actual: [
        broadcastPlaybackOrigin('/watch/abc', null),
        broadcastPlaybackOrigin('/watch/abc', 'not a url'),
      ],
      expected: [null, null],
    });
  });
});

describe('broadcastDocumentStale', () => {
  test('a document keeps the policy it loaded with', () => {
    const at = 'https://daisy.invalid';
    assert({
      given: 'the Round page, reached from the hub',
      should: 'be stale, since the hub document refuses the feed',
      actual: broadcastDocumentStale(`${at}/watch`, '/watch/abc'),
      expected: true,
    });
    assert({
      given: 'a document loaded as a Round page, then another Round',
      should: 'not be stale',
      actual: broadcastDocumentStale(`${at}/watch/abc`, '/watch/def'),
      expected: false,
    });
    assert({
      given: 'an unknown document URL, and any other page',
      should: 'never reload',
      actual: [
        broadcastDocumentStale(undefined, '/watch/abc'),
        broadcastDocumentStale(`${at}/lobby`, '/watch'),
      ],
      expected: [false, false],
    });
  });
});
