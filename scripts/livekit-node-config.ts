/**
 * One Fly app per LiveKit node (SFU-5): a dedicated IPv4 belongs to an app and every
 * machine advertises it, so nodes cannot share one. Each node's config is
 * fly.livekit.toml with its own app, address and machine size. Keys and Redis
 * (`LIVEKIT_KEYS`, `REDIS_HOST`, `REDIS_PASSWORD`) stay Fly secrets, never written here.
 *
 *   bun scripts/livekit-node-config.ts <app> <ipv4> <size> [memory]
 */
export type LiveKitNode = {
  readonly app: string;
  readonly nodeIp: string;
  /** A Fly machine size. Nothing in Daisy assumes one. */
  readonly size: string;
  readonly memory?: string;
};

const required = (text: string, pattern: RegExp, name: string) => {
  if (!pattern.test(text))
    throw new Error(`fly.livekit.toml has no ${name} line to replace`);
};

/** Pure: the staging config is the template, so a node cannot drift from it. */
export function renderLiveKitNode(base: string, node: LiveKitNode): string {
  if (!/^[a-z0-9-]+$/.test(node.app)) throw new Error('Invalid app name');
  if (
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(node.nodeIp) ||
    node.nodeIp.split('.').some((octet) => Number(octet) > 255)
  )
    throw new Error('Invalid node address');
  if (!/^[a-z0-9-]+$/.test(node.size)) throw new Error('Invalid machine size');
  if (node.memory !== undefined && !/^\d+(mb|gb)$/.test(node.memory))
    throw new Error('Invalid machine memory');
  const patterns = {
    app: /^app = ".*"$/m,
    address: /^(\s*)LIVEKIT_NODE_IP = ".*"$/m,
    size: /^(\s*)size = ".*"$/m,
  };
  required(base, patterns.app, 'app');
  required(base, patterns.address, 'LIVEKIT_NODE_IP');
  required(base, patterns.size, 'size');
  const memoryLine = /^(\s*)memory = ".*"$/m;
  required(base, memoryLine, 'memory');
  const placed = base
    .replace(patterns.app, `app = "${node.app}"`)
    .replace(patterns.address, `$1LIVEKIT_NODE_IP = "${node.nodeIp}"`)
    .replace(patterns.size, `$1size = "${node.size}"`);
  return node.memory
    ? placed.replace(memoryLine, `$1memory = "${node.memory}"`)
    : placed.replace(/^\s*memory = ".*"\n/m, '');
}

if (import.meta.main) {
  const [app, nodeIp, size, memory] = Bun.argv.slice(2);
  if (!app || !nodeIp || !size)
    throw new Error('usage: <app> <ipv4> <size> [memory]');
  const base = await Bun.file(
    new URL('../fly.livekit.toml', import.meta.url),
  ).text();
  process.stdout.write(
    renderLiveKitNode(base, {
      app,
      nodeIp,
      size,
      ...(memory ? { memory } : {}),
    }),
  );
}
