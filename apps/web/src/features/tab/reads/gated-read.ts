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
 * missing resource does (null). The projection receives the gate decision (with any
 * conflict) so a conflicted official can be shown less, and an `ask` to compute each
 * boolean in the read's `capabilities` block from the same evaluator.
 */
export const gatedRead = async <Facts, Read>(
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  definition: LobbyReadDefinition,
  load: () => Promise<LoadedRead<Facts> | null>,
  project: (
    facts: Facts,
    ask: (capability: AuthorizationInput['capability']) => boolean,
    decision: GateDecision,
  ) => Read,
): Promise<Read | null> => {
  const loaded = await load();
  if (loaded === null) return null;
  const ask = (capability: AuthorizationInput['capability']) =>
    authorize({ ...loaded.authority, capability }).allow;
  const decision = gateDecision(authorize, definition, loaded.authority);
  if (decision === null) return null;
  return project(loaded.facts, ask, decision);
};

/**
 * What the gate allowed under: a signed-in read has no capability to decide,
 * and a capability gate answers with the first decision that allowed it,
 * whose conflict tells the projection to show a conflicted official less.
 */
export type GateDecision =
  | { readonly kind: 'signed-in' }
  | {
      readonly kind: 'allowed';
      readonly decision: Extract<AuthorizationDecision, { allow: true }>;
    };

const gateDecision = (
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  definition: LobbyReadDefinition,
  authority: Omit<AuthorizationInput, 'capability'>,
): GateDecision | null => {
  if (definition.gate === 'signed-in')
    return authority.principal.kind === 'user' ? { kind: 'signed-in' } : null;
  for (const capability of definition.gate) {
    const decision = authorize({ ...authority, capability });
    if (decision.allow) return { kind: 'allowed', decision };
  }
  return null;
};
