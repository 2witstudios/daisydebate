import { articleRoute } from '../../routes';

const route = articleRoute('guides');

export const generateMetadata = route.generateMetadata;

/** Public: one article, or not found while its release is closed. */
export default route.Page;
