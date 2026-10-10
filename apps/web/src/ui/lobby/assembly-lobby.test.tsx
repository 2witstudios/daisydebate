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
  length: 'full',
  seated: true,
  roundRef: null,
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
