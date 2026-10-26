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
 * Pure check of one built service app config: it builds its own stage,
 * keeps migrations out, and lets Fly wait past its stop budget before
 * SIGKILL (ISSUE-214's rule, per app).
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
  const stopSeconds = Math.ceil(input.stopMs / 1000);
  const required = stopSeconds + KILL_TIMEOUT_MARGIN_S;
  return [
    /^\s*dockerfile\s*=\s*"apps\/web\/Dockerfile"\s*$/m.test(build) &&
    new RegExp(`^\\s*build-target\\s*=\\s*"${input.target}"\\s*$`, 'm').test(
      build,
    )
      ? null
      : `${input.file} must build \`build-target = "${input.target}"\` from apps/web/Dockerfile`,
    /^\s*release_command\s*=/m.test(code)
      ? `${input.file} runs a release_command; migrations run only from fly.migrate.toml`
      : null,
    killTimeoutSeconds(input.toml) >= required
      ? null
      : `${input.file} kill_timeout must be at least ${required} s (the ${stopSeconds} s stop budget plus ${KILL_TIMEOUT_MARGIN_S} s margin)`,
  ].filter((problem): problem is string => problem !== null);
}

/** Names that only a credential would carry. */
const CREDENTIAL_KEY =
  /^\s*([A-Z0-9_]*(?:DATABASE_URL|REDIS_URL|SECRET|KEYS?|TOKEN|PASSWORD))\s*=/gm;

/**
 * Pure check every service app config passes, LiveKit's included: no
 * credential in its committed [env], and a served app always on (DEC-40).
 */
export function findServiceEnvProblems(input: {
  readonly file: string;
  readonly toml: string;
}): readonly string[] {
  const env = uncommented((tableBody(input.toml, '[env]') ?? []).join('\n'));
  const credentials = [...env.matchAll(CREDENTIAL_KEY)].map(
    ([, key]) => `${input.file} [env] sets ${key}; credentials are Fly secrets`,
  );
  const service = tableBody(input.toml, '[http_service]');
  const served = uncommented((service ?? []).join('\n'));
  const alwaysOn =
    service === null ||
    (/^\s*auto_stop_machines\s*=\s*"off"\s*$/m.test(served) &&
      /^\s*min_machines_running\s*=\s*1\s*$/m.test(served));
  return [
    ...credentials,
    ...(alwaysOn
      ? []
      : [
          `${input.file} [http_service] must set auto_stop_machines = "off" and min_machines_running = 1 (DEC-40)`,
        ]),
  ];
}

const namespaceOf = (toml: string) =>
  uncommented((tableBody(toml, '[env]') ?? []).join('\n')).match(
    /^\s*REDIS_NAMESPACE\s*=\s*"([^"]*)"\s*$/m,
  )?.[1];

/**
 * Realtime redeems the connect tickets the web app issues, and tickets are
 * namespaced, so both read REDIS_NAMESPACE from committed [env]; a Fly
 * secret of that name on either app would silently split them.
 */
export function findSharedNamespaceProblem(
  webToml: string,
  realtimeToml: string,
): string | null {
  const web = namespaceOf(webToml);
  return web !== undefined && web === namespaceOf(realtimeToml)
    ? null
    : 'fly.toml and fly.realtime.toml must set the same REDIS_NAMESPACE in [env] (never as a Fly secret): realtime redeems the tickets the web app issues under it';
}

/** Every committed service app checked against its own source's stop budget. */
export function findServiceAppConfigProblems(
  read: (path: string) => string | undefined,
): readonly string[] {
  const namespace = findSharedNamespaceProblem(
    read('fly.toml') ?? '',
    read('fly.realtime.toml') ?? '',
  );
  return [
    ...(namespace ? [namespace] : []),
    ...SERVICE_APPS.flatMap((app) => {
      const toml = read(app.file);
      if (toml === undefined) return [`${app.file} is missing`];
      return [
        ...findServiceEnvProblems({ file: app.file, toml }),
        ...builtServiceProblems(app, toml, read),
      ];
    }),
  ];
}

/** A built app's stage and stop budget; LiveKit's pinned image has neither. */
function builtServiceProblems(
  app: (typeof SERVICE_APPS)[number],
  toml: string,
  read: (path: string) => string | undefined,
): readonly string[] {
  if (app.target === null || app.stop === null) return [];
  const stop = uncommented(read(app.stop.source) ?? '').match(app.stop.pattern);
  if (!stop)
    return [
      `${app.stop.source} no longer states its stop budget as ${app.stop.pattern}`,
    ];
  return findServiceAppProblems({
    file: app.file,
    toml,
    target: app.target,
    stopMs: Number(stop[1]?.replaceAll('_', '')),
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
  // A job-level env sits at four spaces; a step's at eight.
  const jobToken = /^ {4}env:\n(?: {6}.*\n)*? {6}FLY_API_TOKEN:/m.test(code)
    ? [
        'deploy-staging.yml sets FLY_API_TOKEN for a whole job; each deploy token belongs to its own step',
      ]
    : [];
  return [
    ...jobToken,
    ...SERVICE_APPS.flatMap((app) => {
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
    }),
  ];
}
