import { documentOperations } from '../document-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Actor-owned documents on the documents lane, their search on the search lane. */
export const createDocumentStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    documentOperations({
      database: lane('documents').database,
      searchDatabase: lane('search').database,
      eventSink,
    }),
  );
};
export type DocumentStore = ReturnType<typeof createDocumentStore>;
