import {
  KILL_TIMEOUT_MARGIN_S,
  killTimeoutSeconds,
  tableBody,
  uncommented,
} from './deploy-config-text';

/**
 * ISSUE-528: the staging apps beside web and the migrator. Each deploys
 * from deploy-staging.yml with its own app-scoped token. The two built from
 * apps/web/Dockerfile name their stage and the line of source that bounds
 * how long they take to stop; LiveKit is a pinned third-party image.
 */
export const SERVICE_APPS = [
  {
    file: 'fly.livekit.toml',
    token: 'FLY_LIVEKIT_API_TOKEN',
    target: null,
    stop: null,
  },
  {
    file: 'fly.realtime.toml',
    token: 'FLY_REALTIME_API_TOKEN',
    target: 'realtime',
    stop: {
      source: 'apps/realtime/src/start.ts',
      pattern: /deadlineMs: ([\d_]+),/,
    },
  },
  {
    file: 'fly.media-worker.toml',
    token: 'FLY_MEDIA_WORKER_API_TOKEN',
    target: 'media-worker',
    stop: {
      source: 'apps/media-worker/src/worker.ts',
      pattern: /child\.kill\('SIGKILL'\), ([\d_]+)\)/,
    },
  },
] as const;

/**
 * Pure check of one service app config: it builds its own stage, keeps
 * database credentials and migrations out, and lets Fly wait past its stop
 * budget before SIGKILL (ISSUE-214's rule, per app).
 */
export function findServiceAppProblems(input: {
  readonly file: string;
  readonly toml: string;
  readonly target: string;
  readonly stopMs: number;
}): readonly string[] {
  const code = uncommented(input.toml);
  const build = uncommented(
    (tableBody(input.toml, '[build]') ?? []).join('\n'),
  );
  const env = uncommented((tableBody(input.toml, '[env]') ?? []).join('\n'));
  const credential = env.match(/^\s*([A-Z_]*DATABASE_URL)\s*=/m);
  const stopSeconds = Math.ceil(input.stopMs / 1000);
  const required = stopSeconds + KILL_TIMEOUT_MARGIN_S;
  return [
    /^\s*dockerfile\s*=\s*"apps\/web\/Dockerfile"\s*$/m.test(build) &&
    new RegExp(`^\\s*build-target\\s*=\\s*"${input.target}"\\s*$`, 'm').test(
      build,
    )
      ? null
      : `${input.file} must build \`build-target = "${input.target}"\` from apps/web/Dockerfile`,
    credential
      ? `${input.file} [env] sets ${credential[1]}; database credentials are Fly secrets`
      : null,
    /^\s*release_command\s*=/m.test(code)
      ? `${input.file} runs a release_command; migrations run only from fly.migrate.toml`
      : null,
    killTimeoutSeconds(input.toml) >= required
      ? null
      : `${input.file} kill_timeout must be at least ${required} s (the ${stopSeconds} s stop budget plus ${KILL_TIMEOUT_MARGIN_S} s margin)`,
  ].filter((problem): problem is string => problem !== null);
}

/** Every committed service app checked against its own source's stop budget. */
export function findServiceAppConfigProblems(
  read: (path: string) => string | undefined,
): readonly string[] {
  return SERVICE_APPS.flatMap((app) => {
    if (app.target === null || app.stop === null)
      return read(app.file) === undefined ? [`${app.file} is missing`] : [];
    const stop = uncommented(read(app.stop.source) ?? '').match(
      app.stop.pattern,
    );
    if (!stop)
      return [
        `${app.stop.source} no longer states its stop budget as ${app.stop.pattern}`,
      ];
    return findServiceAppProblems({
      file: app.file,
      toml: read(app.file) ?? '',
      target: app.target,
      stopMs: Number(stop[1]?.replaceAll('_', '')),
    });
  });
}

/**
 * ISSUE-528: deploy-staging.yml deploys each service app after the
 * migration, each step holding only that app's deploy token.
 */
export function findServiceDeployProblems(workflow: string): readonly string[] {
  const code = uncommented(workflow);
  const migrate = code.search(
    /flyctl deploy -c fly\.migrate\.toml[^\n]*--update-only/,
  );
  const steps = code.split(/^\s*- (?=id:|name:|uses:)/m);
  return SERVICE_APPS.flatMap((app) => {
    const deploy = code.indexOf(`flyctl deploy -c ${app.file} `);
    const own = steps.find((step) =>
      step.includes(`flyctl deploy -c ${app.file} `),
    );
    return migrate !== -1 &&
      deploy > migrate &&
      own?.includes(`FLY_API_TOKEN: \${{ secrets.${app.token} }}`)
      ? []
      : [
          `deploy-staging.yml must deploy ${app.file} after the migration, with its own secrets.${app.token}`,
        ];
  });
}
