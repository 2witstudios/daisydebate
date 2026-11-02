import type { SeatGrantFacts } from '../src/capture-history';

/**
 * The db never imports the engine, so its suites inject this stand-in for
 * @daisy/debate-engine's botGrantUnused. The real rule has its own unit tests
 * and runs through the real seal and freeze in apps/web's silent-bot-round.
 */
export const botGrantUnused = ({
  seat,
  turn,
  hasCreditedWindow,
}: SeatGrantFacts) =>
  seat.kind === 'bot' &&
  !hasCreditedWindow &&
  turn !== undefined &&
  ((turn.side !== undefined && turn.side !== seat.role) ||
    (turn.slot !== undefined && turn.slot !== seat.slot));
