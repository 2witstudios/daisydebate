import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';

/** One column's classification before its table's shared purpose and rules are added. */
export type FieldShape = Pick<
  PrivacyFieldDeclaration,
  'column' | 'category' | 'visibility' | 'exportable'
>;
export const identifierField = (column: string): FieldShape => ({
  column,
  category: 'identifier',
  exportable: false,
});
export const plainField = (column: string): FieldShape => ({
  column,
  category: 'none',
  exportable: false,
});
export const personalField = (
  column: string,
  exportable = false,
): FieldShape => ({
  column,
  category: 'personal',
  visibility: 'private',
  exportable,
});
export const secretField = (column: string): FieldShape => ({
  column,
  category: 'secret',
  exportable: false,
});
