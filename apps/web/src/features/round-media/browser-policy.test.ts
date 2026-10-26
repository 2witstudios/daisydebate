import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isRoundMediaHref, mediaDocumentStale } from './browser-policy';
setupRitewayBun();

describe('isRoundMediaHref', () => {
  test('media pages, with or without a query', () => {
    assert({
      given: 'each media page href, one with a query and a hash',
      should: 'name a round media page',
      actual: [
        '/rooms/abc',
        '/rounds/abc',
        '/rounds/abc/room',
        '/rooms/abc?notice=command-refused#seats',
      ].map(isRoundMediaHref),
      expected: [true, true, true, true],
    });
  });

  test('pages that receive no capture exception', () => {
    assert({
      given: 'lobby, rematch, ballot and API hrefs',
      should: 'not name a round media page',
      actual: [
        '/lobby',
        '/rooms/abc/rematch',
        '/rounds/abc/ballot',
        '/api/rooms/abc/commands',
      ].map(isRoundMediaHref),
      expected: [false, false, false, false],
    });
  });
});

describe('mediaDocumentStale', () => {
  test('a media page entered in-app from a non-media document', () => {
    assert({
      given: 'a document loaded as the lobby now showing a room',
      should: 'need its own document load for the room policy',
      actual: [
        mediaDocumentStale('https://daisy.test/lobby?q=a', '/rooms/abc'),
        mediaDocumentStale('https://daisy.test/play/room', '/rooms/abc?n=1'),
      ],
      expected: [true, true],
    });
  });

  test('a document already loaded as a media page', () => {
    assert({
      given: 'a document loaded as one media page showing another',
      should: 'keep the document: both carry the media policy',
      actual: [
        mediaDocumentStale('https://daisy.test/rooms/abc', '/rooms/abc'),
        mediaDocumentStale('https://daisy.test/rounds/abc', '/rounds/abc/room'),
      ],
      expected: [false, false],
    });
  });

  test('no navigation record or a non-media path', () => {
    assert({
      given: 'an unknown document URL, or a path that is not a media page',
      should: 'never need a document load',
      actual: [
        mediaDocumentStale(undefined, '/rooms/abc'),
        mediaDocumentStale('https://daisy.test/lobby', '/rooms/abc/rematch'),
        mediaDocumentStale('https://daisy.test/lobby', '/lobby?q=a'),
      ],
      expected: [false, false, false],
    });
  });
});
