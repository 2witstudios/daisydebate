import {
  defaultStandingLobby,
  mayDebate,
} from '@daisy/protocol/lobby/eligibility';
import { readRoomDraftAnswer } from './create-room-draft-answer';
import { idle } from '../forms/form-state';
import { cache } from 'react';
import { requestApp, requestIdentity } from '../../lib/page-reads';
import {
  requestCompetitionAgeBand,
  requestOfficialStandingLobbies,
} from '../lobby/page-reads';

/** The lobby choices offered by the Room form, rechecked on submission. */
export const requestRoomCreateLobbyChoice = cache(
  async (sourceLobbyId?: string) => {
    const identity = await requestIdentity();
    if (identity.state !== 'member') return null;
    const creator = await requestApp().database.readRoomCreatorFact(
      identity.principal.userId,
    );
    const lobbies = await requestOfficialStandingLobbies();
    const ages = await Promise.all(
      lobbies.map(({ id }) => requestCompetitionAgeBand(id)),
    );
    const choices = lobbies.filter(
      (lobby, index) =>
        (creator.clubStaff && lobby.ageRule === 'under-18') ||
        mayDebate(
          { ...creator, ageBand: ages[index] ?? null },
          { ...lobby, lobbyId: lobby.id, competitionType: 'casual' },
        ),
    );
    const selected =
      choices.find(({ id }) => id === sourceLobbyId) ??
      (creator.clubStaff || (creator.guardianLobbyIds?.length ?? 0) > 0
        ? (defaultStandingLobby(choices, creator.ageBand) ?? choices[0])
        : null);
    return selected ? { choices, defaultId: selected.id } : null;
  },
);

/** Native create-room preview answers are scoped to this authenticated member. */
export async function requestRoomDraftAnswer(
  commandId: unknown,
  source: string | null = null,
) {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return idle();
  return readRoomDraftAnswer(
    requestApp().redis,
    identity.principal.userId,
    commandId,
    source,
  );
}
