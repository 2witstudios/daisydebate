import { ballotSchema } from '@daisy/protocol';
import { z } from 'zod';

type JsonSchema = { [key: string]: unknown };

/** A record keyed by an enum, as explicit required fields a strict endpoint can enforce. */
function explicitProperties(schema: JsonSchema): JsonSchema {
  const { propertyNames, additionalProperties, ...rest } = schema;
  const keys = (propertyNames as { enum?: readonly string[] } | undefined)
    ?.enum;
  if (!keys || typeof additionalProperties !== 'object') return schema;
  return {
    ...rest,
    properties: Object.fromEntries(
      keys.map((key) => [key, additionalProperties]),
    ),
    required: [...keys],
    additionalProperties: false,
  };
}

/**
 * Length and numeric-range keywords are refused by some schema-enforcing
 * endpoints. A range becomes an enum, which all accept; a length moves to the
 * description the model reads. Local validation still enforces the exact
 * contract, so nothing here widens what is accepted.
 */
function endpointSubset(input: JsonSchema): JsonSchema {
  const schema = explicitProperties(input);
  const { minimum, maximum, maxLength, const: constant, ...rest } = schema;
  const subset: JsonSchema = { ...rest };
  delete subset['$schema'];
  delete subset['minLength'];
  if (constant !== undefined) subset['enum'] = [constant];
  if (typeof minimum === 'number' && typeof maximum === 'number') {
    subset['enum'] = Array.from(
      { length: maximum - minimum + 1 },
      (_, offset) => minimum + offset,
    );
  }
  if (typeof maxLength === 'number')
    subset['description'] = `At most ${maxLength} characters.`;
  if (schema['properties'])
    subset['properties'] = Object.fromEntries(
      Object.entries(schema['properties'] as Record<string, JsonSchema>).map(
        ([key, value]) => [key, endpointSubset(value)],
      ),
    );
  return subset;
}

/**
 * The request's output schema, derived from the one ballot contract so the two
 * cannot drift. Citations are optional in the contract and never requested.
 */
export const ballotWireSchema: JsonSchema = endpointSubset(
  z.toJSONSchema(ballotSchema.omit({ citations: true }), { io: 'input' }),
);

/** Recorded on every attempt: bump when the prompt or wire schema changes. */
export const judgeContractVersion = 'judge-contract@1';
