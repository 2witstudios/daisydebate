import type { StageKind } from '@daisy/protocol/lobby';
import type { BallotDefinition } from '@daisy/protocol/ballot-definition';

type Insert<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'insert';
  readonly row: Row;
};
type Update<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'update';
  readonly id: string;
  readonly set: Partial<Row>;
};
type Delete<Table extends string> = {
  readonly table: Table;
  readonly op: 'delete';
  readonly id: string;
};

type EventRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly name: string;
  readonly label: string | null;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
  readonly templateId: string | null;
  readonly entryKind: 'person' | 'team';
  readonly teamSize: number;
  readonly version: number;
};
type StageRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly kind: StageKind;
  readonly sequence: number;
  readonly division: string | null;
  readonly place: 'online' | 'in_person';
  readonly timing: 'live' | 'windowed';
  readonly windowOpensAt: string | null;
  readonly windowClosesAt: string | null;
  readonly version: number;
};
type TabRoundRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly stageId: string;
  readonly number: number;
  readonly name: string | null;
  readonly timeSlotId: string | null;
  readonly resolutionPoolId: string | null;
  readonly poolResolutionId: string | null;
  readonly version: number;
};
type TimeSlotRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly version: number;
};

/** The rows a setup command writes, on the merged tables' columns. */
export type SetupWrite =
  | Update<'lobbies', { readonly version: number }>
  | Insert<'events', Omit<EventRow, 'version'>>
  | Update<'events', EventRow>
  | Delete<'events'>
  | Insert<'stages', Omit<StageRow, 'version'>>
  | Update<'stages', StageRow>
  | Delete<'stages'>
  | Insert<'tab_rounds', Omit<TabRoundRow, 'version'>>
  | Update<'tab_rounds', TabRoundRow>
  | Delete<'tab_rounds'>
  | Insert<'time_slots', Omit<TimeSlotRow, 'version'>>
  | Update<'time_slots', TimeSlotRow>
  | Delete<'time_slots'>
  | Insert<
      'ballot_definitions',
      {
        readonly id: string;
        readonly lobbyId: string;
        readonly name: string;
        readonly currentVersion: number;
      }
    >
  | Update<'ballot_definitions', { readonly currentVersion: number }>
  | Insert<
      'ballot_definition_versions',
      {
        readonly ballotDefinitionId: string;
        readonly version: number;
        readonly lobbyId: string;
        readonly definition: BallotDefinition;
      }
    >
  | Insert<
      'resolution_pools',
      { readonly id: string; readonly lobbyId: string; readonly name: string }
    >
  | Insert<
      'pool_resolutions',
      {
        readonly id: string;
        readonly poolId: string;
        readonly lobbyId: string;
        readonly text: string;
      }
    >
  | Update<'pool_resolutions', { readonly retiredAt: string }>;
