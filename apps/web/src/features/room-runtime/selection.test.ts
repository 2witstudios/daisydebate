import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedIds } from '@daisy/clock';
import { assertRejects } from '@daisy/errors/testing';
import { resolveRoomSelection } from './selection';
import { freestyleFacts } from './catalog-sources.test-support';

setupRitewayBun();

test('Custom creation keeps a validated catalog basis and publication recheck', async () => {
  const basis = {
    formatId: freestyleFacts.format.id,
    formatVersion: freestyleFacts.preset.formatVersion,
    presetVersion: freestyleFacts.preset.version,
  };
  const result = await resolveRoomSelection(
    {
      commandId: 'c'.repeat(24),
      title: 'Custom practice',
      visibility: 'unlisted',
      resolution: { kind: 'custom', text: 'A custom resolution' },
      selection: {
        kind: 'custom',
        definition: freestyleFacts.definition,
        config: freestyleFacts.preset.config,
        competitionType: 'casual',
        basis,
      },
    },
    { getFormatSelectionFacts: async () => freestyleFacts },
    fixedIds(['f'.repeat(24)]),
  );
  assert({
    given: 'a Custom definition based on an available Freestyle preset',
    should: 'retain its basis and recheck it inside the writer',
    actual: [
      result.basis,
      result.recheck?.admits(freestyleFacts),
      result.recheck?.admits(null),
    ],
    expected: [
      { formatId: basis.formatId, presetVersion: basis.presetVersion },
      true,
      false,
    ],
  });
});

test('a withdrawn catalog format refuses with its word (ISSUE-1010)', async () => {
  await assertRejects({
    given: 'a create naming a format the catalog no longer holds',
    should: 'refuse with the reason the Room route answers',
    actual: () =>
      resolveRoomSelection(
        {
          commandId: 'c'.repeat(24),
          title: 'Practice',
          visibility: 'unlisted',
          resolution: { kind: 'custom', text: 'A custom resolution' },
          selection: {
            kind: 'catalog',
            formatId: freestyleFacts.format.id,
            formatVersion: freestyleFacts.preset.formatVersion,
            presetVersion: freestyleFacts.preset.version,
            competitionType: 'casual',
          },
        },
        { getFormatSelectionFacts: async () => null },
        fixedIds(['f'.repeat(24)]),
      ),
    code: 'VALIDATION',
    reason: 'format-unavailable',
  });
});
