import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { freestyleChoice, unequalTemplate } from './assembly.test-support';
import {
  createRoomDraft,
  editRoomDraft,
  selectRoomResolution,
  setDraftRanked,
} from './create-room-draft';

setupRitewayBun();

describe('create-room draft', () => {
  test('standards and template identity', () => {
    const standard = createRoomDraft(freestyleChoice);
    const template = createRoomDraft(unequalTemplate);
    assert({
      given:
        'a standard and a league template with unequal seats and overridden timings',
      should:
        'retain complete settings while only the standard starts as standard',
      actual: [
        standard.custom,
        template.custom,
        template.basis.formatId,
        template.config.speechTiming,
        standard.resolutionMethod,
      ],
      expected: [
        false,
        true,
        unequalTemplate.formatId,
        unequalTemplate.preset.config.speechTiming,
        'strike',
      ],
    });
  });

  test('editing a ranked draft', () => {
    const original = setDraftRanked(
      createRoomDraft(freestyleChoice),
      true,
      true,
    );
    const edited = editRoomDraft(original, {
      config: { ...original.config, preRoundPrep: { enabled: false } },
    });
    assert({
      given: 'a ranked standard draft whose host changes preparation',
      should:
        'keep the edit and its basis, select Custom, clear Ranked and leave the original unchanged',
      actual: [
        edited.custom,
        edited.ranked,
        edited.config.preRoundPrep.enabled,
        edited.basis.formatId,
        original.custom,
        original.ranked,
      ],
      expected: [true, false, false, 'freestyle', false, true],
    });
  });

  test('resolution changes and ranking', () => {
    const original = createRoomDraft(freestyleChoice);
    const custom = selectRoomResolution(original, 'custom');
    assert({
      given:
        'a standard changed to a custom resolution and a ranked attempt on it',
      should:
        'keep the Custom draft unranked even when the preset itself is eligible',
      actual: [
        custom.resolutionMethod,
        custom.custom,
        setDraftRanked(custom, true, true).ranked,
        setDraftRanked(original, true, false).ranked,
      ],
      expected: ['custom', true, false, false],
    });
  });
});
