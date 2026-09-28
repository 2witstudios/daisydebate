import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { capsPath, parseMachineCaps, setBuilderCap } from './agent-cap';
import { spawnAgent } from './agent-spawn';
import {
  fakeMachine,
  repo,
  spawnArgs,
  spawned,
  working,
} from './agent-spawn.test-support';

setupRitewayBun();

describe('parseMachineCaps()', () => {
  test('no caps file', () => {
    assert({
      given: 'a machine with no caps file',
      should: 'set no machine cap, leaving the default',
      actual: parseMachineCaps(undefined),
      expected: {},
    });
  });

  test('a positive integer builder cap', () => {
    assert({
      given: 'a caps file naming a builder cap of 8',
      should: 'use it',
      actual: parseMachineCaps('{"builder": 8}'),
      expected: { builder: 8 },
    });
  });

  test('values a cap cannot be', () => {
    const errorOf = (text: string) => 'error' in parseMachineCaps(text);
    assert({
      given:
        'unparseable JSON, a zero, a fraction, a string, an unknown key and a non-object',
      should: 'refuse each rather than guess a capacity',
      actual: [
        errorOf('{builder: 8'),
        errorOf('{"builder": 0}'),
        errorOf('{"builder": 2.5}'),
        errorOf('{"builder": "8"}'),
        errorOf('{"builder": 8, "reviewer": 2}'),
        errorOf('[8]'),
      ],
      expected: Array(6).fill(true),
    });
  });
});

describe('agent:spawn with a machine caps file', () => {
  test('a higher machine cap admits more builders', async () => {
    const machine = fakeMachine({ builders: 3 });
    machine.files.set(capsPath(repo), '{"builder": 5}');
    const code = await spawnAgent(working(machine), spawnArgs);
    assert({
      given: '3 active builders and a machine builder cap of 5',
      should: 'spawn a 4th builder',
      actual: [code, spawned(machine.calls).length],
      expected: [0, 1],
    });
  });

  test('the machine cap still refuses once it is full', async () => {
    const machine = fakeMachine({ builders: 5 });
    machine.files.set(capsPath(repo), '{"builder": 5}');
    const code = await spawnAgent(machine.deps, spawnArgs);
    assert({
      given: '5 active builders and a machine builder cap of 5',
      should: 'refuse a 6th, naming the cap',
      actual: [
        code,
        spawned(machine.calls).length,
        machine.output.join('').includes('5 builders are active; the cap is 5'),
      ],
      expected: [1, 0, true],
    });
  });

  test('an invalid caps file', async () => {
    const machine = fakeMachine();
    machine.files.set(capsPath(repo), '{"builder": -1}');
    const code = await spawnAgent(machine.deps, spawnArgs);
    assert({
      given: 'a caps file with a negative builder cap',
      should: 'refuse to spawn and name the file',
      actual: [
        code,
        spawned(machine.calls).length,
        machine.output.join('').includes('.pu/daisy/caps.json'),
      ],
      expected: [2, 0, true],
    });
  });
});

describe('bun agent:cap', () => {
  test('the owner sets the machine builder cap', () => {
    const machine = fakeMachine({ autonomous: false });
    const code = setBuilderCap(machine.deps, ['12']);
    assert({
      given: 'the owner running bun agent:cap 12',
      should: 'write the machine caps file',
      actual: [code, machine.files.get(capsPath(repo))],
      expected: [0, '{\n  "builder": 12\n}\n'],
    });
  });

  test('an agent session', () => {
    const machine = fakeMachine({ autonomous: true });
    const code = setBuilderCap(machine.deps, ['50']);
    assert({
      given: 'an agent running bun agent:cap 50',
      should: 'refuse and leave no caps file',
      actual: [code, machine.files.has(capsPath(repo))],
      expected: [1, false],
    });
  });

  test('a value that is not a positive integer', () => {
    const machine = fakeMachine({ autonomous: false });
    const code = setBuilderCap(machine.deps, ['lots']);
    assert({
      given: 'the owner running bun agent:cap lots',
      should: 'refuse with usage and write nothing',
      actual: [code, machine.files.has(capsPath(repo))],
      expected: [2, false],
    });
  });
});
