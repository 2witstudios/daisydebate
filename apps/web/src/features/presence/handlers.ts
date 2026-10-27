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

/** The member's own presence setting route (ADR 0072). */
export function createPresenceHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  readonly set: (
    principal: AuthorizationPrincipal,
    hidden: boolean,
  ) => Promise<{ readonly hidden: boolean }>;
}) {
  return {
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
