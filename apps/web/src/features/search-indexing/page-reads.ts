import { requestApp } from '../../lib/page-reads';

/** Canonical deployment URL, never derived from a caller-controlled Host. */
export const requestMetadataBase = (): URL =>
  new URL(requestApp().config.PUBLIC_APP_URL);

export const requestSearchIndexing = () => requestApp().config.SEARCH_INDEXING;
