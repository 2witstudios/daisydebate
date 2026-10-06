import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  autoPreset,
  clampPane,
  effectivePreset,
  initialLayout,
  nudgePane,
  resizePane,
  selectMode,
  togglePanel,
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
        ['opponent-speaking', 'cross-ex', 'prep', 'own-speech'] as const
      ).map(autoPreset),
      expected: ['split', 'stage', 'focus', 'focus'],
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

describe('clampPane', () => {
  test('rounding and bounds', () => {
    assert({
      given: 'a fractional tree width inside bounds',
      should: 'round it',
      actual: clampPane('tree', 200.6),
      expected: 201,
    });
    assert({
      given: 'a sidebar width below its minimum',
      should: 'clamp to the minimum',
      actual: clampPane('sidebar', 10),
      expected: 260,
    });
    assert({
      given: 'a video height above its maximum',
      should: 'clamp to the maximum',
      actual: clampPane('video', 9_000),
      expected: 480,
    });
  });
});

describe('resizePane', () => {
  test('directions', () => {
    assert({
      given: 'the tree handle dragged right',
      should: 'widen the tree',
      actual: resizePane(initialLayout, 'prep', 'tree', 220, 30).treeWidth,
      expected: 250,
    });
    assert({
      given: 'the sidebar handle dragged right',
      should: 'narrow the sidebar',
      actual: resizePane(initialLayout, 'prep', 'sidebar', 340, 30)
        .sidebarWidth,
      expected: 310,
    });
    assert({
      given: 'the video handle dragged down',
      should: 'grow the video and switch to custom',
      actual: resizePane(initialLayout, 'prep', 'video', 130, 50),
      expected: { ...initialLayout, mode: 'custom', videoHeight: 180 },
    });
  });
});

describe('nudgePane', () => {
  test('arrow keys', () => {
    assert({
      given: 'ArrowRight on the tree',
      should: 'widen it by 16',
      actual: nudgePane(initialLayout, 'prep', 'tree', 'ArrowRight').treeWidth,
      expected: 236,
    });
    assert({
      given: 'ArrowLeft on the sidebar',
      should: 'widen it by 16 (handle on its left edge)',
      actual: nudgePane(initialLayout, 'prep', 'sidebar', 'ArrowLeft')
        .sidebarWidth,
      expected: 356,
    });
    assert({
      given: 'ArrowUp on the video in auto focus',
      should: 'shrink from the effective height into custom',
      actual: nudgePane(initialLayout, 'prep', 'video', 'ArrowUp'),
      expected: { ...initialLayout, mode: 'custom', videoHeight: 114 },
    });
    assert({
      given: 'any other key',
      should: 'return the state unchanged',
      actual: nudgePane(initialLayout, 'prep', 'tree', 'Enter'),
      expected: initialLayout,
    });
  });
});

describe('panels', () => {
  test('togglePanel keeps widths', () => {
    const hidden = togglePanel({ ...initialLayout, treeWidth: 300 }, 'tree');
    assert({
      given: 'an open tree toggled',
      should: 'hide it and keep its width',
      actual: { open: hidden.treeOpen, width: hidden.treeWidth },
      expected: { open: false, width: 300 },
    });
    assert({
      given: 'an open sidebar toggled twice',
      should: 'be open again',
      actual: togglePanel(togglePanel(initialLayout, 'sidebar'), 'sidebar'),
      expected: initialLayout,
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
