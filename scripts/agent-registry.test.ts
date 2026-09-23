import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseRecord, recordPath, serializeRecord } from './agent-registry';

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
