export const conversationPane = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
export const conversationList = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Conversations', exact: true });
export const messageComposer = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Your message', exact: true });
export const watchMessagingRefetches = (
  page: import('@playwright/test').Page,
) => {
  const refetches: string[] = [];
  page.on('request', (request) => {
    if (request.headers().rsc !== undefined) refetches.push(request.url());
  });
  return refetches;
};
