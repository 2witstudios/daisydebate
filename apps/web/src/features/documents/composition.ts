import { defineComposition } from '../../server/composition';
import { memberHttpBoundary } from '../auth/member-boundary';
import { createDocumentHandlers } from './document-handlers';
import { createDocumentOperations } from './document-operations';

/** documents: its route files bind here (`processRoute`). */
export const documentComposition = defineComposition('documents', (app) => {
  const operations = createDocumentOperations({
    store: app.database,
    clock: app.clock,
    ids: app.ids,
  });
  return createDocumentHandlers({
    ...memberHttpBoundary(app),
    operations: () => operations,
  });
});
