import { idSchema } from '@daisy/protocol/primitives';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { memberHttpBoundary, runMemberRoute } from '../auth/member-boundary';
import { closeChildAccount } from '../account/data-rights/composition';
import { routeReleaseFor } from '../flags/route-release';
import { deriveRecipientSubkey, recipientKey } from '../mail/recipient-key';

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('sign'),
      linkId: idSchema,
      wordingVersion: z.string().max(40),
      name: z.string().max(120),
      relation: z.string().max(30),
      attests: z.boolean(),
      paidAds: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('close'),
      linkId: idSchema,
      confirmed: z.literal(true),
    })
    .strict(),
]);

export const guardianMoreRoute = (app: App) => (request: Request) =>
  runMemberRoute(
    { ...memberHttpBoundary(app), limiter: () => app.limiter },
    request,
    {
      name: 'parental-controls.more',
      readOnly: false,
      bucket: 'parental-controls',
      rule: { max: 8, windowSeconds: 60 },
    },
    async (guardian) => {
      if (!(await routeReleaseFor(app)('parental-controls', guardian.userId)))
        throw createAppError('NOT_FOUND');
      const { type, linkId, ...form } = parseValidated(
        commandSchema,
        await readJson(request),
      );
      if (type === 'close') {
        if (!(await closeChildAccount(app, guardian, linkId)))
          throw createAppError('NOT_FOUND');
        return Response.json({ kind: 'done' });
      }
      const key = deriveRecipientSubkey(app.mailConfig().RECIPIENT_HASH_SECRET);
      const result = await app.database.mediaReleases.signAsGuardian(
        { guardian, linkId },
        form,
        (email) => recipientKey(key, email),
      );
      if (
        result.kind === 'refused' &&
        result.reason === 'guardian-link-unavailable'
      )
        throw createAppError('NOT_FOUND');
      return Response.json(result.kind === 'done' ? { kind: 'done' } : result);
    },
  );
