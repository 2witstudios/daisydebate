/**
 * The end of a decision over a closed union: reaching it means a member was
 * added without deciding what it means here. The `never` parameter fails the
 * build first; the throw is for a value that arrived unvalidated.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
};
