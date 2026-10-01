/**
 * The rules a practice runs under. Custom rules are practice only (ADR 0030):
 * ranked always runs the canonical rules, against people, so a custom or solo
 * table is refused there.
 */
export type Seats = 'both' | 'solo';

export type PracticeRules = {
  readonly speechMinutes: number;
  readonly prepMinutes: number;
  readonly seats: Seats;
};

/** Sample standard values until the canonical format rules are read. */
export const standardRules: PracticeRules = {
  speechMinutes: 5,
  prepMinutes: 4,
  seats: 'both',
};

export const speechRange = { min: 1, max: 12 } as const;
export const prepRange = { min: 0, max: 10 } as const;

export const isStandard = (rules: PracticeRules): boolean =>
  rules.speechMinutes === standardRules.speechMinutes &&
  rules.prepMinutes === standardRules.prepMinutes &&
  rules.seats === standardRules.seats;

/** How the rules differ from the standard ones, in words. */
export function describeDifferences(rules: PracticeRules): readonly string[] {
  const lines: string[] = [];
  if (rules.speechMinutes !== standardRules.speechMinutes)
    lines.push(
      `Speech length is ${rules.speechMinutes} min. The standard rules use ${standardRules.speechMinutes}.`,
    );
  if (rules.prepMinutes !== standardRules.prepMinutes)
    lines.push(
      `Prep time is ${rules.prepMinutes} min. The standard rules use ${standardRules.prepMinutes}.`,
    );
  if (rules.seats === 'solo')
    lines.push('Only one seat is filled, so nobody answers.');
  return lines;
}

/** Why ranked refuses these rules; always at least one reason. */
export function rankedRefusal(rules: PracticeRules): readonly string[] {
  const reasons: string[] = [];
  if (
    rules.speechMinutes !== standardRules.speechMinutes ||
    rules.prepMinutes !== standardRules.prepMinutes
  )
    reasons.push(
      'Ranked runs only the standard rules. These rules are custom.',
    );
  if (rules.seats === 'solo')
    reasons.push(
      'Ranked needs a person in every seat. A solo or sandbox seat is for practice only.',
    );
  return reasons.length > 0
    ? reasons
    : [
        'Ranked is played against people, from a table in the Lobby. A practice never counts toward a rating.',
      ];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const clampSpeech = (minutes: number): number =>
  clamp(Math.round(minutes), speechRange.min, speechRange.max);

export const clampPrep = (minutes: number): number =>
  clamp(Math.round(minutes), prepRange.min, prepRange.max);
