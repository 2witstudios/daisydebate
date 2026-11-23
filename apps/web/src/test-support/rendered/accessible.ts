import {
  queryAllByRole,
  type ByRoleMatcher,
  type ByRoleOptions,
} from '@testing-library/dom';
import { computeAccessibleName } from 'dom-accessibility-api';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

/**
 * Test support: rendered output read the way assistive technology reads it.
 * A component test asks for a role and an accessible name ("the button named
 * Save", "the dialog named Report ada", "the status that says Saved") rather
 * than matching tags, attribute order or class strings in the HTML.
 *
 * Roles and names follow the WAI-ARIA and accname rules as
 * `@testing-library/dom` implements them (`aria-query` for implicit roles,
 * `dom-accessibility-api` for names): role from the element and its
 * attributes, name from `aria-labelledby`, `aria-label`, a `<label>`, `alt`,
 * `title` or the text inside. Hidden subtrees (`hidden`, `aria-hidden`,
 * `display: none` inline) are not in the tree unless asked for.
 *
 * Every single-element question fails loudly when nothing matches or when two
 * elements match the same role and name: a name that is not unique is a
 * defect in the page or the test, never a coin toss.
 */

type Role = ByRoleMatcher;
/** An exact accessible name, or a pattern when the name carries live values. */
type Name = string | RegExp;
/** The states a role query may also ask for (`checked`, `pressed`, `expanded`, `level`, …). */
type States = Omit<ByRoleOptions, 'name' | 'queryFallbacks'>;

/**
 * Each read gets a document of its own, so ids (`aria-labelledby`, `label
 * for`) resolve within that output alone and a view read earlier stays whole
 * after the next render.
 */
const mount = (html: string): HTMLElement => {
  const { document } = new Window({
    url: 'https://daisy.test/',
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      navigation: { disableMainFrameNavigation: true },
    },
  });
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  return container as unknown as HTMLElement;
};

const describe = (role: Role, name: Name | undefined, states: States) => {
  const wanted = [
    `role ${String(role)}`,
    name === undefined ? null : `named ${String(name)}`,
    Object.keys(states).length > 0 ? JSON.stringify(states) : null,
  ].filter((part) => part !== null);
  return wanted.join(' ');
};

/**
 * The accessible name. Asked about hidden elements, it reads hidden content
 * too (accname step 2A skipped), so a closed dialog is named by its title.
 */
const nameOf = (element: Element, hidden = false) =>
  computeAccessibleName(element, { hidden });

const named = (element: Element, name: Name, hidden: boolean) => {
  const actual = nameOf(element, hidden);
  return typeof name === 'string' ? actual === name : name.test(actual);
};

/** What the page offers for that role, for the failure message. */
const offered = (container: HTMLElement, role: Role, states: States) => {
  const names = queryAllByRole(container, role, states).map(
    (element) => `"${nameOf(element, states.hidden === true)}"`,
  );
  return names.length === 0
    ? `nothing has role ${String(role)}`
    : `role ${String(role)} has ${names.join(', ')}`;
};

export type AccessibleView = {
  /** Every element with this role (and name, and states), in document order. */
  readonly all: (
    role: Role,
    name?: Name,
    states?: States,
  ) => readonly Element[];
  /** The one element with this role and name; throws on none or several. */
  readonly get: (role: Role, name?: Name, states?: States) => Element;
  /** Whether exactly one element has this role and name; throws on several. */
  readonly has: (role: Role, name?: Name, states?: States) => boolean;
  /** How many elements have this role (and name). */
  readonly count: (role: Role, name?: Name, states?: States) => number;
  /** The accessible names of every element with this role, in order. */
  readonly names: (role: Role, states?: States) => readonly string[];
  /** The visible text of the one element with this role and name, whitespace collapsed. */
  readonly text: (role: Role, name?: Name, states?: States) => string;
  /** The one element's attribute, or null when it has none. */
  readonly attribute: (
    role: Role,
    name: Name | undefined,
    attribute: string,
    states?: States,
  ) => string | null;
  /** A view of one element's subtree: "the button named Save inside the dialog named Report". */
  readonly within: (role: Role, name?: Name, states?: States) => AccessibleView;
  /** All of the output's visible text, whitespace collapsed. */
  readonly textContent: () => string;
};

const collapse = (text: string | null) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

const viewOf = (container: HTMLElement): AccessibleView => {
  const all = (role: Role, name?: Name, states: States = {}) => {
    const found = queryAllByRole(container, role, states);
    return name === undefined
      ? found
      : found.filter((element) => named(element, name, states.hidden === true));
  };
  const get = (role: Role, name?: Name, states: States = {}) => {
    const found = all(role, name, states);
    if (found.length === 1) return found[0]!;
    const wanted = describe(role, name, states);
    if (found.length === 0)
      throw new Error(
        `No element with ${wanted}; ${offered(container, role, states)}`,
      );
    throw new Error(
      `${found.length} elements with ${wanted}; a role and name must pick one`,
    );
  };
  const has = (role: Role, name?: Name, states: States = {}) => {
    const found = all(role, name, states);
    if (found.length > 1)
      throw new Error(
        `${found.length} elements with ${describe(role, name, states)}; a role and name must pick one`,
      );
    return found.length === 1;
  };
  return {
    all,
    get,
    has,
    count: (role, name, states) => all(role, name, states).length,
    names: (role, states = {}) =>
      all(role, undefined, states).map((element) =>
        nameOf(element, states.hidden === true),
      ),
    text: (role, name, states) => collapse(get(role, name, states).textContent),
    attribute: (role, name, attribute, states) =>
      get(role, name, states).getAttribute(attribute),
    within: (role, name, states) => viewOf(get(role, name, states)),
    textContent: () => collapse(container.textContent),
  };
};

/** Reads rendered HTML (from `renderToString` or `renderToStaticMarkup`) by role and name. */
export const accessible = (html: string): AccessibleView => viewOf(mount(html));

/** Renders an element on the server and reads it by role and name. */
export const renderAccessible = (node: ReactNode): AccessibleView =>
  accessible(renderToStaticMarkup(node));

/** Reads a live element (a mounted test's container) by role and name. */
export const accessibleWithin = (element: Element): AccessibleView =>
  viewOf(element as HTMLElement);
