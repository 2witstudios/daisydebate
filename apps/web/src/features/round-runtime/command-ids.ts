import type { RoundCommandEnvelope } from '@daisy/protocol/round-command';
export type RoundCommandIds = Readonly<
  Record<RoundCommandEnvelope['command']['type'], string>
>;
/** Server seeds hydration; each new canonical revision gets fresh intent identifiers. */
export const roundCommandIds = (nextId: () => string): RoundCommandIds => ({
  strike_resolution: nextId(),
  start_prep: nextId(),
  cancel_prep: nextId(),
  start_speech: nextId(),
  yield: nextId(),
  offer_poi: nextId(),
  withdraw_poi: nextId(),
  accept_poi: nextId(),
  decline_poi: nextId(),
  end_poi: nextId(),
  forfeit: nextId(),
  leave: nextId(),
});
