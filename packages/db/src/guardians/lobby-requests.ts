import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { lockAuthorizationActors } from '../authorization';
import { run } from '../raw-rows';
import { actors } from '../schema/actors';
import {
  guardianLinks,
  restrictionLobbies,
  restrictionLobbyWaivers,
} from '../schema/guardian-links';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { lockActiveLobbySeason } from '../ladder-season';
import { scopeTransaction } from '../tenant-scope';
import { inTransaction, type Tx, type TxOpener } from '../tx';
import { isMinorAgeBand } from './lobby-permissions';

type Caller = { readonly userId: string; readonly actorId: string };
type LobbyCommand = {
  readonly linkId: string;
  readonly lobbyId: string;
} & (
  | { readonly type: 'request' }
  | { readonly type: 'sign'; readonly version: string; readonly digest: string }
);

const adultStandingLobby = and(
  eq(lobbies.kind, 'standing'),
  eq(lobbies.ageRule, 'adults'),
  isNull(lobbies.closedAt),
  isNull(organizations.closedAt),
);

async function lobbyPermissionParticipant(
  tx: Tx,
  caller: Caller,
  command: LobbyCommand,
) {
  const party =
    command.type === 'request'
      ? guardianLinks.minorUserId
      : guardianLinks.guardianUserId;
  const expectedLink = and(
    eq(guardianLinks.id, command.linkId),
    eq(party, caller.userId),
  );
  const parentActor = alias(actors, 'parent_actor');
  const [pair] = await tx
    .select({ child: actors.id, parent: parentActor.id })
    .from(guardianLinks)
    .innerJoin(actors, eq(actors.userId, guardianLinks.minorUserId))
    .innerJoin(
      parentActor,
      eq(parentActor.userId, guardianLinks.guardianUserId),
    )
    .where(expectedLink);
  if (!pair) return null;
  const accounts = await lockAuthorizationActors(
    tx,
    [pair.child, pair.parent],
    { maxActors: 2 },
  );
  const child = accounts.find((account) => account?.actorId === pair.child);
  const parent = accounts.find((account) => account?.actorId === pair.parent);
  if (
    !child?.member ||
    child.erased ||
    child.restricted ||
    !isMinorAgeBand(child.ageBand) ||
    !parent?.member ||
    parent.erased ||
    parent.restricted ||
    parent.ageBand !== 'adult' ||
    caller.actorId !==
      (command.type === 'request' ? child.actorId : parent.actorId)
  )
    return null;
  // Link closure takes the same account fence. Re-read once its lock is held.
  const [active] = await tx
    .select()
    .from(guardianLinks)
    .where(and(expectedLink, eq(guardianLinks.status, 'active')))
    .for('share');
  return active ?? null;
}

const findAdultLobby = (tx: Tx, lobbyId: string) =>
  tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .where(and(eq(lobbies.id, lobbyId), adultStandingLobby));

export function createLobbyPermissionStore(database: TxOpener) {
  return {
    async read(userId: string, waiverVersion: string) {
      return inTransaction(database, async (tx) => {
        await scopeTransaction(tx, { subjectUserId: userId });
        const requests = await tx
          .select({
            lobbyId: restrictionLobbies.lobbyId,
            linkId: restrictionLobbies.guardianLinkId,
            signedAt: restrictionLobbies.signedAt,
            hasActiveSeason: sql<boolean>`exists (select 1 from seasons season
              where season.lobby_id = ${restrictionLobbies.lobbyId} and season.status = 'active')`,
            rankedWaiverSigned: sql<boolean>`exists (select 1 from restriction_lobby_waivers waiver
              join seasons season on season.id = waiver.season_id and season.status = 'active'
              where waiver.guardian_link_id = ${restrictionLobbies.guardianLinkId}
                and waiver.lobby_id = ${restrictionLobbies.lobbyId} and waiver.waiver_version = ${waiverVersion})`,
          })
          .from(restrictionLobbies)
          .innerJoin(
            guardianLinks,
            eq(guardianLinks.id, restrictionLobbies.guardianLinkId),
          )
          .where(
            and(
              eq(guardianLinks.status, 'active'),
              sql`(${guardianLinks.guardianUserId} = ${userId} or ${guardianLinks.minorUserId} = ${userId})`,
            ),
          )
          .orderBy(
            asc(restrictionLobbies.createdAt),
            asc(restrictionLobbies.lobbyId),
          );
        const choices = await tx
          .select({
            id: lobbies.id,
            name: lobbies.name,
            league: organizations.name,
          })
          .from(lobbies)
          .innerJoin(
            organizations,
            eq(organizations.id, lobbies.ownerOrganizationId),
          )
          .where(adultStandingLobby)
          .orderBy(asc(organizations.name), asc(lobbies.name), asc(lobbies.id));
        return { requests, choices };
      });
    },
    async apply(caller: Caller, command: LobbyCommand) {
      return inTransaction(database, async (tx) => {
        await scopeTransaction(tx, { subjectUserId: caller.userId });
        const link = await lobbyPermissionParticipant(tx, caller, command);
        if (!link) return false;
        const [permittedLobby] = await findAdultLobby(tx, command.lobbyId);
        if (!permittedLobby) return false;
        await scopeTransaction(tx, {
          subjectUserId: caller.userId,
          lobbyId: permittedLobby.id,
        });
        const [lobby] = await findAdultLobby(tx, permittedLobby.id).for(
          'share',
          { of: lobbies },
        );
        if (!lobby) return false;
        if (command.type === 'request') {
          // The requester has INSERT on the identifying columns only.
          await run(
            tx,
            sql`insert into restriction_lobbies
              (guardian_link_id, guardian_user_id, minor_user_id, lobby_id)
              values (${link.id}, ${link.guardianUserId}, ${link.minorUserId}, ${lobby.id})
              on conflict do nothing`,
          );
          return true;
        }
        const request = and(
          eq(restrictionLobbies.guardianLinkId, link.id),
          eq(restrictionLobbies.lobbyId, lobby.id),
        );
        const [existing] = await tx
          .select({
            signedAt: restrictionLobbies.signedAt,
            version: restrictionLobbies.waiverVersion,
            digest: restrictionLobbies.waiverDigest,
          })
          .from(restrictionLobbies)
          .where(request);
        if (!existing) return false;
        const seasonId = await lockActiveLobbySeason(tx, lobby.id);
        if (!existing.signedAt)
          await tx
            .update(restrictionLobbies)
            .set({
              signedAt: sql`greatest(clock_timestamp(), ${restrictionLobbies.createdAt})`,
              waiverVersion: command.version,
              waiverDigest: command.digest,
            })
            .where(and(request, isNull(restrictionLobbies.signedAt)));
        if (!seasonId)
          return (
            !existing.signedAt ||
            (existing.version === command.version &&
              existing.digest === command.digest)
          );
        // Keep signed_at server-owned. INSERT privileges cover only the
        // named evidence columns and the database supplies the timestamp.
        await run(
          tx,
          sql`insert into restriction_lobby_waivers
          (guardian_link_id, guardian_user_id, minor_user_id, lobby_id, season_id, waiver_version, waiver_digest)
          values (${link.id}, ${link.guardianUserId}, ${link.minorUserId}, ${lobby.id}, ${seasonId}, ${command.version}, ${command.digest})
          on conflict do nothing`,
        );
        const [recorded] = await tx
          .select({ digest: restrictionLobbyWaivers.waiverDigest })
          .from(restrictionLobbyWaivers)
          .where(
            and(
              eq(restrictionLobbyWaivers.guardianLinkId, link.id),
              eq(restrictionLobbyWaivers.lobbyId, lobby.id),
              eq(restrictionLobbyWaivers.seasonId, seasonId),
              eq(restrictionLobbyWaivers.waiverVersion, command.version),
            ),
          );
        return recorded?.digest === command.digest;
      });
    },
  };
}
