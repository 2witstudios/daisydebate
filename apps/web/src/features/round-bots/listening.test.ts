import { assert, setupRitewayBun, test } from 'riteway/bun';
import { latePeer, peer, scope, session } from './listening.test-support';

setupRitewayBun();

test('the bot hears its peers through its own listen-only grant, with no capture worker in the path (ISSUE-764)', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  s.speak(['peer-identity', 'other-identity']);
  assert({
    given:
      'a cross-ex seat that joins, then 200 ms of loud audio from its peer and from a seat that is not its peer',
    should:
      "join with the claim's own listen grant, subscribe only its peer, and start that peer's turn",
    actual: {
      grants: s.grants,
      identities: s.subscriptions[0]!.identities,
      token: s.subscriptions[0]!.token,
      events: s.events,
    },
    expected: {
      grants: [{ grantScope: scope, token: 'claim-token' }],
      identities: ['peer-identity'],
      token: 'listen-1',
      events: [`speech-start:${peer}`],
    },
  });
});

test('a closed track or a silent peer reads as unknown, never silence', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  s.subscriptions[0]!.frame('peer-identity', 0, 8000);
  s.subscriptions[0]!.trackClosed('peer-identity');
  assert({
    given: "a peer's track closing",
    should: 'report that peer unknown',
    actual: s.events,
    expected: [`unknown:${peer}`],
  });
});

test('the hearing ends with the claim, even while a join is in flight', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.close();
  await s.listening.poll();
  const late = session();
  late.listening.start();
  const closing = late.listening.close();
  await late.joined();
  await closing;
  assert({
    given:
      'a joined hearing closed with its claim, and one closed before its join landed',
    should: 'close both subscriptions and never rejoin',
    actual: [
      s.subscriptions.map((sub) => sub.closed),
      late.subscriptions.map((sub) => sub.closed),
    ],
    expected: [[true], [true]],
  });
});

test('a peer whose media binds after the bot joined is heard once it binds', async () => {
  let latePeerBound = false;
  const s = session({
    readPeers: async () =>
      latePeerBound
        ? [
            { participantId: peer, identity: 'peer-identity' },
            { participantId: latePeer, identity: 'late-identity' },
          ]
        : [{ participantId: peer, identity: 'peer-identity' }],
    peers: [peer, latePeer],
    grantPeers: [{ participantId: peer, identity: 'peer-identity' }],
  });
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  latePeerBound = true;
  s.advance(1000);
  await s.listening.poll();
  s.speak(['late-identity']);
  assert({
    given:
      'a cross-ex peer with no media binding at join, who binds a second later and speaks',
    should: 'subscribe them on the next refresh and hear their turn start',
    actual: {
      identities: s.subscriptions[0]!.identities,
      events: s.events,
    },
    expected: {
      identities: ['peer-identity', 'late-identity'],
      events: [`speech-start:${latePeer}`],
    },
  });
});
