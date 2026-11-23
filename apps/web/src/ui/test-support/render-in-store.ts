import { createElement as h, type ReactNode } from 'react';
import { createInitialState } from '../store/state';
import { UiStoreProvider } from '../store/store';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';

/** Test support: the server render of `children` inside a UI store, read by role and name. */
export const renderInStore = (children: ReactNode): AccessibleView =>
  renderAccessible(
    h(UiStoreProvider, { initialState: createInitialState(), children }),
  );
