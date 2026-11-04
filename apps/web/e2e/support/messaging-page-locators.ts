export const conversationPane = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
export const conversationList = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Conversations', exact: true });
export const messageComposer = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Your message', exact: true });
/** Explicit Next prefetch warms a destination without refreshing the open tree. */
export const isMessagingRefetch = (headers: Readonly<Record<string, string>>) =>
  headers.rsc !== undefined && headers['next-router-prefetch'] !== '1';

export const watchMessagingRefetches = (
  page: import('@playwright/test').Page,
) => {
  const refetches: string[] = [];
  page.on('request', (request) => {
    if (isMessagingRefetch(request.headers())) refetches.push(request.url());
  });
  return refetches;
};
