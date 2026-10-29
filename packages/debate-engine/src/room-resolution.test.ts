import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideRoomResolution } from './room-resolution';

setupRitewayBun();
const publication = {
  id: 'a'.repeat(24),
  kind: 'value' as const,
  text: 'Privacy ought to be valued above public safety.',
  provenance: 'Daisy original',
  publishedAt: '2026-10-29T00:00:00.000Z',
};

describe('decideRoomResolution', () => {
  test('published wording', () => {
    assert({
      given: 'a Value publication resolved by its trusted adapter',
      should: 'use its pinned text and reference',
      actual: decideRoomResolution({
        selection: { kind: 'value', id: publication.id },
        publication,
        formatId: 'value',
        standard: true,
        strikes: false,
      }),
      expected: {
        ok: true,
        topic: publication.text,
        publishedResolutionId: publication.id,
      },
    });
  });
  test('unavailable or mismatched publication', () => {
    assert({
      given:
        'missing publication facts or a Policy request with Value publication facts',
      should: 'refuse instead of guessing a resolution',
      actual: [null, publication].map(
        (facts) =>
          decideRoomResolution({
            selection: { kind: 'policy', id: publication.id },
            publication: facts,
            formatId: 'policy',
            standard: true,
            strikes: false,
          }).ok,
      ),
      expected: [false, false],
    });
  });
  test('standard and Custom methods', () => {
    const input = {
      selection: { kind: 'custom' as const, text: 'A host resolution' },
      publication: null,
      formatId: 'value',
      strikes: false,
    };
    assert({
      given:
        'custom wording submitted as a standard, as Custom, and against strike settings',
      should: 'accept only the Custom fixed-resolution request',
      actual: [
        decideRoomResolution({ ...input, standard: true }).ok,
        decideRoomResolution({ ...input, standard: false }).ok,
        decideRoomResolution({ ...input, standard: false, strikes: true }).ok,
      ],
      expected: [false, true, false],
    });
  });
});
