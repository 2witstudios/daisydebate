import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedIds } from '@daisy/clock';
import { resolveRoomSelection } from './selection';
import { valueFacts } from './catalog-sources.test-support';

setupRitewayBun();

test('Custom creation keeps a validated catalog basis and publication recheck', async () => {
  const basis = {
    formatId: valueFacts.format.id,
    formatVersion: valueFacts.preset.formatVersion,
    presetVersion: valueFacts.preset.version,
  };
  const result = await resolveRoomSelection(
    {
      commandId: 'c'.repeat(24),
      title: 'Custom practice',
      visibility: 'unlisted',
      resolution: { kind: 'custom', text: 'A custom resolution' },
      selection: {
        kind: 'custom',
        definition: valueFacts.definition,
        config: valueFacts.preset.config,
        competitionType: 'casual',
        basis,
      },
    },
    { getFormatSelectionFacts: async () => valueFacts },
    fixedIds(['f'.repeat(24)]),
  );
  assert({
    given: 'a Custom definition based on an available Value preset',
    should: 'retain its basis and recheck it inside the writer',
    actual: [
      result.basis,
      result.recheck?.admits(valueFacts),
      result.recheck?.admits(null),
    ],
    expected: [
      { formatId: basis.formatId, presetVersion: basis.presetVersion },
      true,
      false,
    ],
  });
});
