import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LobbyPreview } from './lobby-preview';
import { WatchPreview } from './watch-preview';

setupRitewayBun();

describe('the Watch and Lobby previews', () => {
  test('invent no audience', () => {
    const says = (html: string) => /\bwatching\b/i.test(html);
    assert({
      given: 'the previews shown before Watch opens',
      should: 'show no count of people watching',
      actual: [
        says(renderToStaticMarkup(<WatchPreview />)),
        says(renderToStaticMarkup(<LobbyPreview />)),
      ],
      expected: [false, false],
    });
  });
});
