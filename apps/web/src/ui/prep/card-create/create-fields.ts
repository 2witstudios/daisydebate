/** The citation fields of step 3, in form order. Values come from the driver. */
export type CiteField = {
  readonly id: string;
  readonly label: string;
  readonly key:
    | 'tagLine'
    | 'author'
    | 'qualifications'
    | 'publication'
    | 'title'
    | 'published'
    | 'url'
    | 'retrieved'
    | 'tags'
    | 'credibilityNotes';
  readonly placeholder?: string;
  readonly helper?: string;
  readonly required?: boolean;
  readonly wide?: boolean;
  readonly multiline?: boolean;
};

export const citeFields: readonly CiteField[] = [
  {
    id: 'c-tag',
    label: 'Tag line',
    key: 'tagLine',
    placeholder: 'The claim this card proves',
    required: true,
    wide: true,
  },
  { id: 'c-author', label: 'Author', key: 'author' },
  { id: 'c-qual', label: 'Qualifications', key: 'qualifications' },
  { id: 'c-pub', label: 'Publication', key: 'publication' },
  { id: 'c-title', label: 'Title of the source', key: 'title' },
  {
    id: 'c-date',
    label: 'Date published',
    key: 'published',
    placeholder: 'yyyy-mm-dd',
  },
  { id: 'c-url', label: 'URL', key: 'url' },
  {
    id: 'c-ret',
    label: 'Retrieved',
    key: 'retrieved',
  },
  {
    id: 'c-tags',
    label: 'Tags',
    key: 'tags',
    placeholder: 'Type a tag, press Enter',
    helper: 'Private',
  },
  {
    id: 'c-cred',
    label: 'Credibility notes',
    key: 'credibilityNotes',
    placeholder: 'Why you trust this source',
    helper: 'Private',
    wide: true,
    multiline: true,
  },
];
