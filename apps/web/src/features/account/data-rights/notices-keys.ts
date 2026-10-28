/**
 * The fixed query keys the data-rights handlers answer with. The pages
 * compare these with === and render fixed sentences; no form value ever
 * travels in a URL (UI conventions, ISSUE-18's no-JS rule).
 */
export const EXPORT_DATA_QUERY = 'privacyExport';
export const ERASE_ACCOUNT_QUERY = 'privacyErase';
export const ACCOUNT_CLOSED_QUERY = 'closed';
