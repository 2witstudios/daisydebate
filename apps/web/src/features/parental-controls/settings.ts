import type { GuardianSession } from '@daisy/db';
import type { GuardianRequestRef } from '@daisy/protocol/guardians';

export type FamilyRow = {
  readonly id: string;
  readonly label: string;
  readonly status: 'waiting' | 'active' | 'not-confirmed';
  readonly request: GuardianRequestRef | null;
};

export async function readFamilySettings(
  session: GuardianSession,
  userId: string,
  role: 'adult' | 'child',
  now: Date,
): Promise<readonly FamilyRow[]> {
  const links = await session.links();
  const requests = role === 'adult' ? await session.requests() : [];
  const expiredForChild =
    role === 'child'
      ? new Set(
          (await session.linkRequestDeadlines())
            .filter(({ expiresAt }) => expiresAt <= now)
            .map(({ linkId }) => linkId),
        )
      : new Set<string>();
  const byId = new Map(links.map(({ link }) => [link.id, link.status]));
  const privateLinks = new Set(
    requests.flatMap(({ requestedLinkId }) => requestedLinkId ?? []),
  );
  return [
    ...links.flatMap(({ link, username }): FamilyRow[] => {
      if (role === 'adult') {
        if (
          link.guardianUserId !== userId ||
          (privateLinks.has(link.id) && link.status !== 'active')
        )
          return [];
      } else if (link.minorUserId !== userId || username === null) return [];
      if (link.status === 'ended' || link.status === 'cancelled') return [];
      if (
        role === 'child' &&
        (link.status === 'refused' ||
          (link.status === 'requested' && expiredForChild.has(link.id)))
      )
        return [];
      return [
        {
          id: link.id,
          label: username ? `@${username}` : 'Your child',
          status:
            link.status === 'requested'
              ? 'waiting'
              : link.status === 'active'
                ? 'active'
                : 'not-confirmed',
          request:
            link.status === 'requested' ? { kind: 'link', id: link.id } : null,
        },
      ];
    }),
    ...requests.flatMap((request): FamilyRow[] => {
      if (
        !request.firstName ||
        request.expiresAt <= now ||
        (request.status !== 'open' && request.status !== 'linked')
      )
        return [];
      const status = request.requestedLinkId
        ? byId.get(request.requestedLinkId)
        : undefined;
      if (status === 'active' || status === 'ended' || status === 'cancelled')
        return [];
      return [
        {
          id: request.id,
          label: request.firstName,
          status: status === 'refused' ? 'not-confirmed' : 'waiting',
          request:
            status === 'refused'
              ? null
              : { kind: 'invitation', id: request.id },
        },
      ];
    }),
  ];
}
