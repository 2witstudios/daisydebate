import type { AccountRevisionWrite } from './command-accounts';
type EntryRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly name: string;
  readonly submittedByUserId: string;
  readonly status: 'pending' | 'accepted' | 'withdrawn';
  readonly division: string | null;
  readonly responsibleKind: 'school' | 'guardian' | 'self';
  readonly schoolOrganizationId: string | null;
  readonly guardianLinkId: string | null;
};
export type EntryEnrollmentWrite =
  | { readonly table: 'entries'; readonly op: 'insert'; readonly row: EntryRow }
  | {
      readonly table: 'entries';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: Partial<
        Pick<EntryRow, 'status' | 'division'> & {
          readonly breakDivision: string;
        }
      >;
    }
  | {
      readonly table: 'entry_members';
      readonly op: 'insert';
      readonly row: {
        readonly entryId: string;
        readonly actorId: string;
        readonly eventId: string;
        readonly lobbyId: string;
        readonly entryStatus: 'pending' | 'accepted' | 'withdrawn';
      };
    }
  | {
      readonly table: 'events';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: { readonly entriesVersion: number };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'update';
      readonly where: { readonly guardianLinkId: string };
      readonly set: { readonly version: number };
    }
  | AccountRevisionWrite;
