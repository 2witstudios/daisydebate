import type { TabStore } from '@daisy/db/tab';
/** Member pages name a standing lobby; host pages name its owning organization. Never guess across namespaces. */
export async function leaguePageAddress(
  store: Pick<
    TabStore,
    'organizationIdOfHandle' | 'standingLobbyAddressOfHandle'
  >,
  input: {
    readonly kind: 'standing' | 'organization';
    readonly handle: string;
  },
): Promise<{
  readonly organizationId: string;
  readonly lobbyId?: string;
} | null> {
  if (input.kind === 'standing')
    return store.standingLobbyAddressOfHandle(input.handle);
  const organizationId = await store.organizationIdOfHandle(input.handle);
  return organizationId ? { organizationId } : null;
}
