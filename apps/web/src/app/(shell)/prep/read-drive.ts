import { systemClock, systemId } from '@daisy/clock';
import type { Identity } from '@daisy/auth';
import { documentPrincipalOf } from '../../../features/documents/document-principal';
import { createDocumentOperations } from '../../../features/documents/document-operations';
import { processApp } from '../../../server/process-app';

/** The member's own documents as a server page reads them. */
export const memberDrive = (identity: Identity) => {
  const principal = documentPrincipalOf(identity);
  if (principal === null) return null;
  const operations = createDocumentOperations({
    store: processApp().database,
    clock: systemClock,
    ids: systemId,
  });
  return { principal, operations };
};
