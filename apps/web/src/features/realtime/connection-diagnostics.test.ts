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

for (const error of [new ReferenceError('private'), new EvalError('private')])
  test(`native ${error.name} remains a safe diagnostic class`, () => {
    const diagnostics = createConnectionDiagnostics();
    const events: ConnectionDiagnostic[] = [];
    diagnostics.subscribe((event) => events.push(event));
    diagnostics.emit(3, 'ticket-failed', error);
    assert({
      given: 'a native browser runtime or evaluation exception',
      should: 'preserve its fixed class without message or stack',
      actual: events,
      expected: [
        { generation: 3, phase: 'ticket-failed', errorName: error.name },
      ],
    });
  });

for (const name of [
  'RealtimeTicketFetchError',
  'RealtimeTicketBodyError',
  'RealtimeTicketSchemaObjectError',
  'RealtimeTicketSchemaTicketError',
  'RealtimeTicketSchemaSocketUrlError',
  'RealtimeTicketSchemaThrownEvalError',
  'RealtimeTicketSchemaThrownReferenceError',
  'RealtimeTicketSchemaThrownTypeError',
  'RealtimeTicketSchemaThrownUnknownError',
  'RealtimeTicketEndpointError',
])
  test(`canonical reader stage ${name} is content-free`, () => {
    const diagnostics = createConnectionDiagnostics();
    const events: ConnectionDiagnostic[] = [];
    diagnostics.subscribe((event) => events.push(event));
    const error = new Error('private body or endpoint');
    error.name = name;
    diagnostics.emit(4, 'ticket-failed', error);
    assert({
      given: 'the owned ticket reader fixed failure name',
      should:
        'expose only its declared stage and no private body, message or URL',
      actual: events,
      expected: [{ generation: 4, phase: 'ticket-failed', errorName: name }],
    });
  });
