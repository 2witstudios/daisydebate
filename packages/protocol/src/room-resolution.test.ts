import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomResolutionSelectionSchema } from './room-resolution';

setupRitewayBun();

describe('roomResolutionSelectionSchema', () => {
  test('resolution methods', () => {
    assert({
      given: 'published Policy and Value resolutions, a strike, or custom text',
      should: 'accept only the four explicit methods with their own inputs',
      actual: [
        { kind: 'policy', id: 'a'.repeat(24) },
        { kind: 'value', id: 'b'.repeat(24) },
        { kind: 'strike' },
        { kind: 'custom', text: '  Cities should make public transit free.  ' },
      ].map((selection) => roomResolutionSelectionSchema.parse(selection)),
      expected: [
        { kind: 'policy', id: 'a'.repeat(24) },
        { kind: 'value', id: 'b'.repeat(24) },
        { kind: 'strike' },
        { kind: 'custom', text: 'Cities should make public transit free.' },
      ],
    });
  });

  test('invalid resolution inputs', () => {
    assert({
      given:
        'blank custom text, host text for published choices, or strike settings',
      should: 'refuse inputs outside the chosen resolution method',
      actual: [
        { kind: 'custom', text: ' ' },
        { kind: 'policy', id: 'a'.repeat(24), text: 'Injected resolution' },
        { kind: 'strike', drawSize: 3 },
        { kind: 'seasonal' },
      ].map(
        (selection) =>
          roomResolutionSelectionSchema.safeParse(selection).success,
      ),
      expected: [false, false, false, false],
    });
  });
});
