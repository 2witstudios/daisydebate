/** Live PR diff facts; reviewers cannot opt into a lighter evidence tier. */
export type ReviewDiff = {
  readonly headSha: string;
  readonly complete: boolean;
  readonly files: readonly {
    readonly path: string;
    readonly previousPath?: string;
    readonly status: string;
    readonly oldMode?: string;
    readonly newMode?: string;
  }[];
};

const documentPath = (path: string): boolean =>
  /^docs\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(path) &&
  !/(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/i.test(path) &&
  !/(?:^|\/)(?:skills|templates|workflows)(?:\/|$)/i.test(path);

/** Missing, mixed, executable, symlink, renamed-in instructions fail closed. */
export function documentationOnly(
  diff: ReviewDiff | undefined,
  headSha: string,
): boolean {
  return Boolean(
    diff?.complete &&
    diff.headSha === headSha &&
    diff.files.length > 0 &&
    diff.files.every((file) => {
      if (!documentPath(file.path)) return false;
      if (file.status === 'added')
        return file.oldMode === undefined && file.newMode === '100644';
      if (file.status === 'removed')
        return file.oldMode === '100644' && file.newMode === undefined;
      if (file.status === 'renamed')
        return (
          Boolean(file.previousPath && documentPath(file.previousPath)) &&
          file.oldMode === '100644' &&
          file.newMode === '100644'
        );
      return (
        file.status === 'modified' &&
        file.oldMode === '100644' &&
        file.newMode === '100644'
      );
    }),
  );
}
