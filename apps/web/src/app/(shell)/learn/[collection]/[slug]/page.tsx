import { articleRoute } from '../../../guides/routes';

const route = articleRoute('learn');

export const generateMetadata = route.generateMetadata;

/** Public: one article, or not found while its release is closed. */
export default route.Page;
