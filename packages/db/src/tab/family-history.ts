import { and, asc, eq, inArray } from 'drizzle-orm';
import { readAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import { guardianLinks } from '../schema/guardian-links';
import { actionHistory } from '../schema/grants';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import type { TabDatabase } from './tab-transaction';
import { inTransaction, type Tx } from '../tx';
type Input = {
  readonly viewerUserId: string;
  readonly guardianLinkId: string;
  readonly subjectUserId: string;
};
const load = async (tx: Tx, input: Input) => {
  await scopeTransaction(tx, { subjectUserId: input.subjectUserId });
  const [initial] = await tx
    .select()
    .from(guardianLinks)
    .where(eq(guardianLinks.id, input.guardianLinkId));
  if (!initial || initial.minorUserId !== input.subjectUserId) return null;
  const people = await tx
    .select({ userId: actors.userId, actorId: actors.id })
    .from(actors)
    .where(
      inArray(actors.userId, [
        input.viewerUserId,
        initial.guardianUserId,
        initial.minorUserId,
      ]),
    );
  if (people.length)
    await readAuthorizationActors(
      tx,
      people.map((person) => person.actorId),
      { maxActors: people.length },
    );
  const authorityScope = {
    subjectUserId: input.viewerUserId,
    ...(initial.viaOrganizationId
      ? { organizationId: initial.viaOrganizationId }
      : {}),
  };
  await scopeTransaction(tx, authorityScope);
  const authorization = await loadAuthorityContext(
    tx,
    authorityScope,
    input.viewerUserId,
    'share',
  );
  await scopeTransaction(tx, { subjectUserId: input.subjectUserId });
  // Every family writer fences this ward first, so shared account fences hold the relationship current.
  const [link] = await tx
    .select()
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.id, input.guardianLinkId),
        eq(guardianLinks.minorUserId, input.subjectUserId),
      ),
    );
  if (
    !link ||
    link.status !== 'active' ||
    link.guardianUserId !== initial.guardianUserId ||
    link.viaOrganizationId !== initial.viaOrganizationId
  )
    return null;
  const guardianActorId = people.find(
    (person) => person.userId === link.guardianUserId,
  )?.actorId;
  const wardActorId = people.find(
    (person) => person.userId === link.minorUserId,
  )?.actorId;
  if (!guardianActorId || !wardActorId) return null;
  return {
    subjectUserId: link.minorUserId,
    guardianActorId,
    wardActorId,
    authorization,
    entries: await tx
      .select({
        commandId: actionHistory.commandId,
        type: actionHistory.type,
        actorUserId: actionHistory.actorUserId,
        appliedAt: actionHistory.appliedAt,
      })
      .from(actionHistory)
      .where(eq(actionHistory.subjectPersonUserId, input.subjectUserId))
      .orderBy(asc(actionHistory.appliedAt), asc(actionHistory.commandId)),
  };
};
export type FamilyHistoryFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createFamilyHistoryStore = (database: TabDatabase) => ({
  familyHistory: <Answer>(
    input: Input,
    work: (facts: FamilyHistoryFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
