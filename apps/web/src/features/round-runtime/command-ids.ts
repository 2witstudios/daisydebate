import type { RoundCommandEnvelope } from '@daisy/protocol';
export type RoundCommandIds = Readonly<
  Record<RoundCommandEnvelope['command']['type'], string>
>;
/** Server seeds hydration; each new canonical revision gets fresh intent identifiers. */
export const roundCommandIds = (nextId: () => string): RoundCommandIds => ({
  start: nextId(),
  start_prep: nextId(),
  start_speech: nextId(),
  yield: nextId(),
  interrupt: nextId(),
  forfeit: nextId(),
});
