import {
  ballotSchemaFor,
  scoreLatticeValues,
  caseMapSchema,
  type BallotDefinition,
  type BallotSubjects,
} from '@daisy/protocol';
import { z } from 'zod';

export type JsonSchema = { [key: string]: unknown };

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
 * Length, size and numeric-range keywords are refused by some
 * schema-enforcing endpoints. A range becomes an enum, which all accept; a
 * length or an array size moves to the description the model reads. Local
 * validation still enforces the exact contract, so nothing here widens what
 * is accepted.
 */
type ScoreContext = {
  readonly scale: NonNullable<BallotDefinition['points']>['scale'];
  readonly weight: number;
};
function endpointSubset(input: JsonSchema, score?: ScoreContext): JsonSchema {
  const schema = explicitProperties(input);
  const {
    minimum,
    maximum,
    maxLength,
    maxItems,
    multipleOf,
    const: constant,
    ...rest
  } = schema;
  const subset: JsonSchema = { ...rest };
  delete subset['$schema'];
  delete subset['minLength'];
  delete subset['minItems'];
  if (constant !== undefined) subset['enum'] = [constant];
  if (typeof minimum === 'number' && typeof maximum === 'number') {
    const scale = score?.scale ?? {
      min: minimum,
      max: maximum,
      step: typeof multipleOf === 'number' ? multipleOf : 1,
    };
    const values = scoreLatticeValues(scale, score?.weight ?? 1);
    if (values) subset['enum'] = [...values];
    else
      subset['description'] =
        `From ${minimum} to ${maximum}; exact steps of ${scale.step}${score && score.weight !== 1 ? ` times ${score.weight}` : ''}, starting at ${minimum}.`;
  }
  if (typeof maxLength === 'number')
    subset['description'] = `At most ${maxLength} characters.`;
  if (typeof maxItems === 'number')
    subset['description'] = `At most ${maxItems} items.`;
  if (schema['items'] && typeof schema['items'] === 'object')
    subset['items'] = endpointSubset(schema['items'] as JsonSchema, score);
  if (schema['properties'])
    subset['properties'] = Object.fromEntries(
      Object.entries(schema['properties'] as Record<string, JsonSchema>).map(
        ([key, value]) => [key, endpointSubset(value, score)],
      ),
    );
  return subset;
}

/**
 * A ballot definition's request schema over one Round's subjects, derived
 * from the one ballot contract (`ballotSchemaFor`) so the two cannot drift.
 * Citations are optional in the contract and never requested.
 */
export const ballotWireSchemaFor = (
  definition: BallotDefinition,
  subjects: BallotSubjects,
): JsonSchema => {
  const contract = z.toJSONSchema(ballotSchemaFor(definition, subjects), {
    io: 'input',
  });
  const properties = { ...(contract['properties'] as JsonSchema) };
  delete properties['citations'];
  const wire = endpointSubset({ ...contract, properties });
  const points = definition.points;
  if (!points) return wire;
  const scoreShape = explicitProperties(properties['scores'] as JsonSchema);
  const wireProperties = wire['properties'] as Record<string, JsonSchema>;
  return {
    ...wire,
    properties: {
      ...wireProperties,
      scores: {
        ...wireProperties['scores'],
        properties: Object.fromEntries(
          Object.entries(
            scoreShape['properties'] as Record<string, JsonSchema>,
          ).map(([subject, value]) => [
            subject,
            endpointSubset(value, {
              scale: points.scale,
              weight:
                points.per === 'speech' ? (points.weights?.[subject] ?? 1) : 1,
            }),
          ]),
        ),
      },
    },
  };
};

/** The case map's request schema, derived from its contract the same way. */
export const caseMapWireSchema: JsonSchema = endpointSubset(
  z.toJSONSchema(caseMapSchema, { io: 'input' }),
);

/** Recorded on every attempt: bump when a prompt or wire schema changes. */
export const judgeContractVersion = 'judge-contract@3';
