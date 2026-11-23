import { collectionRoute } from '../routes';

const route = collectionRoute('guides');

export const generateMetadata = route.generateMetadata;

/** Public: one collection, or not found while its release is closed. */
export default route.Page;
