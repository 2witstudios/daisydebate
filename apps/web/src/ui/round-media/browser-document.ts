/** The URL this document was loaded as, and a document load to replace it. */
export const browserDocument = () => ({
  url: performance.getEntriesByType('navigation')[0]?.name,
  replace: (href: string) => window.location.replace(href),
});
