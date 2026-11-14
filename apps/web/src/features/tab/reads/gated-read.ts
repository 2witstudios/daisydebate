import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { LobbyReadDefinition } from '@daisy/protocol/lobby/read';

/** The facts one read loaded, with everything `authorize` needs but the capability. */
export type LoadedRead<Facts> = {
  readonly facts: Facts;
  readonly authority: Omit<AuthorizationInput, 'capability'>;
};

/**
 * Answers one lobby read: its gate decides, and a denial answers exactly as a
 * missing resource does (null). The projection receives the decision so a
 * conflicted official can be shown less, and an `ask` to compute each
 * boolean in the read's `capabilities` block from the same evaluator.
 */
export const gatedRead = async <Facts, Read>(
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  definition: LobbyReadDefinition,
  load: () => Promise<LoadedRead<Facts> | null>,
  project: (
    facts: Facts,
    ask: (capability: AuthorizationInput['capability']) => boolean,
  ) => Read,
): Promise<Read | null> => {
  const loaded = await load();
  if (loaded === null) return null;
  const ask = (capability: AuthorizationInput['capability']) =>
    authorize({ ...loaded.authority, capability }).allow;
  if (definition.gate === 'signed-in') {
    if (loaded.authority.principal.kind !== 'user') return null;
  } else if (!definition.gate.some(ask)) return null;
  return project(loaded.facts, ask);
};
