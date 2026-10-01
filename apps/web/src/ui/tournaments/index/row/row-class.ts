export type RowColumn = 'name' | 'when' | 'slots' | 'action';

/** One grid for the header and every row; the phone stacks the cells. */
export const rowGridClass =
  'grid grid-cols-12 items-center gap-x-5 max-compact:grid-cols-2 max-compact:gap-x-3 max-compact:gap-y-2';

const columns: Readonly<Record<RowColumn, string>> = {
  name: 'col-span-4 min-w-0 max-compact:col-span-2',
  when: 'col-span-3 max-compact:col-span-2',
  slots: 'col-span-3 max-compact:col-span-1',
  action: 'col-span-2 max-compact:col-span-1',
};

export const rowColumnClass = (column: RowColumn): string => columns[column];
