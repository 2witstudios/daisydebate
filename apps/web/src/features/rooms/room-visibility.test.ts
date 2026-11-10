import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultRoomVisibility,
  roomVisibilityChoices,
} from './room-visibility';

setupRitewayBun();

describe('room visibility', () => {
  test('a Room nobody chose a visibility for is public', () => {
    assert({
      given: 'the default Room visibility',
      should: 'be public (owner, 2026-11-10): never unlisted',
      actual: defaultRoomVisibility,
      expected: 'public',
    });
  });

  test('the host is offered public first, and never private yet', () => {
    assert({
      given: 'the visibility choices a host sees',
      should: 'list public first, then unlisted, and no private (ISSUE-443)',
      actual: roomVisibilityChoices.map((choice) => choice.value),
      expected: ['public', 'unlisted'],
    });
  });
});
