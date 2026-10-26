import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { AssemblyLobby } from './assembly-lobby';
setupRitewayBun();
const entry: RoomListEntry = {
  id: 'a'.repeat(24),
  version: 1,
  title: 'Persisted room',
  topic: 'Persisted debate topic',
  visibility: 'unlisted',
  hostActorId: 'b'.repeat(24),
  hostLabel: 'Host member',
  status: 'assembling',
  competitionType: 'casual',
  seated: true,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 2,
  waitingSince: '2026-10-09T00:00:00.000Z',
  live: null,
  hostRating: null,
};

test('Lobby renders lightweight canonical identity, live Round links and native paging', () => {
  const html = renderToStaticMarkup(
    <AssemblyLobby
      rooms={[
        {
          ...entry,
          status: 'started',
          roundRef: { id: 'c'.repeat(24), status: 'scheduled' },
        },
      ]}
      query={{ q: 'Stored motion', pageSize: 1 }}
      nextCursor={entry.id}
      activeRoom={null}
      retry={false}
    />,
  );
  assert({
    given: 'one authorized live Room page',
    should:
      'render stored facts and explicit native continuation preserving search and page budget',
    actual: [
      html.includes(`/rooms/${entry.id}`),
      html.includes('Persisted room'),
      html.includes('Persisted debate topic'),
      html.includes('Host member'),
      html.includes(`/rounds/${'c'.repeat(24)}`),
      html.includes('cursor=' + entry.id),
      html.includes('q=Stored+motion'),
      html.includes('pageSize=1'),
      html.includes('Your rating'),
    ],
    expected: [true, true, true, true, true, true, true, true, false],
  });
});
test('Lobby renders authoritative empty pages and race retry distinctly', () => {
  const results = [false, true].map((retry) =>
    renderToStaticMarkup(
      <AssemblyLobby
        rooms={[]}
        query={{ q: 'missing', pageSize: 1, cursor: entry.id }}
        nextCursor={null}
        activeRoom={null}
        retry={retry}
      />,
    ),
  );
  assert({
    given: 'an empty search and an all-masked race page',
    should:
      'show actual end or explicit same-page retry plus reset without inventing results',
    actual: results.map((html) => [
      html.includes('No rooms match your search.'),
      html.includes('Rooms changed. Retry this page.'),
      html.includes('Retry page'),
      html.includes('First page'),
      html.includes('Next page'),
    ]),
    expected: [
      [true, false, false, true, false],
      [false, true, true, true, false],
    ],
  });
});
test('Lobby names no host when the host is a hidden judge', () => {
  const html = renderToStaticMarkup(
    <AssemblyLobby
      rooms={[{ ...entry, hostActorId: null, hostLabel: null }]}
      query={{ q: '', pageSize: 1 }}
      nextCursor={null}
      activeRoom={null}
      retry={false}
    />,
  );
  assert({
    given: 'a listed Room whose host identity the server redacted',
    should: 'show its competition type without an empty host line',
    actual: [html.includes('Host:'), html.includes('casual')],
    expected: [false, true],
  });
});
test('Lobby pins the viewer’s own active Room above the listing', () => {
  const href = `/rooms/${'m'.repeat(24)}`;
  const html = renderToStaticMarkup(
    <AssemblyLobby
      rooms={[]}
      query={{ q: '', pageSize: 1 }}
      nextCursor={null}
      activeRoom={{
        version: 1,
        id: 'm'.repeat(24),
        title: 'Current room',
        phase: 'ready',
        role: 'host',
        href,
      }}
      retry={false}
    />,
  );
  assert({
    given: 'a viewer whose Room is ready to start',
    should: 'name it and link back to it',
    actual: [
      html.includes('Current room'),
      html.includes('ready to start'),
      html.includes(`href="${href}"`),
    ],
    expected: [true, true, true],
  });
});
