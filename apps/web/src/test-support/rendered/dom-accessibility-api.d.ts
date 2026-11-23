/**
 * The one function of `dom-accessibility-api` the role helper uses: the
 * accname computation `@testing-library/dom` matches names with, from the
 * same installed copy, so a listed name is the name a query matches. Its
 * 0.5 line ships `dist/index.d.ts` but no `types` export condition, so
 * TypeScript cannot reach it through the package's exports.
 */
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(
    root: Element,
    options?: {
      readonly hidden?: boolean;
      readonly getComputedStyle?: (element: Element) => CSSStyleDeclaration;
      readonly computedStyleSupportsPseudoElements?: boolean;
    },
  ): string;
}
