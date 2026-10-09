import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../features/rooms/assembly.test-support';
import { AssemblyLobby } from './assembly-lobby';

setupRitewayBun();

test('Lobby renders actual Room identity and cast capacity without sample ratings', () => {
  const html = renderToStaticMarkup(
    <AssemblyLobby rooms={[assemblySnapshot]} query="" />,
  );
  assert({
    given: 'a persisted unlisted Room supplied by canonical authorization',
    should:
      'link to its durable identity and show its real host/topic and team capacity',
    actual: [
      html.includes(`/rooms/${assemblySnapshot.id}`),
      html.includes('Persisted room'),
      html.includes('Persisted debate topic'),
      html.includes('Host member'),
      html.includes('2 aff / 3 neg'),
      html.includes('/play/room'),
      html.includes('Your rating'),
    ],
    expected: [true, true, true, true, true, true, false],
  });
});

test('Lobby search filters only received rooms; empty means no visible results', () => {
  const html = renderToStaticMarkup(
    <AssemblyLobby rooms={[assemblySnapshot]} query="missing topic" />,
  );
  assert({
    given: 'a search that matches no authorized Room',
    should: 'show an empty result rather than inject sample rooms',
    actual: [
      html.includes('No rooms match your search.'),
      html.includes(`/rooms/${assemblySnapshot.id}`),
      html.includes('name="q"'),
    ],
    expected: [true, false, true],
  });
});
