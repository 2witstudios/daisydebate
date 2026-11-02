import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomTemplate } from '../rooms/read-catalog';
import { challengeRefusal } from './forms';
import { challengeRoomForm, templateFor } from './room';

setupRitewayBun();

const template = {
  formatId: 'freestyle',
  formatVersion: 2,
  preset: {
    version: 3,
    config: { resolutionDraw: { enabled: true } },
  },
} as unknown as RoomTemplate;

const form = (mode: 'ranked' | 'casual') =>
  challengeRoomForm({
    host: 'bea',
    opponent: 'ada',
    mode,
    template,
    commandId: 'c'.repeat(24),
    resolutions: [],
  });

describe('challengeRoomForm', () => {
  test('an unlisted room on the agreed format, named for both', () => {
    const made = form('casual');
    assert({
      given: 'a casual challenge',
      should: 'keep the room unlisted and casual, naming the challenger first',
      actual: [
        made.get('title'),
        made.get('visibility'),
        made.get('resolutionMethod'),
        JSON.parse(String(made.get('selection'))),
      ],
      expected: [
        '@ada vs @bea',
        'unlisted',
        'strike',
        {
          kind: 'catalog',
          formatId: 'freestyle',
          formatVersion: 2,
          presetVersion: 3,
          competitionType: 'casual',
        },
      ],
    });
  });
  test('ranked takes the ranked selection, and so its judge requirement', () => {
    assert({
      given: 'a ranked challenge',
      should: 'use the ranked selection, in public so a judge can find it',
      actual: [
        JSON.parse(String(form('ranked').get('selection'))),
        form('ranked').get('visibility'),
      ],
      expected: [
        {
          kind: 'ranked',
          formatId: 'freestyle',
          formatVersion: 2,
          presetVersion: 3,
        },
        'public',
      ],
    });
  });
});

describe('templateFor', () => {
  test('finds the format, or nothing', () => {
    assert({
      given: 'a catalog with Freestyle only',
      should: 'find it and miss Policy',
      actual: [
        templateFor([template], 'freestyle'),
        templateFor([template], 'policy'),
      ],
      expected: [template, undefined],
    });
  });
});

describe('challengeRefusal', () => {
  test('never says why someone else cannot be challenged', () => {
    assert({
      given: 'the one answer for a block, no lease, Busy or being placed',
      should: 'name no reason, while the caller’s own room is theirs to know',
      actual: [challengeRefusal('send', 404), challengeRefusal('send', 409)],
      expected: [
        'They cannot take a challenge right now.',
        'Leave your room first.',
      ],
    });
  });
});
