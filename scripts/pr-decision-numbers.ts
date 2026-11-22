import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const adr = /^docs\/decisions\/(\d{4,})-[a-z0-9-]+\.md$/;
const lines = (value: string) => value.split('\n').filter(Boolean);
// Owner-pinned landed Piece B history, before PR numbering was adopted.
const adoptionBase = '58cc6c749713609a8c8d04f00572267c373033b5';

export function newAdrPath(number: number, slug: string): string {
  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  )
    throw new Error(
      'A positive PR number and lowercase decision slug are required',
    );
  return `docs/decisions/${String(number).padStart(4, '0')}-${slug}.md`;
}

export function pendingAdrProblems(
  number: number,
  baseFiles: readonly string[],
  currentFiles: readonly string[],
): string[] {
  const base = new Set(baseFiles);
  const added = currentFiles.filter(
    (path) => !base.has(path) && adr.test(path),
  );
  const malformed = currentFiles.filter(
    (path) =>
      !base.has(path) &&
      /^docs\/decisions\/.*\.md$/.test(path) &&
      path !== 'docs/decisions/README.md' &&
      !adr.test(path),
  );
  const problems = added
    .filter((path) => Number(adr.exec(path)?.[1]) !== number)
    .map(
      (path) =>
        `${path}: new ADR uses its owning PR number ${number}; create it with bun adr:new ${number} <slug>`,
    );
  problems.push(
    ...malformed.map(
      (path) => `${path}: new decision records require their owning PR number`,
    ),
  );
  if (added.length > 1)
    problems.push(
      'One PR owns one architecture decision record; group its related rulings in that record',
    );
  if (
    added.length &&
    baseFiles.some((path) => Number(adr.exec(path)?.[1]) === number)
  )
    problems.push(
      `ADR ${number} already has a landed record; its identifier is immutable`,
    );
  return problems;
}

/** Preserve records already landed in a parent through an owning PR merge. */
export function landedAdrFiles(
  cwd: string,
  files: readonly string[],
  ref = 'HEAD',
): readonly string[] {
  const run = (args: readonly string[]) =>
    spawnSync('git', args, { cwd, encoding: 'utf8' });
  const historical = run([
    'ls-tree',
    '-r',
    '--name-only',
    adoptionBase,
    '--',
    'docs/decisions',
  ]);
  const landed = new Set(
    historical.status === 0 ? lines(historical.stdout) : [],
  );
  for (const path of files.filter(
    (file) => adr.test(file) && !landed.has(file),
  )) {
    const introduced = run([
      'log',
      '--first-parent',
      '--diff-filter=A',
      '-1',
      '--format=%P%n%B',
      ref,
      '--',
      path,
    ]);
    if (introduced.status !== 0)
      throw new Error('Cannot inspect an inherited ADR introduction');
    const [parents = '', ...message] = introduced.stdout.split('\n');
    const owner = /^Merge pull request #(\d+)\b/.exec(message.join('\n'))?.[1];
    if (
      parents.trim().split(' ').length >= 2 &&
      owner &&
      Number(owner) === Number(adr.exec(path)?.[1])
    )
      landed.add(path);
  }
  return [...landed];
}

/** No all-open-PR scan: only this PR supplies a new record's identifier. */
export function prDecisionProblems(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): readonly string[] {
  const run = (args: readonly string[]) => {
    const result = spawnSync(args[0]!, args.slice(1), {
      cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0)
      throw new Error(
        'Cannot inspect this PR decision context; fetch its destination and retry',
      );
    return result.stdout.trim();
  };
  try {
    const currentFiles = lines(
      run([
        'git',
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'docs/decisions',
      ]),
    );
    const mainFiles = lines(
      run([
        'git',
        'ls-tree',
        '-r',
        '--name-only',
        'origin/main',
        '--',
        'docs/decisions',
      ]),
    );
    const landed = [...mainFiles, ...landedAdrFiles(cwd, currentFiles)];
    if (
      currentFiles
        .filter((path) => adr.test(path))
        .every((path) => landed.includes(path))
    )
      return [];
    const ciNumber = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1];
    const context =
      ciNumber && env.GITHUB_BASE_REF
        ? { number: Number(ciNumber), baseRefName: env.GITHUB_BASE_REF }
        : (JSON.parse(
            run(['gh', 'pr', 'view', '--json', 'number,baseRefName']),
          ) as { number: number; baseRefName: string });
    if (
      !Number.isSafeInteger(context.number) ||
      context.number <= 0 ||
      !/^[a-zA-Z0-9/_.-]+$/.test(context.baseRefName)
    )
      throw new Error('Invalid PR decision context');
    const base = `refs/remotes/origin/${context.baseRefName}`;
    const baseFiles = lines(
      run([
        'git',
        'ls-tree',
        '-r',
        '--name-only',
        base,
        '--',
        'docs/decisions',
      ]),
    );
    return pendingAdrProblems(
      context.number,
      [...baseFiles, ...landed],
      currentFiles,
    );
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : 'Could not validate PR-owned decision numbers',
    ];
  }
}

if (import.meta.main) {
  const number = Number(process.argv[2]);
  const slug = process.argv[3] ?? '';
  const source = process.argv[4];
  if (!source)
    throw new Error(
      'Usage: bun adr:new <owning-pr-number> <slug> <completed-markdown-file>',
    );
  const result = spawnSync(
    'gh',
    ['pr', 'view', String(number), '--json', 'number,headRefName,state'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error('Open the owning PR before creating its ADR');
  const pr = JSON.parse(result.stdout) as {
    number: number;
    headRefName: string;
    state: string;
  };
  const branch = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  });
  if (
    pr.number !== number ||
    pr.state !== 'OPEN' ||
    branch.status !== 0 ||
    pr.headRefName !== branch.stdout.trim()
  )
    throw new Error('Create a record only in its owning open PR checkout');
  const file = newAdrPath(number, slug);
  const body = readFileSync(source, 'utf8');
  if (!/^#\s+\S/.test(body) || !/\nStatus:\s+\S/.test(body))
    throw new Error('Supply a completed ADR with a title and Status');
  if (existsSync(file)) throw new Error('The ADR already exists');
  const content = body.replace(
    /^#\s+(?:\d+:\s*)?/,
    `# ${String(number).padStart(4, '0')}: `,
  );
  writeFileSync(join(process.cwd(), file), content, { flag: 'wx' });
  console.log(file);
}
