type LegalSection = {
  /** Anchor id, unique within the document. */
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

export type LegalDocument = {
  readonly title: string;
  readonly version: string;
  readonly lede: string;
  readonly sections: readonly LegalSection[];
};

/**
 * The two placeholder kinds a draft may carry until WAIT-6.2 (counsel and
 * owner review) replaces them: business facts the owner supplies, and
 * judgments counsel makes. Any other bracketed text is a defect.
 */
export const placeholderKinds = ['OWNER', 'COUNSEL'] as const;

/** Every bracketed placeholder in a document's text, in reading order. */
export const placeholdersOf = (document: LegalDocument): readonly string[] =>
  [document.lede, ...document.sections.flatMap((s) => s.paragraphs)].flatMap(
    (text) => text.match(/\[[^\]]*\]/g) ?? [],
  );
