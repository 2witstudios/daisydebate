/**
 * A role's seniority as the evaluator compares it, where a greater number
 * outranks a lesser one. A stored rank counts the other way (1 is the
 * highest), so seniority is its negation; the two orders never mix.
 */
export const roleSeniority = (rank: number): number => -rank;
