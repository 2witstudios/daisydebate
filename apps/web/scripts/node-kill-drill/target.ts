import { z } from 'zod';

/**
 * What the node kill drill may touch. Everything comes from the environment and
 * is refused here, before a queue slot, a browser or a command: only apps named
 * daisy-mr-, or staging's two LiveKit nodes when asked for by name, reached at their own
 * hosts or at loopback off the shared LiveKit's ports, through a command with no shell
 * that cannot destroy anything.
 */
const SCRATCH_APP = /^daisy-mr-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAGING_NODES = new Set([
  'daisy-debate-staging-livekit',
  'daisy-debate-staging-livekit-b',
]);
const SHARED_LOCAL_LIVEKIT_PORTS = new Set(['7880', '7881', '7882']);
const COMMAND_BINARIES = new Set(['fly', 'flyctl', 'docker']);
const DESTRUCTIVE =
  /\b(destroy|delete|remove|rm|rmi|prune|scale|deploy|secrets?|volumes?|apps)\b/;
const LABEL = /^[a-z0-9][a-z0-9-]{0,63}$/;

const refuse = (why: string): never => {
  throw new Error(`Node kill drill refuses: ${why}`);
};
const isLoopback = (host: string) =>
  host === 'localhost' || host === '127.0.0.1';

const nodeSchema = z.strictObject({
  app: z.string(),
  machine: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  apiUrl: z.string(),
  publicUrl: z.string(),
  /** The node's address in ICE, with a port when several nodes share one address. */
  media: z.string().regex(/^[0-9a-f.:]{3,64}$/),
});
export type DrillNode = z.infer<typeof nodeSchema>;

const requireOwnHost = (app: string, raw: string, name: string) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse(`${name} of ${app} is not a URL`);
  }
  const own = url.hostname.startsWith(`${app}.`);
  const local = isLoopback(url.hostname);
  if (!own && !local) refuse(`${name} of ${app} names another host`);
  if (local && SHARED_LOCAL_LIVEKIT_PORTS.has(url.port))
    refuse(`${name} of ${app} is the shared local LiveKit`);
};

const requireNode = (staging: boolean) => (node: DrillNode) => {
  if (!SCRATCH_APP.test(node.app) && !(staging && STAGING_NODES.has(node.app)))
    refuse(`${node.app} does not begin with daisy-mr-`);
  requireOwnHost(node.app, node.apiUrl, 'apiUrl');
  requireOwnHost(node.app, node.publicUrl, 'publicUrl');
  return node;
};

const readNodes = (raw: string | undefined, staging: boolean) => {
  let nodes: readonly DrillNode[];
  try {
    nodes = z
      .array(nodeSchema)
      .min(1)
      .parse(JSON.parse(raw ?? ''));
  } catch {
    return refuse('DRILL_NODES is not a JSON list of nodes');
  }
  return nodes.map(requireNode(staging));
};

const readCommand = (name: string, raw: string | undefined) => {
  let command: readonly string[];
  try {
    command = z
      .array(z.string().min(1))
      .min(2)
      .parse(JSON.parse(raw ?? ''));
  } catch {
    return refuse(`${name} is not a JSON argument list`);
  }
  if (!COMMAND_BINARIES.has(command[0]!))
    refuse(`${name} must run fly or docker directly, with no shell`);
  if (!command.includes('{app}')) refuse(`${name} has no {app} placeholder`);
  for (const argument of command) {
    if (DESTRUCTIVE.test(argument)) refuse(`${name} could destroy something`);
    if (/daisy-/.test(argument)) refuse(`${name} names an app outright`);
  }
  return command;
};

export type DrillTarget = ReturnType<typeof readDrillTarget>;

/** The whole target, or a refusal that names the setting and never its value. */
export function readDrillTarget(
  env: Readonly<Record<string, string | undefined>>,
) {
  const label = env.DRILL_LABEL ?? '';
  if (!LABEL.test(label)) refuse('DRILL_LABEL must be a short lowercase name');
  const apiKey = env.DRILL_LIVEKIT_API_KEY ?? '';
  const apiSecret = env.DRILL_LIVEKIT_API_SECRET ?? '';
  if (!apiKey || !apiSecret)
    refuse('DRILL_LIVEKIT_API_KEY and DRILL_LIVEKIT_API_SECRET are required');
  return {
    label,
    nodes: readNodes(
      env.DRILL_NODES,
      env.DRILL_ON_STAGING === 'staging-livekit',
    ),
    kill: readCommand('DRILL_KILL_COMMAND', env.DRILL_KILL_COMMAND),
    start: readCommand('DRILL_START_COMMAND', env.DRILL_START_COMMAND),
    state: readCommand('DRILL_STATE_COMMAND', env.DRILL_STATE_COMMAND),
    apiKey,
    apiSecret,
  };
}

export const fillCommand = (
  command: readonly string[],
  node: Pick<DrillNode, 'app' | 'machine'>,
) =>
  command.map((argument) =>
    argument
      .replaceAll('{app}', node.app)
      .replaceAll('{machine}', node.machine),
  );

export type DrillMoment = 'mid-speech' | 'floor-change';

/** Spike step 3 by default; "<mid-speech>,<floor-change>" for a smaller proof. */
export function drillKillPlan(raw: string | undefined): readonly DrillMoment[] {
  const match = /^(\d{1,2}),(\d{1,2})$/.exec(raw ?? '5,1');
  if (!match)
    return refuse('DRILL_KILLS must read "<mid-speech>,<floor-change>"');
  return [
    ...Array<DrillMoment>(Number(match[1])).fill('mid-speech'),
    ...Array<DrillMoment>(Number(match[2])).fill('floor-change'),
  ];
}
