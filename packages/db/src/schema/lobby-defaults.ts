import { publicLobbyId } from '../daisy-reference';

/** Daisy's public lobby, the standing lobby a Room sits in by default. */
export const daisyReferenceLobby = {
  id: publicLobbyId,
  kind: 'standing',
} as const;
