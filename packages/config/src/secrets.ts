import { z } from 'zod';

/**
 * Fields whose value is a credential or carries one (a password inside a
 * connection URL). Marked where each field is declared, so the list of
 * secret keys is derived from the schemas rather than kept by hand.
 */
const secrets = z.registry<{ readonly secret: true }>();
export const secret = <Schema extends z.ZodType>(schema: Schema): Schema => {
  secrets.add(schema, { secret: true });
  return schema;
};

const unwrapOptional = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodOptional
    ? unwrapOptional(schema.unwrap() as z.ZodType)
    : schema;

/** The keys of `fields` marked with `secret`, each once. */
export const secretKeysOf = (
  fields: Readonly<Record<string, z.ZodType>>,
): readonly string[] => [
  ...new Set(
    Object.entries(fields)
      .filter(([, schema]) => secrets.has(unwrapOptional(schema)))
      .map(([key]) => key),
  ),
];
