import type { ResultWrite } from './result-command';
import type { fixtureJudges } from '../schema/fixtures';

/** Officiating owns panel membership and the fixture's current Room pointer. */
export type FixtureWrite =
  | ResultWrite
  | {
      readonly table: 'fixture_judges';
      readonly op: 'insert';
      readonly row: typeof fixtureJudges.$inferInsert;
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'delete';
      readonly fixtureId: string;
      readonly tournamentJudgeId: string;
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'update';
      readonly fixtureId: string;
      readonly tournamentJudgeId: string;
      readonly set: { readonly chair: boolean };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly version: number; readonly roomId?: string };
    }
  | {
      readonly table: 'round_source_voids';
      readonly op: 'insert';
      readonly row: { readonly roundId: string };
    }
  | {
      readonly table: 'rooms';
      readonly op: 'insert';
      readonly id: string;
      readonly likeRoomId: string;
    };
