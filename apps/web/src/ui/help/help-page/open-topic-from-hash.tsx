'use client';

import { useEffect } from 'react';
import { topicFromHash } from './topic-from-hash';

/**
 * Opens the answer a link to `/help#topic` names. A fragment that targets a
 * disclosure's summary leaves it shut, and a client navigation only scrolls,
 * so the page opens it itself: on arrival, on a hash change, and after any
 * click, since Next changes the hash of a same-page link through
 * `history.pushState`, which fires no `hashchange`. Without JavaScript the
 * link still lands on its question.
 */
export function OpenTopicFromHash({
  topicIds,
}: {
  readonly topicIds: readonly string[];
}) {
  useEffect(() => {
    const open = () => {
      const id = topicFromHash(window.location.hash, topicIds);
      const details = id
        ? document.getElementById(id)?.closest('details')
        : null;
      if (details) details.open = true;
    };
    // After the click's own navigation has updated the address.
    const afterClick = () => window.setTimeout(open, 0);
    open();
    window.addEventListener('hashchange', open);
    document.addEventListener('click', afterClick);
    return () => {
      window.removeEventListener('hashchange', open);
      document.removeEventListener('click', afterClick);
    };
  }, [topicIds]);
  return null;
}
