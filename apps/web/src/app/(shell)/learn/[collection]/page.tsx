import { collectionRoute } from '../../guides/routes';

const route = collectionRoute('learn');

export const generateMetadata = route.generateMetadata;

/** Public: one collection, or not found while its release is closed. */
export default route.Page;
