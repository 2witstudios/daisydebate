import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseDotenv } from './dotenv';
import { assessAgentEnv, assessGithubIdentity } from './agent-identity';

setupRitewayBun();

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const example = await Bun.file(`${root}/.env.agent.example`).text();
const filled = example.replace(/^GH_TOKEN=.*$/m, 'GH_TOKEN=agent-token-value');

describe('parseDotenv', () => {
  test('reads comments, export, quotes and inline comments', () => {
    assert({
      given: 'an env file with the forms the repository uses',
      should: 'return each key with its unquoted value',
      actual: parseDotenv(
        [
          '# comment',
          'A=1',
          'export B="two words"',
          "C='!gh auth git-credential'",
          'D=x # trailing',
          'E=',
          'not a line',
        ].join('\n'),
      ),
      expected: {
        A: '1',
        B: 'two words',
        C: '!gh auth git-credential',
        D: 'x',
        E: '',
      },
    });
  });
});

describe('assessAgentEnv', () => {
  test('accepts the committed example once the token is filled in', () => {
    assert({
      given: '.env.agent.example with a token',
      should: 'pass',
      actual: assessAgentEnv(parseDotenv(filled)),
      expected: [],
    });
  });

  test('refuses an agent environment that would fall back to the owner', () => {
    assert({
      given: 'the example as committed, with no token',
      should: 'refuse because gh would use the owner keyring token',
      actual: assessAgentEnv(parseDotenv(example)),
      expected: [
        'GH_TOKEN is empty: gh and git would fall back to the owner keyring token',
      ],
    });
    assert({
      given: 'an env file without the autonomous marker or HTTPS rewrite',
      should: 'name every missing safeguard',
      actual: assessAgentEnv({ GH_TOKEN: 't' }),
      expected: [
        'DAISY_AUTONOMOUS must be 1',
        'GIT_CONFIG_* must rewrite git@github.com: to HTTPS',
        'GIT_CONFIG_* must use `gh auth git-credential` as the GitHub credential helper',
        'GIT_SSH_COMMAND must refuse SSH so the owner key is never used',
      ],
    });
  });
});

describe('assessGithubIdentity', () => {
  const agent = {
    autonomous: true,
    login: 'daisy-agent',
    tokenFromEnv: true,
    pushUrl: 'https://github.com/2witstudios/daisydebate.git',
    credentialHelper: '!gh auth git-credential',
    owner: '2witstudios',
  };

  test('passes an autonomous session under the machine identity', () => {
    assert({
      given: 'an agent session using the agent token over HTTPS',
      should: 'pass and name the identity',
      actual: assessGithubIdentity(agent),
      expected: {
        status: 'pass',
        detail: 'autonomous as daisy-agent (GH_TOKEN, HTTPS push)',
      },
    });
  });

  test('fails an autonomous session that resolves to the owner', () => {
    assert({
      given: 'DAISY_AUTONOMOUS=1 authenticated as the owner',
      should: 'fail',
      actual: assessGithubIdentity({ ...agent, login: '2witstudios' }).status,
      expected: 'fail',
    });
    assert({
      given: 'an autonomous session using the keyring or an SSH remote',
      should: 'fail for each fallback',
      actual: [
        assessGithubIdentity({ ...agent, tokenFromEnv: false }).status,
        assessGithubIdentity({
          ...agent,
          pushUrl: 'git@github.com:2witstudios/daisydebate.git',
        }).status,
        assessGithubIdentity({ ...agent, credentialHelper: 'osxkeychain' })
          .status,
        assessGithubIdentity({ ...agent, login: undefined }).status,
      ],
      expected: ['fail', 'fail', 'fail', 'fail'],
    });
  });

  test('reports the owner session without failing it', () => {
    assert({
      given: 'an owner session on the keyring token',
      should: 'pass and report the identity',
      actual: assessGithubIdentity({
        ...agent,
        autonomous: false,
        login: '2witstudios',
        tokenFromEnv: false,
      }),
      expected: { status: 'pass', detail: 'owner session as 2witstudios' },
    });
  });
});

describe('agent launcher', () => {
  const launch = (envFile: string | undefined) => {
    const dir = mkdtempSync(join(tmpdir(), 'grd-6-launch-'));
    if (envFile !== undefined) writeFileSync(join(dir, '.env.agent'), envFile);
    const base = { ...process.env };
    delete base.GH_TOKEN;
    delete base.DAISY_AUTONOMOUS;
    delete base.PU_PROJECT_ROOT;
    return Bun.spawnSync(
      ['sh', `${root}/scripts/agent-launch.sh`, 'sh', '-c', 'env'],
      { cwd: dir, env: base, stderr: 'pipe' },
    );
  };

  test('exports the machine identity into the agent process', () => {
    const run = launch(filled);
    const env = parseDotenv(run.stdout.toString());
    assert({
      given: 'a worktree holding a filled .env.agent',
      should: 'start the agent with the agent token and HTTPS pushes',
      actual: [
        run.exitCode,
        env.GH_TOKEN,
        env.DAISY_AUTONOMOUS,
        env.GIT_CONFIG_VALUE_3,
      ],
      expected: [0, 'agent-token-value', '1', '!gh auth git-credential'],
    });
  });

  test('refuses to start an agent without the machine identity', () => {
    const missing = launch(undefined);
    const empty = launch(example);
    assert({
      given: 'no .env.agent, and one with an empty token',
      should: 'exit non-zero without starting the agent',
      actual: [
        missing.exitCode,
        missing.stdout.toString(),
        empty.exitCode,
        empty.stdout.toString(),
      ],
      expected: [1, '', 1, ''],
    });
  });
});
