/** A debater's side of the Round. */
export type Side = 'aff' | 'neg';

export type SpeechSlot = {
  readonly id: string;
  readonly code: string;
  /** The full name, "Negative constructive"; the code is its short form. */
  readonly name: string;
  readonly side: Side;
  readonly kind: 'speech' | 'cross-ex';
  readonly durationMs: number;
};
