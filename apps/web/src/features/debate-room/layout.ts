/**
 * Where the round is for this debater. `waiting` is a round whose live
 * position the room cannot read: nobody holds the floor and no phase
 * action is offered.
 */
export type RoundPhase =
  | 'waiting'
  | 'opponent-speaking'
  | 'cross-ex'
  | 'prep'
  | 'own-speech'
  | 'judging';

/**
 * How the video band arranges the debaters: the speaker large beside a
 * small self view, two equal tiles for cross-ex, small tiles above a large
 * document, or a face-to-face conversation while the ballots are written.
 */
export type LayoutPreset = 'speaker' | 'stage' | 'focus' | 'conversation';
export type LayoutMode = 'auto' | LayoutPreset;

/**
 * Only the video resizes; the document takes the rest (owner decision 2).
 * `videoHeight` is the debater's own height once they resize, else null.
 */
export type LayoutState = {
  readonly mode: LayoutMode;
  readonly videoHeight: number | null;
};

export const videoBounds = { min: 100, max: 480 } as const;

const presetVideoHeight: Readonly<Record<LayoutPreset, number>> = {
  speaker: 420,
  stage: 420,
  focus: 130,
  conversation: 300,
};

export const initialLayout: LayoutState = { mode: 'auto', videoHeight: null };

const phasePreset: Readonly<Record<RoundPhase, LayoutPreset>> = {
  waiting: 'conversation',
  'opponent-speaking': 'speaker',
  'cross-ex': 'stage',
  prep: 'focus',
  'own-speech': 'focus',
  judging: 'conversation',
};

/** The presets the layout menu offers, after Auto. */
export const layoutPresets: readonly LayoutPreset[] = [
  'speaker',
  'stage',
  'focus',
  'conversation',
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
): LayoutPreset {
  return state.mode === 'auto' ? autoPreset(phase) : state.mode;
}

export function videoHeightFor(state: LayoutState, phase: RoundPhase): number {
  return state.videoHeight ?? presetVideoHeight[effectivePreset(state, phase)];
}

export function clampVideo(px: number): number {
  return Math.min(videoBounds.max, Math.max(videoBounds.min, Math.round(px)));
}

/** A manual resize pins the preset on screen: Auto stops following the phase. */
export function resizeVideo(
  state: LayoutState,
  phase: RoundPhase,
  startPx: number,
  deltaPx: number,
): LayoutState {
  return {
    mode: effectivePreset(state, phase),
    videoHeight: clampVideo(startPx + deltaPx),
  };
}

export function nudgeVideo(
  state: LayoutState,
  phase: RoundPhase,
  key: string,
): LayoutState {
  const delta = Object.hasOwn(nudgeKeys, key) ? nudgeKeys[key] : undefined;
  if (delta === undefined) return state;
  return resizeVideo(state, phase, videoHeightFor(state, phase), delta);
}

/** Choosing Auto or a preset from the menu drops a resized height. */
export function selectMode(mode: LayoutMode): LayoutState {
  return { mode, videoHeight: null };
}

export function workspaceMinHeight(videoHeight: number): number {
  return Math.max(380, 856 - videoHeight);
}
