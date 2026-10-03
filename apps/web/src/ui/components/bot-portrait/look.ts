export type HairStyle = 'curly' | 'sweep' | 'sides';

/**
 * Everything that makes one bot look like itself. A portrait is drawn from
 * this alone, so a new character is data, not a new drawing.
 */
export type PortraitLook = {
  readonly skin: string;
  readonly hair: string;
  readonly hairStyle: HairStyle;
  readonly beard: boolean;
  readonly glasses: 'none' | 'round';
  /** 0 wide open to 1 heavy-lidded. */
  readonly lids: number;
  /** How far each brow sits above rest, left then right, in pixels. */
  readonly browLift: readonly [number, number];
  /** Degrees: positive lifts the inner ends (worried), negative lowers them. */
  readonly browTilt: number;
  /** -1 a frown to 1 a broad smile. */
  readonly smile: number;
  readonly outfit: string;
  readonly accent: string;
  readonly backdrop: string;
};
