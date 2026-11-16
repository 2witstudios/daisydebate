import type { AccountRevisionWrite } from './command-accounts';
export type JudgeRegistrationWrite =
  | {
      readonly table: 'tournament_judges';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly lobbyId: string;
        readonly actorId: string;
        readonly schoolOrganizationId: string | null;
        readonly status: 'invited' | 'accepted' | 'declined' | 'removed';
        readonly chairQualified: boolean;
      };
    }
  | {
      readonly table: 'tournament_judges';
      readonly op: 'update';
      readonly where: { readonly id: string; readonly version: number };
      readonly set: {
        readonly status?: 'invited' | 'accepted' | 'declined' | 'removed';
        readonly schoolOrganizationId?: string | null;
        readonly chairQualified?: boolean;
        readonly version: number;
      };
    }
  | {
      readonly table: 'judge_events';
      readonly op: 'insert';
      readonly row: {
        readonly tournamentJudgeId: string;
        readonly eventId: string;
        readonly lobbyId: string;
      };
    }
  | {
      readonly table: 'judge_events';
      readonly op: 'delete';
      readonly where: { readonly tournamentJudgeId: string };
    }
  | {
      readonly table: 'judge_availability';
      readonly op: 'insert';
      readonly row: {
        readonly tournamentJudgeId: string;
        readonly timeSlotId: string;
        readonly lobbyId: string;
        readonly available: boolean;
      };
    }
  | {
      readonly table: 'judge_availability';
      readonly op: 'update';
      readonly where: {
        readonly tournamentJudgeId: string;
        readonly timeSlotId: string;
      };
      readonly set: { readonly available: boolean };
    }
  | AccountRevisionWrite;
