export type RoundPhase =
  'opponent-speaking' | 'cross-ex' | 'prep' | 'own-speech';
export type LayoutPreset = 'stage' | 'split' | 'focus';
export type LayoutMode = 'auto' | LayoutPreset | 'custom';
export type Pane = 'tree' | 'sidebar' | 'video';
export type Panel = 'tree' | 'sidebar';

export type LayoutState = {
  readonly mode: LayoutMode;
  readonly videoHeight: number;
  readonly treeWidth: number;
  readonly sidebarWidth: number;
  readonly treeOpen: boolean;
  readonly sidebarOpen: boolean;
};

export const paneBounds: Readonly<
  Record<Pane, { readonly min: number; readonly max: number }>
> = {
  tree: { min: 160, max: 420 },
  sidebar: { min: 260, max: 560 },
  video: { min: 100, max: 480 },
};

const presetVideoHeight: Readonly<Record<LayoutPreset, number>> = {
  stage: 460,
  split: 340,
  focus: 130,
};

export const initialLayout: LayoutState = {
  mode: 'auto',
  videoHeight: 340,
  treeWidth: 220,
  sidebarWidth: 340,
  treeOpen: true,
  sidebarOpen: true,
};

const phasePreset: Readonly<Record<RoundPhase, LayoutPreset>> = {
  'opponent-speaking': 'split',
  'cross-ex': 'stage',
  prep: 'focus',
  'own-speech': 'focus',
};

const nudgeStep = 16;
const nudgeKeys: Readonly<Record<string, number>> = {
  ArrowLeft: -nudgeStep,
  ArrowUp: -nudgeStep,
  ArrowRight: nudgeStep,
  ArrowDown: nudgeStep,
};

export function autoPreset(phase: RoundPhase): LayoutPreset {
  return phasePreset[phase];
}

export function effectivePreset(
  state: LayoutState,
  phase: RoundPhase,
): LayoutPreset | 'custom' {
  return state.mode === 'auto' ? autoPreset(phase) : state.mode;
}

export function videoHeightFor(state: LayoutState, phase: RoundPhase): number {
  const preset = effectivePreset(state, phase);
  return preset === 'custom' ? state.videoHeight : presetVideoHeight[preset];
}

export function clampPane(pane: Pane, px: number): number {
  const { min, max } = paneBounds[pane];
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function resizePane(
  state: LayoutState,
  _phase: RoundPhase,
  pane: Pane,
  startPx: number,
  deltaPx: number,
): LayoutState {
  if (pane === 'tree')
    return { ...state, treeWidth: clampPane(pane, startPx + deltaPx) };
  if (pane === 'sidebar')
    return { ...state, sidebarWidth: clampPane(pane, startPx - deltaPx) };
  return {
    ...state,
    mode: 'custom',
    videoHeight: clampPane(pane, startPx + deltaPx),
  };
}

const currentSize = (state: LayoutState, phase: RoundPhase, pane: Pane) => {
  if (pane === 'tree') return state.treeWidth;
  if (pane === 'sidebar') return state.sidebarWidth;
  return videoHeightFor(state, phase);
};

export function nudgePane(
  state: LayoutState,
  phase: RoundPhase,
  pane: Pane,
  key: string,
): LayoutState {
  const delta = Object.hasOwn(nudgeKeys, key) ? nudgeKeys[key] : undefined;
  if (delta === undefined) return state;
  return resizePane(state, phase, pane, currentSize(state, phase, pane), delta);
}

export function selectMode(
  state: LayoutState,
  mode: Exclude<LayoutMode, 'custom'>,
): LayoutState {
  return { ...state, mode };
}

export function togglePanel(state: LayoutState, panel: Panel): LayoutState {
  return panel === 'tree'
    ? { ...state, treeOpen: !state.treeOpen }
    : { ...state, sidebarOpen: !state.sidebarOpen };
}

export function workspaceMinHeight(videoHeight: number): number {
  return Math.max(380, 856 - videoHeight);
}
