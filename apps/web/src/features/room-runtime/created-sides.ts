/**
 * A new Room's side rule (ADR 0145): a ranked Room always flips; teams of
 * different sizes keep their declared sides; otherwise the request decides,
 * and with none, a cast naming a debater keeps its producer's sides (Tab,
 * Delivery 4909) while every other Room flips.
 */
export const createdSides = (input: {
  readonly competitionType: 'casual' | 'ranked';
  readonly sides: 'open' | 'fixed' | undefined;
  readonly castNamesDebater: boolean;
  readonly seats: { readonly affirmative: number; readonly negative: number };
}): 'affirmative' | null => {
  if (input.competitionType === 'ranked') return null;
  if (input.seats.affirmative !== input.seats.negative) return 'affirmative';
  const sides = input.sides ?? (input.castNamesDebater ? 'fixed' : 'open');
  return sides === 'fixed' ? 'affirmative' : null;
};
