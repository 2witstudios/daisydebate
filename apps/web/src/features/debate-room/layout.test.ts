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

const custom: LayoutState = {
  ...initialLayout,
  mode: 'custom',
  videoHeight: 200,
};

describe('presets', () => {
  test('autoPreset and effectivePreset', () => {
    assert({
      given: 'each round phase',
      should: 'map to its preset',
      actual: (
        [
          'waiting',
          'opponent-speaking',
          'cross-ex',
          'prep',
          'own-speech',
        ] as const
      ).map(autoPreset),
      expected: ['split', 'split', 'stage', 'focus', 'focus'],
    });
    assert({
      given: 'auto mode during cross-ex',
      should: 'resolve to stage',
      actual: effectivePreset(initialLayout, 'cross-ex'),
      expected: 'stage',
    });
    assert({
      given: 'a chosen preset',
      should: 'keep it regardless of phase',
      actual: effectivePreset(selectMode(initialLayout, 'focus'), 'cross-ex'),
      expected: 'focus',
    });
    assert({
      given: 'custom mode',
      should: 'report custom',
      actual: effectivePreset(custom, 'prep'),
      expected: 'custom',
    });
  });

  test('videoHeightFor', () => {
    assert({
      given: 'auto mode while the opponent speaks',
      should: 'use the split height',
      actual: videoHeightFor(initialLayout, 'opponent-speaking'),
      expected: 340,
    });
    assert({
      given: 'custom mode',
      should: 'use the stored height',
      actual: videoHeightFor(custom, 'prep'),
      expected: 200,
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
      given: 'the video handle dragged down 50px from 130px',
      should: 'grow the video and switch to custom',
      actual: resizeVideo(130, 50),
      expected: { mode: 'custom', videoHeight: 180 },
    });
  });
});

describe('nudgeVideo', () => {
  test('arrow keys', () => {
    assert({
      given: 'ArrowUp on the video in auto focus',
      should: 'shrink from the effective height into custom',
      actual: nudgeVideo(initialLayout, 'prep', 'ArrowUp'),
      expected: { mode: 'custom', videoHeight: 114 },
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
