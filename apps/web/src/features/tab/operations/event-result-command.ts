import type { TabStore } from '@daisy/db/tab';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import { resultCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import { resultCommand } from './result-command';
import { completionCommand } from './completion-command';
import type { TabPrincipal } from '../tab-principal';

/** Fixture results and event completion share the evaluated endpoint, retaining their own transaction owners. */
export const eventResultCommand = (dependencies: {
  readonly store: Pick<TabStore, 'resultCommand' | 'completionCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
}) => {
  const fixture = resultCommand(dependencies),
    completion = completionCommand(dependencies);
  return (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = resultCommandEnvelopeSchema.safeParse(body);
    return parsed.success && 'fixtureId' in parsed.data.command
      ? fixture(principal, lobbyId, body)
      : completion(principal, lobbyId, body);
  };
};
