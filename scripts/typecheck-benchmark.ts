/** CI-only, uncached comparison. It never edits compiler options or task commands. */
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const configsForScript = (workspace: string, script: string): string[] =>
  [...script.matchAll(/(?:tsc|tsgo) --noEmit(?: -p ([\w./-]+))?/g)].map(
    (match) => `${workspace}/${match[1] ?? 'tsconfig.json'}`,
  );

export const compilerArgs = (project: string, buildInfo: string) => [
  '--noEmit',
  '--pretty',
  'false',
  '-p',
  project,
  ...(project === 'apps/web/tsconfig.json'
    ? ['--tsBuildInfoFile', buildInfo]
    : []),
];

export const sameDiagnostics = (left: string, right: string): boolean =>
  left.replaceAll('\r\n', '\n').trim() ===
  right.replaceAll('\r\n', '\n').trim();

export const parseMeasurement = (output: string) => {
  const [seconds, peakRssKiB, exitCode] = output
    .trim()
    .split('\n')
    .at(-1)!
    .split('\t')
    .map(Number);
  if (![seconds, peakRssKiB, exitCode].every(Number.isFinite))
    throw new Error('Invalid GNU time measurement');
  return { seconds: seconds!, peakRssKiB: peakRssKiB!, exitCode: exitCode! };
};

type Sample = ReturnType<typeof parseMeasurement> & {
  project: string;
  engine: string;
  repetition: number;
  diagnostics: string;
};

async function inventory() {
  const projects: string[] = [];
  for await (const path of new Bun.Glob('{apps,packages}/*/package.json').scan(
    '.',
  )) {
    const pkg = await Bun.file(path).json();
    if (pkg.scripts?.typecheck)
      projects.push(...configsForScript(dirname(path), pkg.scripts.typecheck));
  }
  const configs = await Array.fromAsync(
    new Bun.Glob('{apps,packages}/*/tsconfig*.json').scan('.'),
  );
  if (JSON.stringify(projects.sort()) !== JSON.stringify(configs.sort()))
    throw new Error(
      'Typecheck script/config inventory differs; extend the benchmark before measuring',
    );
  return projects;
}

async function measure(
  project: string,
  engine: string,
  repetition: number,
  command: string[],
  output: string,
): Promise<Sample> {
  const stem = `${project.replaceAll('/', '-')}-${engine}-${repetition}`;
  const log = `${output}/${stem}.log`;
  const timing = `${output}/${stem}.time`;
  const child = Bun.spawn(
    ['/usr/bin/time', '-f', '%e\t%M\t%x', '-o', timing, ...command],
    {
      stdout: Bun.file(log),
      stderr: 'pipe',
    },
  );
  const stderr = await new Response(child.stderr).text();
  const code = await child.exited;
  const measurement = parseMeasurement(await Bun.file(timing).text());
  if (measurement.exitCode !== code || code > 2)
    throw new Error(`Compiler process failed: ${stem}`);
  const diagnostics = (await Bun.file(log).text()) + stderr;
  await Bun.write(log, diagnostics);
  return { project, engine, repetition, ...measurement, diagnostics };
}

async function measureProject(
  project: string,
  engines: Record<string, string[]>,
  output: string,
) {
  const samples: Sample[] = [];
  for (const repetition of [1, 2, 3]) {
    // Alternate order to reduce systematic warm filesystem bias. Every compile
    // is cold with respect to incremental state; OS page caches are not flushed.
    const order = Object.entries(engines);
    if (repetition === 2) order.reverse();
    for (const [engine, command] of order) {
      const buildInfo = `${output}/${engine}.tsbuildinfo`;
      await rm(buildInfo, { force: true });
      const args = compilerArgs(project, buildInfo);
      samples.push(
        await measure(
          project,
          engine,
          repetition,
          [...command, ...args],
          output,
        ),
      );
    }
  }
  return samples;
}

async function negativeControl(
  project: string,
  engines: Record<string, string[]>,
  output: string,
) {
  const file = `${dirname(project)}/src/__typecheck_benchmark${project.endsWith('.test.json') ? '.test' : ''}.ts`;
  if (await Bun.file(file).exists())
    throw new Error('Negative-control path already exists');
  await Bun.write(
    file,
    'export const benchmarkNegative: number = "must reject";\n',
  );
  try {
    const results: Sample[] = [];
    for (const [engine, command] of Object.entries(engines)) {
      const buildInfo = `${output}/${engine}-negative.tsbuildinfo`;
      await rm(buildInfo, { force: true });
      results.push(
        await measure(
          project,
          engine,
          0,
          [...command, ...compilerArgs(project, buildInfo)],
          output,
        ),
      );
    }
    return {
      project,
      results,
      rejected: results.every(
        (sample) =>
          sample.exitCode !== 0 &&
          sample.diagnostics.includes('__typecheck_benchmark') &&
          sample.diagnostics.includes('TS2322'),
      ),
      equivalent: sameDiagnostics(
        results[0]!.diagnostics,
        results[1]!.diagnostics,
      ),
    };
  } finally {
    await rm(file);
  }
}

async function referenceControl(
  engines: Record<string, string[]>,
  output: string,
) {
  const root = `${output}/references`;
  await mkdir(`${root}/consumer`, { recursive: true });
  await mkdir(`${root}/producer`, { recursive: true });
  for (const name of ['producer', 'consumer']) {
    await Bun.write(
      `${root}/${name}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          composite: true,
          strict: true,
          types: [],
          skipLibCheck: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
        },
        files: ['index.ts'],
        ...(name === 'consumer'
          ? { references: [{ path: '../producer' }] }
          : {}),
      }),
    );
  }
  await Bun.write(
    `${root}/producer/index.ts`,
    'export const value: number = 42;\n',
  );
  const results: Sample[] = [];
  for (const [index, source] of [
    'export { value } from "../producer/index";\n',
    'import { value } from "../producer/index"; export const wrong: string = value;\n',
  ].entries()) {
    await Bun.write(`${root}/consumer/index.ts`, source);
    for (const [engine, command] of Object.entries(engines)) {
      results.push(
        await measure(
          'references',
          engine,
          index,
          [
            ...command,
            '--build',
            `${root}/consumer`,
            '--force',
            '--pretty',
            'false',
          ],
          output,
        ),
      );
    }
  }
  return {
    results,
    equivalent:
      sameDiagnostics(results[0]!.diagnostics, results[1]!.diagnostics) &&
      sameDiagnostics(results[2]!.diagnostics, results[3]!.diagnostics),
    passed:
      results.slice(0, 2).every((r) => r.exitCode === 0) &&
      results
        .slice(2)
        .every((r) => r.exitCode !== 0 && r.diagnostics.includes('TS2322')),
  };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error(
      'Run the benchmark in GitHub Actions, not the shared local machine',
    );
  const output = resolve(process.argv[2]!);
  const native = resolve(process.argv[3]!);
  await mkdir(output, { recursive: true });
  const engines = { tsc: [resolve('node_modules/.bin/tsc')], tsgo: [native] };
  const projects = await inventory();
  const samples: Sample[] = [];
  const controls = [];
  for (const project of projects) {
    samples.push(...(await measureProject(project, engines, output)));
    controls.push(await negativeControl(project, engines, output));
  }
  const references = await referenceControl(engines, output);
  const equivalent =
    projects.every((project) => {
      const rows = samples.filter((s) => s.project === project);
      return rows.every(
        (r) =>
          r.exitCode === 0 &&
          sameDiagnostics(rows[0]!.diagnostics, r.diagnostics),
      );
    }) &&
    controls.every((c) => c.rejected && c.equivalent) &&
    references.passed &&
    references.equivalent;
  await Bun.write(
    `${output}/results.json`,
    JSON.stringify(
      {
        sha: process.env.GITHUB_SHA,
        projects,
        samples,
        controls,
        references,
        equivalent,
      },
      null,
      2,
    ),
  );
  const summary = [
    '## Typecheck comparison',
    '',
    `Candidate: ${process.env.GITHUB_SHA}`,
    `All projects green with equivalent diagnostics and controls: ${equivalent}`,
    '',
    '| Project | Engine | Median seconds | Peak RSS KiB (max) | Exit codes |',
    '| --- | --- | ---: | ---: | --- |',
  ];
  for (const project of projects) {
    for (const engine of Object.keys(engines)) {
      const rows = samples.filter(
        (s) => s.project === project && s.engine === engine,
      );
      summary.push(
        `| ${project} | ${engine} | ${rows.map((r) => r.seconds).sort((a, b) => a - b)[1]} | ${Math.max(...rows.map((r) => r.peakRssKiB))} | ${rows.map((r) => r.exitCode).join(', ')} |`,
      );
    }
  }
  await Bun.write(`${output}/summary.md`, summary.join('\n') + '\n');
  // A completed incompatible spike is evidence, not a broken benchmark. The
  // decision remains explicit; this job never switches the accepted compiler.
  process.stdout.write(summary.join('\n') + '\n');
}

if (import.meta.main) await main();
