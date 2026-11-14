// Repository gate for the seat vocabulary (TAB-6.2): a side is a key a format
// declares, so the two-sided preset's keys are written as literals only in
// the protocol's seat preset. Everywhere else reads a seat through the
// protocol's seat predicates or imports the preset's named constants.

const sideLiteral = /(['"`])(affirmative|negative)\1/;

/** Paths allowed to spell a side key: the preset itself, tests and their fixtures. */
const exempt: readonly RegExp[] = [
  /^packages\/protocol\/src\/seats\.ts$/,
  /\.test\.tsx?$/,
  /\.test-support\.tsx?$/,
  /(^|\/)e2e\//,
  /(^|\/)integration\//,
  /\.integration\.tsx?$/,
  /(^|\/)testing\.ts$/,
  /^apps\/web\/src\/features\/format-corpus\//,
  /^scripts\/check-side-literals\.ts$/,
];

const checked = /\.(ts|tsx)$/;

export const sideLiteralIssues = (
  files: readonly { readonly path: string; readonly text: string }[],
): readonly string[] =>
  files
    .filter(({ path }) => checked.test(path))
    .filter(({ path }) => !exempt.some((pattern) => pattern.test(path)))
    .flatMap(({ path, text }) =>
      text
        .split('\n')
        .flatMap((line, index) =>
          sideLiteral.test(line)
            ? [
                `${path}:${index + 1}: a side key is read through @daisy/protocol's seats, never spelled`,
              ]
            : [],
        ),
    );

const trackedSources = (): readonly string[] =>
  Bun.spawnSync([
    'git',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ])
    .stdout.toString()
    .split('\n')
    .filter((path) => checked.test(path));

if (import.meta.main) {
  const files = await Promise.all(
    trackedSources().map(async (path) => ({
      path,
      text: await Bun.file(path).text(),
    })),
  );
  const issues = sideLiteralIssues(files);
  for (const issue of issues) console.error(issue);
  console.log(`${issues.length} side literal(s) outside the protocol preset`);
  process.exitCode = issues.length === 0 ? 0 : 1;
}
