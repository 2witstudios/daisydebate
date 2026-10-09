import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
/** Pure assessment of the effective PU commands, without parent git state. */
export function puLauncherProblem(
  config: unknown,
  launcherUsable: boolean,
): string | undefined {
  const agents =
    config && typeof config === 'object' && 'agents' in config
      ? config.agents
      : undefined;
  const entries =
    agents && typeof agents === 'object' && !Array.isArray(agents)
      ? Object.values(agents)
      : [];
  const wrapped =
    entries.length > 0 &&
    entries.every((agent) => {
      if (!agent || typeof agent !== 'object') return false;
      const command = 'command' in agent ? agent.command : undefined;
      const args = 'launchArgs' in agent ? agent.launchArgs : undefined;
      return (
        typeof command === 'string' &&
        /^(?:\.\/)?scripts\/agent-launch\.sh\s+\S+/.test(command) &&
        !/[;&|`$\n\r<>]/.test(command) &&
        (args === undefined ||
          (Array.isArray(args) &&
            args.every(
              (arg) => typeof arg === 'string' && !/[;&|`$\n\r<>]/.test(arg),
            )))
      );
    });
  return wrapped && launcherUsable
    ? undefined
    : 'active PU config must wrap every agent in the executable scripts/agent-launch.sh from this checkout; coordinate the launcher owner, never restore parent files automatically';
}

/** Read only the active project's launcher and this candidate's expected bytes. */
export async function readPuLauncher(
  root: string,
  main: string,
): Promise<{ config: unknown; usable: boolean }> {
  try {
    const launcher = resolve(main, 'scripts/agent-launch.sh');
    const [config, active, expected, info] = await Promise.all([
      readFile(resolve(main, '.pu/config.yaml'), 'utf8'),
      readFile(launcher, 'utf8'),
      readFile(resolve(root, 'scripts/agent-launch.sh'), 'utf8'),
      stat(launcher),
    ]);
    return {
      config: Bun.YAML.parse(config),
      usable: info.isFile() && (info.mode & 0o111) !== 0 && active === expected,
    };
  } catch {
    return { config: undefined, usable: false };
  }
}
