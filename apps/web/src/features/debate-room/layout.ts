/**
 * Where the round is for this debater. `waiting` is a round whose live
 * position the room cannot read: nobody holds the floor and no phase
 * action is offered.
 */
export type RoundPhase =
  'waiting' | 'opponent-speaking' | 'cross-ex' | 'prep' | 'own-speech';
export type LayoutPreset = 'stage' | 'split' | 'focus';
export type LayoutMode = 'auto' | LayoutPreset | 'custom';

/** Only the video resizes; the document takes the rest (owner decision 2). */
export type LayoutState = {
  readonly mode: LayoutMode;
  readonly videoHeight: number;
};

export const videoBounds = { min: 100, max: 480 } as const;

const presetVideoHeight: Readonly<Record<LayoutPreset, number>> = {
  stage: 460,
  split: 340,
  focus: 130,
};

export const initialLayout: LayoutState = { mode: 'auto', videoHeight: 340 };

const phasePreset: Readonly<Record<RoundPhase, LayoutPreset>> = {
  waiting: 'split',
  'opponent-speaking': 'split',
  'cross-ex': 'stage',
  prep: 'focus',
  'own-speech': 'focus',
};

/** The presets the layout menu offers, after Auto. */
export const layoutPresets: readonly LayoutPreset[] = [
  'stage',
  'split',
  'focus',
];

const nudgeStep = 16;
const nudgeKeys: Readonly<Record<string, number>> = {
  ArrowUp: -nudgeStep,
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

export function clampVideo(px: number): number {
  return Math.min(videoBounds.max, Math.max(videoBounds.min, Math.round(px)));
}

/** A manual resize pins the layout: Auto stops following the phase. */
export function resizeVideo(startPx: number, deltaPx: number): LayoutState {
  return { mode: 'custom', videoHeight: clampVideo(startPx + deltaPx) };
}

export function nudgeVideo(
  state: LayoutState,
  phase: RoundPhase,
  key: string,
): LayoutState {
  const delta = Object.hasOwn(nudgeKeys, key) ? nudgeKeys[key] : undefined;
  if (delta === undefined) return state;
  return resizeVideo(videoHeightFor(state, phase), delta);
}

export function selectMode(
  state: LayoutState,
  mode: Exclude<LayoutMode, 'custom'>,
): LayoutState {
  return { ...state, mode };
}

export function workspaceMinHeight(videoHeight: number): number {
  return Math.max(380, 856 - videoHeight);
}
