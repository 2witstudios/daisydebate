/**
 * The repository's files as git sees them: tracked, plus untracked files that
 * are not ignored, read NUL-separated so no path is quoted. A git failure
 * throws, so a scan over these files can never pass by reading none.
 */
export function trackedFiles(
  cwd: string,
  pathspecs: readonly string[] = [],
): readonly string[] {
  const files = Bun.spawnSync(
    [
      'git',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs,
    ],
    { cwd },
  );
  if (files.exitCode !== 0) throw new Error(files.stderr.toString());
  return [...new Set(files.stdout.toString().split('\0'))].filter(Boolean);
}
