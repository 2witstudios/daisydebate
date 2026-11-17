import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomResolutionSelectionSchema } from './room-resolution';

setupRitewayBun();

describe('roomResolutionSelectionSchema', () => {
  test('resolution methods', () => {
    assert({
      given: 'a strike or custom text',
      should: 'accept only the two explicit methods with their own inputs',
      actual: [
        { kind: 'strike' },
        { kind: 'custom', text: '  Cities should make public transit free.  ' },
      ].map((selection) => roomResolutionSelectionSchema.parse(selection)),
      expected: [
        { kind: 'strike' },
        { kind: 'custom', text: 'Cities should make public transit free.' },
      ],
    });
  });

  test('invalid resolution inputs', () => {
    assert({
      given:
        'blank custom text, the deleted Policy and Value publications, or strike settings',
      should: 'refuse inputs outside the chosen resolution method',
      actual: [
        { kind: 'custom', text: ' ' },
        { kind: 'policy', id: 'a'.repeat(24) },
        { kind: 'value', id: 'b'.repeat(24) },
        { kind: 'strike', drawSize: 3 },
        { kind: 'seasonal' },
      ].map(
        (selection) =>
          roomResolutionSelectionSchema.safeParse(selection).success,
      ),
      expected: [false, false, false, false, false],
    });
  });
});
