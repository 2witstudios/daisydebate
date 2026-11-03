import type { TournamentSource } from '../../features/tournaments/source';
import { sampleBracket } from './tournament-brackets';
import { sampleConsole } from './tournament-console';
import { sampleEvent } from './tournament-events';
import {
  sampleAttention,
  sampleDraft,
  sampleOrganized,
} from './tournament-organizer';
import { sampleResults } from './tournament-results';
import {
  sampleDescription,
  sampleEntries,
  sampleRoster,
  sampleTournaments,
  sampleViewer,
} from './tournaments';

/** Sample data for every Tournaments page, handed in at the page. */
export const sampleTournamentSource: TournamentSource = {
  tournaments: sampleTournaments,
  viewer: sampleViewer,
  entries: sampleEntries,
  roster: sampleRoster,
  description: sampleDescription,
  bracket: sampleBracket,
  results: sampleResults,
  event: sampleEvent,
  console: sampleConsole,
  draft: sampleDraft,
  organized: sampleOrganized,
  attention: sampleAttention,
};
