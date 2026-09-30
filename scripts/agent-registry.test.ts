import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseRecord,
  readRegistration,
  recordPath,
  serializeRecord,
} from './agent-registry';

setupRitewayBun();

describe('agent registry', () => {
  test('keeps each record under the project root, outside every worktree', () => {
    assert({
      given: 'the project root and a child agent id',
      should: 'use .pu/daisy/agents/<id>.json there',
      actual: recordPath('/repo', 'ag-child'),
      expected: '/repo/.pu/daisy/agents/ag-child.json',
    });
  });

  test('refuses ids that could leave the registry directory', () => {
    assert({
      given: 'a path-like id',
      should: 'throw',
      actual: (() => {
        try {
          return recordPath('/repo', '../../x');
        } catch (error) {
          return (error as Error).message;
        }
      })(),
      expected: 'Invalid agent id "../../x"',
    });
  });

  test('round-trips a record and rejects malformed ones', () => {
    const record = {
      parent: 'ag-parent',
      role: 'builder' as const,
      worktree: '/w',
    };
    assert({
      given: 'a serialized record, an owner-spawned record and garbage',
      should: 'parse the first two and reject the last',
      actual: [
        parseRecord(serializeRecord(record)),
        parseRecord(serializeRecord({ ...record, parent: null })),
        parseRecord('{"parent":1}'),
        parseRecord('not json'),
      ],
      expected: [record, { ...record, parent: null }, undefined, undefined],
    });
  });
});

describe('registration lookup', () => {
  const record = JSON.stringify({
    parent: null,
    role: 'builder',
    worktree: '/repo/.pu/worktrees/wt-a',
  });
  const reads = (files: Record<string, string>) => (path: string) => {
    if (path in files) return files[path];
    return undefined;
  };
  const throws = () => {
    throw new Error('EACCES');
  };

  test('reads the main checkout registry and fails closed on doubt', () => {
    assert({
      given:
        'a valid record, no record, a malformed record, an unreadable registry and an id that is no file name',
      should:
        'call the record registered, the absent one absent, and the rest unreadable',
      actual: [
        readRegistration(
          '/repo',
          'ag-a',
          reads({ '/repo/.pu/daisy/agents/ag-a.json': record }),
        ),
        readRegistration('/repo', 'ag-a', reads({})),
        readRegistration(
          '/repo',
          'ag-a',
          reads({ '/repo/.pu/daisy/agents/ag-a.json': '{not json' }),
        ),
        readRegistration('/repo', 'ag-a', throws),
        readRegistration('/repo', '../ag-a', reads({})),
      ],
      expected: [
        'registered',
        'absent',
        'unreadable',
        'unreadable',
        'unreadable',
      ],
    });
  });

  test('does not look in the worktree', () => {
    assert({
      given: 'a record only in a worktree copy of the registry',
      should: 'still be absent from the main checkout',
      actual: readRegistration(
        '/repo',
        'ag-a',
        reads({
          '/repo/.pu/worktrees/wt-a/.pu/daisy/agents/ag-a.json': record,
        }),
      ),
      expected: 'absent',
    });
  });
});
