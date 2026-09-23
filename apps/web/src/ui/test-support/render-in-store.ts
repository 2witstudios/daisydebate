import { renderToString } from 'react-dom/server';
import { createElement as h, type ReactNode } from 'react';
import { createInitialState, type UiState } from '../store/state';
import { UiStoreProvider } from '../store/store';

/** Test support: the server render of `children` inside a UI store. */
export const renderInStore = (
  children: ReactNode,
  initialState: UiState = createInitialState(),
): string => renderToString(h(UiStoreProvider, { initialState, children }));

/** How many times `needle` appears in rendered HTML. */
export const occurrences = (html: string, needle: string): number =>
  html.split(needle).length - 1;
