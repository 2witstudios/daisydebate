import { ballotRubric } from '@daisy/protocol/ballot';

/** The default ballot's groups and categories, as the coach page shows them. */
export const ballotGroups = (): readonly {
  readonly name: string;
  readonly categories: readonly string[];
}[] =>
  ballotRubric.map((group) => ({
    name: group.name,
    categories: group.categories.map((category) => category.name),
  }));

export const ballotCategoryCount = (): number =>
  ballotGroups().reduce((count, group) => count + group.categories.length, 0);
