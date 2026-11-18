import { catalogFormats } from '@daisy/db/catalog-formats';

/** The catalog's templates a custom debate can start from, in catalog order. */
export const catalogTemplates: readonly string[] = catalogFormats
  .filter((entry) => entry.role === 'template')
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((entry) => entry.name);
