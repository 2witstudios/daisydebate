import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { readJson } from '../../server/http';
import { runMemberHandler } from '../../server/member-handler';

type Operation = (
  input: unknown,
  principal: AuthorizationPrincipal,
) => Promise<unknown>;
/** Native forms and JSON use the same social operation and actor-bound boundary. */
export function createMessagingSocialHandlers(dependencies: {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from these routes' raw errors goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly maxBodyBytes: number;
  readonly bounds: MessagingSocialBounds;
  readonly request: Operation;
  readonly decide: Operation;
  readonly preview: Operation;
  readonly status: Operation;
}) {
  const schemas = createMessagingSocialSchemas(dependencies.bounds);
  const outputs = {
    request: schemas.dmResult,
    decide: schemas.closedDmResult,
    preview: schemas.previewDmResult,
    status: schemas.dmResult,
  };
  const run = (
    request: Request,
    kind: 'request' | 'decide' | 'preview' | 'status',
    readInput: () => Promise<unknown>,
  ) =>
    runMemberHandler(dependencies, request, {
      name: `messaging.${kind}`,
      readOnly: kind === 'preview' || kind === 'status',
      readInput,
      headers: {
        'x-messaging-introduction-units': String(
          dependencies.bounds.introductionUnits,
        ),
        'x-messaging-title-units': String(dependencies.bounds.titleUnits),
        'x-messaging-batch-actors': String(dependencies.bounds.batchActors),
      },
      operation: async (input, principal) =>
        outputs[kind].parse({
          ...((await dependencies[kind](input, principal)) as Record<
            string,
            unknown
          >),
          version: 1,
        }),
    });
  return {
    request: (request: Request) =>
      run(request, 'request', () =>
        readJson(request, dependencies.maxBodyBytes),
      ),
    decide: (request: Request) =>
      run(request, 'decide', () =>
        readJson(request, dependencies.maxBodyBytes),
      ),
    status: (request: Request, channelId: string) =>
      run(request, 'status', async () => ({ version: 1, channelId })),
    preview: (request: Request, channelId: string) =>
      run(request, 'preview', async () => ({ version: 1, channelId })),
  };
}
