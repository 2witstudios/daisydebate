import { authorize } from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

type Store = Pick<
  Database,
  | 'readHostedRoundAudienceLink'
  | 'readRoomAuthorizationFacts'
  | 'setRoundAudienceLink'
>;
type Caller = { readonly userId: string; readonly actorId: string };

/**
 * The link's standing for the host who manages this unlisted Round's Room, or
 * null for anyone and anything else, so a stranger learns nothing of it.
 */
export const readHostedAudienceLink = async (
  store: Pick<
    Store,
    'readHostedRoundAudienceLink' | 'readRoomAuthorizationFacts'
  >,
  input: { readonly roundId: string; readonly caller: Caller },
): Promise<{ readonly issued: boolean } | null> => {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const round = await store.readHostedRoundAudienceLink(input.roundId);
  if (round?.visibility !== 'unlisted' || round.roomId === null) return null;
  const facts = await store.readRoomAuthorizationFacts(
    round.roomId,
    input.caller,
  );
  if (!facts) return null;
  const { allow } = authorize({
    principal: { kind: 'user', ...input.caller },
    capability: 'room.manage',
    context: { account: facts.account },
    resource: facts.resource,
  });
  return allow ? { issued: round.audienceLinkHash !== null } : null;
};

/**
 * Issues this Round's link, or replaces the current one: the row holds one hash,
 * so the old link stops admitting in the same statement. The token leaves here
 * once and is never read back.
 */
export const issueAudienceLink = async (
  deps: {
    readonly store: Store;
    readonly newToken: () => string;
    readonly hashOf: (token: string) => string;
  },
  input: { readonly roundId: string; readonly caller: Caller },
): Promise<string> => {
  const refused = createAppError('NOT_FOUND');
  if ((await readHostedAudienceLink(deps.store, input)) === null) throw refused;
  const token = deps.newToken();
  const replaced = await deps.store.setRoundAudienceLink({
    roundId: input.roundId,
    hash: deps.hashOf(token),
  });
  if (!replaced) throw refused;
  return token;
};
