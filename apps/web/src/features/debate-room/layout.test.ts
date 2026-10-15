import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  autoPreset,
  clampVideo,
  effectivePreset,
  initialLayout,
  nudgeVideo,
  resizeVideo,
  selectMode,
  videoHeightFor,
  workspaceMinHeight,
  type LayoutState,
} from './layout';

setupRitewayBun();

const pinned: LayoutState = { mode: 'speaker', videoHeight: 200 };

describe('presets', () => {
  test('autoPreset', () => {
    assert({
      given: 'each round phase',
      should:
        'put the opponent’s speech on the speaker, cross-ex on equal tiles, prep and your speech on the document, judging and waiting in conversation',
      actual: (
        [
          'waiting',
          'opponent-speaking',
          'cross-ex',
          'prep',
          'own-speech',
          'judging',
        ] as const
      ).map(autoPreset),
      expected: [
        'conversation',
        'speaker',
        'stage',
        'focus',
        'focus',
        'conversation',
      ],
    });
  });

  test('effectivePreset', () => {
    assert({
      given: 'Auto during cross-ex',
      should: 'resolve to stage',
      actual: effectivePreset(initialLayout, 'cross-ex'),
      expected: 'stage',
    });
    assert({
      given: 'a chosen preset',
      should: 'keep it whatever the phase',
      actual: effectivePreset(selectMode('focus'), 'cross-ex'),
      expected: 'focus',
    });
  });

  test('videoHeightFor', () => {
    assert({
      given: 'Auto while the opponent speaks, and during prep',
      should: 'use the speaker and focus heights',
      actual: [
        videoHeightFor(initialLayout, 'opponent-speaking'),
        videoHeightFor(initialLayout, 'prep'),
        videoHeightFor(initialLayout, 'judging'),
      ],
      expected: [420, 130, 300],
    });
    assert({
      given: 'a layout pinned by a resize',
      should: 'use the height the debater chose',
      actual: videoHeightFor(pinned, 'prep'),
      expected: 200,
    });
  });
});

describe('selectMode', () => {
  test('menu choices', () => {
    assert({
      given: 'a resized layout and the debater choosing Auto',
      should: 'unpin it and drop the chosen height',
      actual: selectMode('auto'),
      expected: initialLayout,
    });
    assert({
      given: 'a resized layout and the debater choosing a preset',
      should: 'pin that preset at its own height',
      actual: videoHeightFor(selectMode('stage'), 'prep'),
      expected: 420,
    });
  });
});

describe('clampVideo', () => {
  test('rounding and bounds', () => {
    assert({
      given: 'heights inside, below and above the bounds',
      should: 'round inside and clamp outside',
      actual: [clampVideo(200.6), clampVideo(10), clampVideo(9_000)],
      expected: [201, 100, 480],
    });
  });
});

describe('resizeVideo', () => {
  test('a drag pins the layout', () => {
    assert({
      given: 'the handle dragged down 50px from 130px under Auto during prep',
      should: 'grow the video and pin the preset Auto had chosen',
      actual: resizeVideo(initialLayout, 'prep', 130, 50),
      expected: { mode: 'focus', videoHeight: 180 },
    });
    assert({
      given: 'a drag on a layout already pinned to a preset',
      should: 'keep that preset',
      actual: resizeVideo(pinned, 'cross-ex', 200, -20),
      expected: { mode: 'speaker', videoHeight: 180 },
    });
  });
});

describe('nudgeVideo', () => {
  test('arrow keys', () => {
    assert({
      given: 'ArrowUp on the video under Auto during prep',
      should: 'shrink from the shown height and pin focus',
      actual: nudgeVideo(initialLayout, 'prep', 'ArrowUp'),
      expected: { mode: 'focus', videoHeight: 114 },
    });
    assert({
      given: 'a horizontal arrow or any other key',
      should: 'return the state unchanged',
      actual: [
        nudgeVideo(initialLayout, 'prep', 'ArrowLeft'),
        nudgeVideo(initialLayout, 'prep', 'Enter'),
      ],
      expected: [initialLayout, initialLayout],
    });
  });
});

describe('workspaceMinHeight', () => {
  test('floor and subtraction', () => {
    assert({
      given: 'a short video',
      should: 'leave the rest of the viewport budget',
      actual: workspaceMinHeight(130),
      expected: 726,
    });
    assert({
      given: 'a tall video',
      should: 'never drop below 380',
      actual: workspaceMinHeight(480),
      expected: 380,
    });
  });
});
