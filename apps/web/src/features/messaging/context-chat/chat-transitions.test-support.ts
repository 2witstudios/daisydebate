const ENTER = 'discovering | discover';
const LEAVE_TO_ENTER = 'discovering | stop-watching-expiry, discover';
const OPEN = 'ready, first page on its way | watch-expiry, read-latest';
const DENIED = 'denied, forms kept | stop-watching-expiry';

/**
 * What every event does in every shape of standing. An event not listed for a state is
 * rejected: that state object back, and nothing asked. Read this as the specification:
 * a change here is a change of behaviour.
 */
export const TRANSITIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  idle: { 'enter-requested': ENTER },
  discovering: {
    'discovered a channel': OPEN,
    'discovered none': 'opening | open',
    'entry-refused denied': 'denied',
    'entry-refused failed': 'unavailable',
  },
  'discovering, may not open': {
    'discovered a channel': OPEN,
    'discovered none': 'empty',
    'entry-refused denied': 'denied',
    'entry-refused failed': 'unavailable',
  },
  opening: {
    opened: OPEN,
    'entry-refused denied': 'denied',
    'entry-refused failed': 'unavailable',
  },
  empty: {
    'enter-requested': ENTER,
    'opening-check-requested': 'empty, checking | discover',
  },
  'empty, checking': {
    'enter-requested': ENTER,
    'discovered a channel': OPEN,
    'discovered none': 'empty',
    'entry-refused denied': 'denied',
    'entry-refused failed': 'empty',
  },
  unavailable: { 'enter-requested': ENTER },
  denied: { 'enter-requested': ENTER },
  'denied after reading': { 'enter-requested': ENTER },
  'ready, first page on its way': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready, first page on its way | read-latest',
    'latest-read': 'ready',
    'latest-read closed, expiring later': 'ready, read-only | watch-expiry',
    'read-refused latest denied': DENIED,
    'read-refused latest failed': 'ready, no page, a read failed',
    'chat-hidden': 'ready, no page, hidden',
    'messages-shown': 'ready, first page on its way, marking read | mark-read',
    'expiry-reached': 'ready, first page on its way, expired',
  },
  'ready, no page, a read failed': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested':
      'ready, first page on its way, a read failed | read-latest',
    'chat-hidden': 'ready, no page, hidden, a read failed',
    'messages-shown': 'ready, no page, a read failed, marking read | mark-read',
    'expiry-reached': 'ready, no page, expired, a read failed',
  },
  'ready, no page, hidden': {
    'enter-requested': LEAVE_TO_ENTER,
    'chat-shown': 'ready, first page on its way | read-latest',
    'expiry-reached': 'ready, no page, hidden, expired',
  },
  ready: {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready | read-latest',
    'older-requested': 'ready, older page on its way | read-older',
    'chat-hidden': 'ready, hidden',
    'messages-shown': 'ready, marking read | mark-read',
    'expiry-reached': 'ready, expired',
  },
  'ready, hidden': {
    'enter-requested': LEAVE_TO_ENTER,
    'chat-shown': 'ready | read-latest',
    'expiry-reached': 'ready, hidden, expired',
  },
  'ready, refreshing': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready | read-latest',
    'older-requested': 'ready, older page on its way | read-older',
    'latest-read': 'ready',
    'latest-read closed, expiring later': 'ready, read-only | watch-expiry',
    'read-refused latest denied': DENIED,
    'read-refused latest failed': 'ready, a read failed',
    'chat-hidden': 'ready, hidden',
    'messages-shown': 'ready, marking read | mark-read',
    'expiry-reached': 'ready, expired',
  },
  'ready, older page on its way': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready, older page on its way | read-latest',
    'older-requested': 'ready, older page on its way | read-older',
    'older-read': 'ready, older pages',
    'read-refused older denied': DENIED,
    'read-refused older failed': 'ready, a read failed',
    'chat-hidden': 'ready, hidden',
    'messages-shown': 'ready, older page on its way, marking read | mark-read',
    'expiry-reached': 'ready, expired, older page on its way',
  },
  'ready, a read failed': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready, a read failed | read-latest',
    'older-requested':
      'ready, a read failed, older page on its way | read-older',
    'chat-hidden': 'ready, hidden, a read failed',
    'messages-shown': 'ready, a read failed, marking read | mark-read',
    'expiry-reached': 'ready, expired, a read failed',
  },
  'ready, marking read': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready, marking read | read-latest',
    'older-requested':
      'ready, older page on its way, marking read | read-older',
    'chat-hidden': 'ready, hidden',
    'messages-shown': 'ready, marking read | mark-read',
    'read-marked': 'ready',
    'read-mark-failed': 'ready',
    'expiry-reached': 'ready, expired, marking read',
  },
  'ready, expired': {
    'enter-requested': LEAVE_TO_ENTER,
    'refresh-requested': 'ready, expired | read-latest',
    'older-requested': 'ready, expired, older page on its way | read-older',
    'chat-hidden': 'ready, hidden, expired',
    'messages-shown': 'ready, expired, marking read | mark-read',
  },
};
