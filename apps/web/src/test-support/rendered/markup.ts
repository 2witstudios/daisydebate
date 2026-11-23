import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

/**
 * Test support for markup contracts only: the raw server-rendered HTML, for
 * a test whose subject is the markup itself (a head tag, an email body, a
 * design-system class contract). Only tests under
 * `apps/web/src/markup-contracts/` import it; every other component test
 * reads its output by role and name through `./accessible`.
 */
export const renderMarkup = (node: ReactNode): string =>
  renderToStaticMarkup(node);
