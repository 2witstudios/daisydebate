import {
  affirmativeSide,
  sidesSwappable,
  type FormatSeating,
} from '@daisy/protocol';

/**
 * A new Room's side rule (ADR 0145): a ranked Room always flips. A Tab event
 * Room takes its sides from the draw, so its seats are fixed as published;
 * so are teams of different sizes and any Room with no two teams (TAB-6.2).
 * Otherwise the request decides, and with none, a cast naming a debater
 * keeps its producer's sides (Tab, Delivery 4909) while every other Room
 * flips.
 */
export const createdSides = (input: {
  readonly competitionType: 'casual' | 'ranked';
  readonly sides: 'open' | 'fixed' | undefined;
  readonly castNamesDebater: boolean;
  readonly seating: FormatSeating;
  readonly eventRoom?: boolean;
}): typeof affirmativeSide | null => {
  // A Tab event Room's draw already gave each team its side: always fixed.
  if (input.eventRoom) return affirmativeSide;
  if (input.competitionType === 'ranked') return null;
  if (!sidesSwappable(input.seating)) return affirmativeSide;
  const sides = input.sides ?? (input.castNamesDebater ? 'fixed' : 'open');
  return sides === 'fixed' ? affirmativeSide : null;
};
