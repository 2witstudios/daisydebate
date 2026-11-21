import { sha3Hex } from '@daisy/digest';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { agreementWords, contentWaiverDocument } from '../legal/agreements';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  runMemberRoute,
} from '../../server/member-boundary';

const target = { linkId: idSchema, lobbyId: idSchema };
const lobbyPermissionCommand = z.discriminatedUnion('type', [
  z.strictObject({ ...target, type: z.literal('request') }),
  z.strictObject({
    ...target,
    type: z.literal('sign'),
    version: z.string().min(1).max(64),
    accepted: z.literal('yes'),
  }),
]);

export const lobbyPermissionRoute =
  (app: App, released: (userId: string) => Promise<boolean>) =>
  (request: Request) =>
    runMemberRoute(
      { ...memberHttpBoundary(app), limiter: () => app.limiter },
      request,
      {
        name: 'parental-controls.command',
        readOnly: false,
        evaluatorDecides: true,
        bucket: 'parental-controls',
        rule: { max: 8, windowSeconds: 60 },
      },
      async (caller) => {
        if (!(await released(caller.userId))) throw createAppError('NOT_FOUND');
        const command = parseValidated(
          lobbyPermissionCommand,
          await readJson(request),
        );
        if (command.type === 'request') {
          const accepted = await app.database.lobbyPermissions.apply(
            caller,
            command,
          );
          return Response.json({ accepted });
        }
        const waiver = contentWaiverDocument;
        if (command.version !== waiver.version)
          return Response.json({ accepted: false, changed: true });
        const digest = sha3Hex(agreementWords(waiver));
        const accepted = await app.database.lobbyPermissions.apply(caller, {
          ...command,
          digest,
        });
        return Response.json({ accepted });
      },
    );
