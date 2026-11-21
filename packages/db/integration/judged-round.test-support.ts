import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import type { Fixture } from './constraint-helpers';

/** An actual published judged revision, compiled unchanged; the unjudged foundation cannot carry a judge. */
export function judgedRound(
  fixture: Fixture,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const compiled = resolveRoomConfiguration(
    oneOnOneDefinition,
    oneOnOneSettings,
  );
  if (!compiled.ok)
    throw new Error('The original judged revision did not compile');
  return fixture.round(
    { format_id: 'one-on-one', format_version: 2, ...overrides },
    { rules: compiled.rules },
  );
}

/** A separately authored fixture grammar with exactly its tested panel size. */
export async function authoredJudgedRound(fixture: Fixture, judges: number) {
  const definition = {
    ...oneOnOneDefinition,
    seats: { ...oneOnOneDefinition.seats, judges },
  };
  const compiled = resolveRoomConfiguration(definition, oneOnOneSettings);
  if (!compiled.ok) throw new Error('Authored panel fixture did not compile');
  const formatId = await fixture.format(definition);
  return fixture.round(
    { format_id: formatId, format_version: 1 },
    { rules: compiled.rules },
  );
}
