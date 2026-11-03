import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readDrillTarget, fillCommand, drillKillPlan } from './target';

setupRitewayBun();

const node = (app: string, port = 18880) => ({
  app,
  machine: 'machine1',
  apiUrl: `http://127.0.0.1:${port}`,
  publicUrl: `wss://localhost:${port + 1}`,
  media: `127.0.0.1:${port + 2}`,
});
const fly = (app: string) => ({
  app,
  machine: '48ee392c431d48',
  apiUrl: `https://${app}.fly.dev`,
  publicUrl: `wss://${app}.fly.dev`,
  media: '66.51.125.26',
});
const env = (overrides: Record<string, string | undefined> = {}) => ({
  DRILL_NODES: JSON.stringify([fly('daisy-mr-lk-a'), fly('daisy-mr-lk-b')]),
  DRILL_KILL_COMMAND: JSON.stringify([
    'fly',
    'machine',
    'stop',
    '{machine}',
    '-a',
    '{app}',
    '--signal',
    'SIGKILL',
  ]),
  DRILL_START_COMMAND: JSON.stringify([
    'fly',
    'machine',
    'start',
    '{machine}',
    '-a',
    '{app}',
  ]),
  DRILL_STATE_COMMAND: JSON.stringify([
    'fly',
    'machine',
    'list',
    '-a',
    '{app}',
    '--json',
  ]),
  DRILL_LIVEKIT_API_KEY: 'key',
  DRILL_LIVEKIT_API_SECRET: 'secret',
  DRILL_LABEL: 'baseline',
  ...overrides,
});
const refusalOf = (values: Record<string, string | undefined>) => {
  try {
    readDrillTarget(values);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

test('readDrillTarget accepts scratch nodes', () => {
  const target = readDrillTarget(env());
  assert({
    given: 'two daisy-mr- Fly apps and commands that name them by placeholder',
    should: 'read both nodes in order and the label',
    actual: [target.nodes.map((entry) => entry.app), target.label],
    expected: [['daisy-mr-lk-a', 'daisy-mr-lk-b'], 'baseline'],
  });
});

test('readDrillTarget refuses anything but scratch targets', () => {
  const cases: readonly (readonly [string, Record<string, string>])[] = [
    [
      'a staging app',
      {
        DRILL_NODES: JSON.stringify([fly('daisy-debate-staging-livekit')]),
      },
    ],
    [
      'an app whose name only contains the prefix',
      { DRILL_NODES: JSON.stringify([fly('not-daisy-mr-lk-a')]) },
    ],
    [
      'a scratch name pointed at another host',
      {
        DRILL_NODES: JSON.stringify([
          {
            ...fly('daisy-mr-lk-a'),
            apiUrl: 'https://daisy-debate-staging-livekit.fly.dev',
          },
        ]),
      },
    ],
    [
      'a scratch name whose browser URL is another host',
      {
        DRILL_NODES: JSON.stringify([
          {
            ...fly('daisy-mr-lk-a'),
            publicUrl: 'wss://daisy-debate-staging-livekit.fly.dev',
          },
        ]),
      },
    ],
    [
      'the shared local LiveKit',
      { DRILL_NODES: JSON.stringify([node('daisy-mr-local-a', 7880)]) },
    ],
    [
      'a kill command that names an app outright',
      {
        DRILL_KILL_COMMAND: JSON.stringify([
          'fly',
          'machine',
          'stop',
          '-a',
          'daisy-debate-staging-livekit',
          '{app}',
        ]),
      },
    ],
    [
      'a kill command with no app placeholder',
      { DRILL_KILL_COMMAND: JSON.stringify(['fly', 'machine', 'stop']) },
    ],
    [
      'a command that destroys',
      {
        DRILL_KILL_COMMAND: JSON.stringify([
          'fly',
          'machine',
          'destroy',
          '-a',
          '{app}',
        ]),
      },
    ],
    [
      'a command through a shell',
      { DRILL_START_COMMAND: JSON.stringify(['sh', '-c', 'start {app}']) },
    ],
    ['no key', { DRILL_LIVEKIT_API_KEY: '' }],
    ['no nodes', { DRILL_NODES: '[]' }],
    ['a label that could escape the report folder', { DRILL_LABEL: '../x' }],
  ];
  for (const [given, overrides] of cases)
    assert({
      given,
      should: 'refuse before anything starts',
      actual: refusalOf(env(overrides))?.startsWith('Node kill drill refuses'),
      expected: true,
    });
});

test('readDrillTarget accepts its own local scratch containers', () => {
  const target = readDrillTarget(
    env({
      DRILL_NODES: JSON.stringify([
        node('daisy-mr-local-a', 18880),
        node('daisy-mr-local-b', 18890),
      ]),
      DRILL_KILL_COMMAND: JSON.stringify(['docker', 'kill', '{app}']),
    }),
  );
  assert({
    given: 'loopback nodes off the shared ports',
    should: 'accept them',
    actual: target.nodes.length,
    expected: 2,
  });
});

test('readDrillTarget refuses without any setting', () => {
  assert({
    given: 'an environment with no drill settings',
    should: 'refuse',
    actual: refusalOf({})?.startsWith('Node kill drill refuses'),
    expected: true,
  });
});

test('readDrillTarget never repeats a secret in its refusal', () => {
  const message = refusalOf(
    env({ DRILL_NODES: '[]', DRILL_LIVEKIT_API_SECRET: 'hunter2hunter2' }),
  );
  assert({
    given: 'a refused target with a secret set',
    should: 'leave the secret out of the message',
    actual: message?.includes('hunter2hunter2'),
    expected: false,
  });
});

test('fillCommand', () => {
  assert({
    given: 'a command template and a node',
    should: 'fill the app and machine as whole arguments, with no shell',
    actual: fillCommand(['fly', 'stop', '{machine}', '-a', '{app}'], {
      app: 'daisy-mr-lk-a',
      machine: 'm1',
    }),
    expected: ['fly', 'stop', 'm1', '-a', 'daisy-mr-lk-a'],
  });
});

test('drillKillPlan', () => {
  assert({
    given: 'no override',
    should: 'plan the spike: five kills mid-speech, then one at a floor change',
    actual: drillKillPlan(undefined),
    expected: [
      'mid-speech',
      'mid-speech',
      'mid-speech',
      'mid-speech',
      'mid-speech',
      'floor-change',
    ],
  });
  assert({
    given: 'a smaller plan for a local proof',
    should: 'plan that many of each',
    actual: drillKillPlan('1,1'),
    expected: ['mid-speech', 'floor-change'],
  });
  assert({
    given: 'an unreadable plan',
    should: 'fall to a refusal',
    actual: (() => {
      try {
        return drillKillPlan('many');
      } catch (error) {
        return (error as Error).message.startsWith('Node kill drill refuses');
      }
    })(),
    expected: true,
  });
});
