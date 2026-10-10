import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createConnectionDiagnostics,
  type ConnectionDiagnostic,
} from './connection-diagnostics';
import { harness, flush } from './connection-store.test-support';
setupRitewayBun();
for (const phase of ['ticket', 'hello'] as const)
  test(`connection diagnosis isolates ${phase} failure`, async () => {
    const h = harness(
      phase === 'ticket'
        ? {
            fetchTicket: async () => {
              throw new TypeError('private credential-bearing message');
            },
          }
        : {},
    );
    const events: ConnectionDiagnostic[] = [];
    h.store.onDiagnostic((event) => events.push(event));
    h.store.connect();
    if (phase === 'hello')
      h.latestSocket().send = () => {
        throw new TypeError('private credential-bearing message');
      };
    h.latestSocket().open();
    await flush();
    await flush();
    assert({
      given: 'a failing ticket read or hello send',
      should:
        'identify only the safe phase and error class, with no private message',
      actual: events,
      expected:
        phase === 'ticket'
          ? [{ generation: 1, phase: 'ticket-failed', errorName: 'TypeError' }]
          : [
              { generation: 1, phase: 'ticket-resolved' },
              { generation: 1, phase: 'hello-failed', errorName: 'TypeError' },
            ],
    });
  });
test('diagnostic listeners cannot interfere with transport or expose arbitrary error names', () => {
  const diagnostics = createConnectionDiagnostics();
  const events: ConnectionDiagnostic[] = [];
  diagnostics.subscribe(() => {
    throw new Error('private');
  });
  diagnostics.subscribe((event) => events.push(event));
  const error = new Error('private');
  error.name = 'credential';
  diagnostics.emit(2, 'hello-failed', error);
  assert({
    given: 'an arbitrary error name and a throwing observer',
    should: 'retain only a fixed unknown class and continue healthy observers',
    actual: events,
    expected: [
      { generation: 2, phase: 'hello-failed', errorName: 'UnknownError' },
    ],
  });
});
