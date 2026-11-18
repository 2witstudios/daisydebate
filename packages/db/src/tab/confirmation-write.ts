import type { ActionHistoryEntry } from '@daisy/protocol/lobby/command';
import type { FixtureWrite } from './fixture-write';
import type { conflicts } from '../schema/conflicts';

export type ConfirmationWrite =
  | FixtureWrite
  | {
      readonly table: 'pending_commands';
      readonly op: 'update';
      readonly commandId: string;
      readonly set: {
        readonly status: 'confirmed' | 'declined' | 'withdrawn';
        readonly settledAt: string;
        readonly settledByUserId: string;
      };
    }
  | {
      readonly table: 'action_history';
      readonly op: 'insert';
      readonly entry: ActionHistoryEntry;
    }
  | {
      readonly table: 'conflicts';
      readonly op: 'insert';
      readonly row: Omit<typeof conflicts.$inferInsert, 'detectedAt'> & {
        readonly detectedAt: string;
      };
    };
