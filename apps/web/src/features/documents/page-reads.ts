import { type Identity } from '@daisy/auth';
import { createDocumentOperations } from './document-operations';
import { documentPrincipalOf } from './document-principal';
import { requestApp } from '../../lib/page-reads';

/** The member's own drive as a server page reads it; null for anyone else. */
export const requestMemberDrive = (identity: Identity) => {
  const principal = documentPrincipalOf(identity);
  if (principal === null) return null;
  const app = requestApp();
  return {
    principal,
    operations: createDocumentOperations({
      store: app.database,
      clock: app.clock,
      ids: app.ids,
    }),
  };
};
