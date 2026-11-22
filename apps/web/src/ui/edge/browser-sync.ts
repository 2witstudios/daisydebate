'use client';

// Keep dependency checking at each caller for both passive and layout work.
export {
  useEffect as useBrowserEffect,
  useLayoutEffect as useBrowserLayoutEffect,
} from 'react';
