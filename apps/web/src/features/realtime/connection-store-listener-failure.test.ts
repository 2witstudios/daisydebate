import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { harness, flush, validTicket } from './connection-store.test-support';

setupRitewayBun();

/** A store with one subscriber that throws when told the handshake began. */
const withThrowingSubscriber = (
  overrides: Parameters<typeof harness>[0] = {},
) => {
  const h = harness(overrides);
  const diagnostics: string[] = [];
  h.store.onDiagnostic((event) => diagnostics.push(event.phase));
  h.store.subscribe((state) => {
    if (state.status === 'handshaking') throw new Error('subscriber failed');
  });
  const outcome = () => {
    const socket = h.latestSocket();
    const before = h.store.getState().status;
    socket.message({ v: ENVELOPE_VERSION, type: 'ready' });
    return {
      diagnostics,
      sockets: h.sockets.length,
      closed: socket.closedWith,
      status: [before, h.store.getState().status],
    };
  };
  return { ...h, outcome };
};

const healthy = {
  diagnostics: ['ticket-resolved', 'hello-sent'],
  sockets: 1,
  closed: null,
  status: ['handshaking', 'open'],
};

test('a subscriber that throws on the handshake notice does not fail the hello', async () => {
  const h = withThrowingSubscriber();
  h.store.connect();
  await flush();
  let thrown: unknown = null;
  try {
    h.latestSocket().open();
  } catch (error) {
    thrown = error;
  }
  assert({
    given:
      'a ticket in hand, the socket opening, and a subscriber that throws when told the handshake began',
    should:
      'leave the failure with the subscriber: the hello is sent once, the socket stays open and becomes ready',
    actual: [(thrown as Error | null)?.message, h.outcome()],
    expected: ['subscriber failed', healthy],
  });
  h.store.dispose();
});

/**
 * A ticket the test hands over itself. Its continuations run inside
 * `resolve`, so what one of them throws reaches the test rather than the
 * runner's unhandled-rejection trap.
 */
const ticketInHand = () => {
  const steps: ((value: unknown) => unknown)[] = [];
  const chain = {
    then(step: (value: unknown) => unknown) {
      steps.push(step);
      return chain;
    },
  };
  return {
    promise: chain as unknown as Promise<string>,
    resolve: (ticket: string) =>
      steps.reduce<unknown>((value, step) => step(value), ticket),
  };
};

test('a subscriber that throws on the handshake notice does not fail the ticket', () => {
  const ticket = ticketInHand();
  const h = withThrowingSubscriber({ fetchTicket: () => ticket.promise });
  h.store.connect();
  h.latestSocket().open();
  let thrown: unknown = null;
  try {
    ticket.resolve(validTicket);
  } catch (error) {
    thrown = error;
  }
  assert({
    given:
      'an open socket, the ticket arriving after it, and a subscriber that throws when told the handshake began',
    should:
      'leave the failure with the subscriber: no ticket or hello failure is diagnosed and the socket stays open and becomes ready',
    actual: [(thrown as Error | null)?.message, h.outcome()],
    expected: ['subscriber failed', healthy],
  });
  h.store.dispose();
});
