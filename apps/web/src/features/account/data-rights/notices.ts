import type { EraseAccountNotice } from './erase-account';
import type { ExportDataNotice } from './export-data';
import { ERASE_ACCOUNT_QUERY, EXPORT_DATA_QUERY } from './notices-keys';

/**
 * The settings page's data-rights notices, parsed from the fixed keys the
 * handlers answer with (UI conventions: a notice key is a constant the
 * feature exports; the page compares it with === and renders a fixed
 * sentence, never text from the URL).
 */
export type DataRightsNotices = {
  readonly exportData: ExportDataNotice | null;
  readonly erase: EraseAccountNotice | null;
};

const oneOf = <T extends string>(
  value: string,
  notices: readonly T[],
): T | null => notices.find((notice) => notice === value) ?? null;

export const parseDataRightsQuery = (
  query: Record<string, unknown>,
): DataRightsNotices => ({
  exportData: oneOf<ExportDataNotice>(String(query[EXPORT_DATA_QUERY] ?? ''), [
    'rate-limited',
    'refused',
  ]),
  erase: oneOf<EraseAccountNotice>(String(query[ERASE_ACCOUNT_QUERY] ?? ''), [
    'confirm',
    'rate-limited',
    'refused',
  ]),
});
