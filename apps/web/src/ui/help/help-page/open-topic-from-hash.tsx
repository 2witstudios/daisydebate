'use client';

import { useBrowserEffect } from '../../edge/browser-sync';

import { topicFromHash } from './topic-from-hash';

/**
 * Opens the answer a link to `/help#topic` names. A fragment that targets a
 * disclosure's summary leaves it shut, and a client navigation only scrolls,
 * so the page opens it itself: on arrival and on a hash change. It never
 * reopens an answer the member closed. Before hydration the link still
 * lands on its question.
 */
export function OpenTopicFromHash({
  topicIds,
}: {
  readonly topicIds: readonly string[];
}) {
  useBrowserEffect(() => {
    const open = () => {
      const id = topicFromHash(window.location.hash, topicIds);
      const details = id
        ? document.getElementById(id)?.closest('details')
        : null;
      if (details) details.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [topicIds]);
  return null;
}
