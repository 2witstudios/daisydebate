import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { clientEntriesToMedia } from './media-href-scan.test-support';

setupRitewayBun();

const judge = {
  file: 'features/judge/get-assigned.ts',
  text: "export const f = (a) => ({\n  followHref: `/rounds/${a.id}${a.status === 'active' ? '/room' : ''}`,\n});",
};
const lobby = {
  file: 'features/lobby/actions.ts',
  text: 'export const roomHref = (roomId: string): string => `/rooms/${roomId}`;',
};
const tournament = {
  file: 'features/tournaments/room.ts',
  text: 'export const roomHref = (id: string): string => `/tournaments/${id}/room`;',
};
const page = (text: string) => ({ file: 'ui/page.tsx', text });

describe('clientEntriesToMedia', () => {
  test('a next/link to a computed media href', () => {
    assert({
      given: 'a next/link whose href is a property built as a media href',
      should: 'name it',
      actual: clientEntriesToMedia([
        judge,
        page(
          '<Link\n  href={debate.followHref}\n  className={cn(a, b)}\n>\n  Follow\n</Link>',
        ),
      ]),
      expected: ['ui/page.tsx: <Link href={debate.followHref}>'],
    });
  });

  test('a next/link to an imported media href builder', () => {
    assert({
      given: 'a next/link calling the media roomHref it imports',
      should: 'name it',
      actual: clientEntriesToMedia([
        lobby,
        tournament,
        page(
          "import { roomHref } from '../features/lobby/actions';\n<Link href={roomHref(room.id)}>Room</Link>",
        ),
      ]),
      expected: ['ui/page.tsx: <Link href={roomHref(room.id)}>'],
    });
  });

  test('a same-named builder that is not a media href', () => {
    assert({
      given: "a next/link calling the tournaments' own roomHref",
      should: 'not name it: the import resolves to a non-media builder',
      actual: clientEntriesToMedia([
        lobby,
        tournament,
        page(
          "import { roomHref } from '../features/tournaments/room';\n<Link href={roomHref(t.id)}>Room</Link>",
        ),
      ]),
      expected: [],
    });
  });

  test('literal media hrefs, including a conditional segment', () => {
    assert({
      given: 'next/link and router calls with literal media hrefs',
      should: 'name each',
      actual: clientEntriesToMedia([
        page(
          "<Link href={`/rooms/${id}`}>a</Link>\n<Link href={`/rounds/${id}${live ? '/room' : ''}`}>b</Link>\nrouter.push(`/rounds/${id}/room`);",
        ),
      ]),
      expected: [
        'ui/page.tsx: <Link href={`/rooms/${id}`}>',
        "ui/page.tsx: <Link href={`/rounds/${id}${live ? '/room' : ''}`}>",
        'ui/page.tsx: router.push(`/rounds/${id}/room`)',
      ],
    });
  });

  test('entries that are not client-side navigations into media pages', () => {
    assert({
      given:
        'MediaPageLink to a computed media href, a generic href property, a local media const used by an anchor, and non-media links',
      should: 'name nothing',
      actual: clientEntriesToMedia([
        judge,
        page(
          'const href = `/rooms/${roomId}`;\n<a href={href}>Room</a>\n<MediaPageLink href={debate.followHref}>Follow</MediaPageLink>\n<Link href={card.href}>Card</Link>\n<Link href={`/rooms/${id}/rematch`}>Rematch</Link>\n<Link href="/lobby">Lobby</Link>\nrouter.replace(next);',
        ),
      ]),
      expected: [],
    });
  });

  test('a local media const used by a next/link', () => {
    assert({
      given: 'a next/link whose href is a media const declared in its file',
      should: 'name it',
      actual: clientEntriesToMedia([
        page(
          'const here = `/rounds/${id}/room`;\n<Link href={here}>Stay</Link>',
        ),
      ]),
      expected: ['ui/page.tsx: <Link href={here}>'],
    });
  });
});
