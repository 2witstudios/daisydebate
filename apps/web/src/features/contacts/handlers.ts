import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { contactBlockResultSchema } from '@daisy/protocol';
import { readJson } from '../../server/http';
import {
  runMemberHandler,
  type MemberBoundary,
} from '../../server/member-handler';

const MAX_BODY_BYTES = 1024;

type BlockOperation = (
  input: unknown,
  principal: AuthorizationPrincipal,
) => Promise<{ readonly blocked: boolean; readonly revision: number }>;

/** Contacts' routes: block or unblock by actor ID or by username. */
export function createContactHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  readonly block: BlockOperation;
  readonly blockByUsername: BlockOperation;
}) {
  const run = (name: string, operation: BlockOperation) => (request: Request) =>
    runMemberHandler(dependencies.boundary, request, {
      name,
      readOnly: false,
      readInput: () => readJson(request, MAX_BODY_BYTES),
      operation: async (input, principal) =>
        contactBlockResultSchema.parse({
          version: 1,
          ...(await operation(input, principal)),
        }),
    });
  return {
    block: run('contacts.block', dependencies.block),
    blockByUsername: run(
      'contacts.block.username',
      dependencies.blockByUsername,
    ),
  };
}
