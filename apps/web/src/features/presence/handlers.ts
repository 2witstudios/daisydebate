import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  presenceSettingResultSchema,
  presenceSettingSchema,
} from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  runMemberHandler,
  type MemberBoundary,
} from '../../server/member-handler';

const MAX_BODY_BYTES = 1024;

type Answer = Promise<{ readonly hidden: boolean }>;

/** The member's own presence setting routes: read it and set it (ADR 0072). */
export function createPresenceHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  readonly set: (principal: AuthorizationPrincipal, hidden: boolean) => Answer;
  readonly read: (principal: AuthorizationPrincipal) => Answer;
}) {
  return {
    read: (request: Request) =>
      runMemberHandler(dependencies.boundary, request, {
        name: 'presence.read',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) =>
          presenceSettingResultSchema.parse({
            version: 1,
            ...(await dependencies.read(principal)),
          }),
      }),
    set: (request: Request) =>
      runMemberHandler(dependencies.boundary, request, {
        name: 'presence.set',
        readOnly: false,
        readInput: () => readJson(request, MAX_BODY_BYTES),
        operation: async (input, principal) =>
          presenceSettingResultSchema.parse({
            version: 1,
            ...(await dependencies.set(
              principal,
              parseValidated(presenceSettingSchema, input).hidden,
            )),
          }),
      }),
  };
}
