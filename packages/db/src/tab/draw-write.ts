import type {
  audiences,
  drawMethods,
  fixtureKinds,
  fixtureStatuses,
  releaseThings,
} from '@daisy/protocol/lobby';
import type { DrawOverride } from '@daisy/protocol/lobby/draw-command';
type DrawMethod = (typeof drawMethods)[number];
type FixtureKind = (typeof fixtureKinds)[number];
type FixtureStatus = (typeof fixtureStatuses)[number];
type EngineInputsRecord = {
  readonly engine: Readonly<Record<string, string>>;
  readonly settingsDigest: string;
  readonly seed: string;
  readonly cutoff: number;
  readonly results: readonly string[];
} & Readonly<Record<string, unknown>>;
type DrawInputs = {
  /** The engine's inputs record; null for a typed draw never computed. */
  readonly engine: EngineInputsRecord | null;
  /** The digest of the event's resolved settings the version was made under. */
  readonly settingsDigest: string;
  /** The `rule` keys the version breaks; each needs an override to publish. */
  readonly broken: readonly string[];
  /** The rules the host overrode at publish, with the reason. */
  readonly overrides: readonly DrawOverride[];
};

type DrawChild = {
  readonly tabRoundId: string;
  readonly eventId: string;
  readonly lobbyId: string;
};
type FixtureChild = DrawChild & {
  readonly fixtureId: string;
  readonly fixtureStatus: FixtureStatus;
};

/** The rows a draw command writes, on the merged tables' columns. */
export type DrawWrite =
  | {
      readonly table: 'draws';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly id: string;
        readonly version: number;
        readonly status: 'draft';
        readonly basedOnDrawId: string | null;
        readonly method: DrawMethod;
        readonly engineVersion: string | null;
        readonly inputs: DrawInputs;
      };
    }
  | {
      readonly table: 'draws';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: {
        readonly status: 'published';
        readonly publishedAt: string;
        readonly inputs: DrawInputs;
      };
    }
  | {
      readonly table: 'draws';
      readonly op: 'delete';
      readonly where: { readonly id: string };
    }
  | {
      readonly table: 'draw_fixtures';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly drawId: string;
        readonly fixtureId: string;
      };
    }
  | {
      readonly table: 'draw_result_inputs';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly drawId: string;
        readonly resultId: string;
      };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'insert';
      readonly row: Omit<DrawChild, 'tabRoundId'> & {
        readonly id: string;
        readonly tabRoundId: string;
        readonly kind: FixtureKind;
        readonly status: 'draft';
      };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set:
        | {
            readonly status: 'published';
            readonly publishedAt: string;
            readonly roomId: string | null;
          }
        | { readonly status: 'withdrawn'; readonly withdrawnAt: string }
        /** Officiating a live fixture moves its own version, as one judge command does. */
        | { readonly version: number };
    }
  | {
      readonly table: 'fixtures';
      readonly op: 'delete';
      readonly where: { readonly id: string };
    }
  | {
      readonly table: 'fixture_entries';
      readonly op: 'insert';
      readonly row: FixtureChild & {
        readonly entryId: string;
        readonly position: number;
        readonly side: string | null;
      };
    }
  | {
      readonly table: 'fixture_entries' | 'fixture_judges';
      readonly op: 'delete';
      readonly where: { readonly fixtureId: string };
    }
  | {
      readonly table: 'fixture_judges';
      readonly op: 'insert';
      readonly row: FixtureChild & {
        readonly tournamentJudgeId: string;
        readonly chair: boolean;
      };
    }
  | {
      /**
       * An event Room for a newly published fixture. The rest of a Room's
       * columns (config, rules snapshot, execution plan) are the Room
       * factory's, made by the store from the pinned settings.
       */
      readonly table: 'rooms';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly lobbyId: string;
        readonly lobbyKind: 'tournament';
        readonly title: string;
        readonly status: 'assembling';
        readonly formatId: string;
        readonly formatVersion: number;
        readonly templateId: string | null;
        readonly ballotDefinitionId: string | null;
        readonly ballotDefinitionVersion: number | null;
      };
    }
  | {
      readonly table: 'rooms';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: { readonly status: 'closed' };
    }
  | {
      /** A seat in the new Room; its role and slot are the Room factory's. */
      readonly table: 'room_participants';
      readonly op: 'insert';
      readonly row: { readonly roomId: string; readonly actorId: string };
    }
  | {
      readonly table: 'releases';
      readonly op: 'insert';
      readonly row: DrawChild & {
        readonly id: string;
        readonly thing: (typeof releaseThings)[number];
        readonly audience: (typeof audiences)[number];
        readonly cause: 'at_once';
        readonly commandId: string;
        readonly openedAt: string;
      };
    }
  | {
      readonly table: 'time_slots';
      readonly op: 'update';
      readonly where: { readonly id: string; readonly version: number };
      readonly set: { readonly version: number };
    };
