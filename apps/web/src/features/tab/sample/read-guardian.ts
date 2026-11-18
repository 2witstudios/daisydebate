import {
  samplePronouns,
  sampleGuardianView,
  sampleWardAccount,
  sampleWardEntryRequest,
} from './guardian';
import type { SampleScene } from './scene';
import {
  type MinorAccount,
  type TournamentRequest,
  type Family,
  familyOf,
  minorAccountOf,
  tournamentRequestOf,
} from '../guardian';

export const readFamily = (scene: SampleScene): Family | null => {
  const view = sampleGuardianView(scene);
  return view === null ? null : familyOf(view, () => samplePronouns);
};

export const readMinorAccount = (
  minor: string,
  scene: SampleScene,
): MinorAccount | null => {
  const view = sampleWardAccount(minor, scene);
  return view === null ? null : minorAccountOf(view, samplePronouns);
};

export const readTournamentRequest = (
  minor: string,
  slug: string,
  scene: SampleScene,
): TournamentRequest | null => {
  const view = sampleWardEntryRequest(minor, slug, scene);
  return view === null ? null : tournamentRequestOf(view, samplePronouns);
};
