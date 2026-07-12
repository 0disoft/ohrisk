export type JsonSchema = boolean | Record<string, unknown>;

export type JsonSchemaValidationError = {
  instancePath: string;
  schemaPath: string;
  message: string;
};

type ValidationInput = {
  schema: JsonSchema;
  documentSchema: JsonSchema;
  documentIdentifier: string;
  value: unknown;
  instancePath: string;
  schemaPath: string;
};

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "anyOf",
  "allOf",
  "oneOf",
  "not",
  "dependentRequired"
]);

export class JsonSchemaRegistry {
  readonly #schemas = new Map<string, JsonSchema>();

  constructor(schemas: JsonSchema[]) {
    for (const schema of schemas) {
      if (typeof schema === "boolean") {
        continue;
      }
      const identifier = schema.$id;
      if (typeof identifier !== "string" || identifier.length === 0) {
        throw new Error("Every registered JSON Schema must declare a non-empty $id.");
      }
      if (this.#schemas.has(identifier)) {
        throw new Error(`Duplicate JSON Schema identifier: ${identifier}`);
      }
      this.#schemas.set(identifier, schema);
    }
  }

  assertSupportedKeywords(): void {
    const failures: string[] = [];
    for (const [identifier, schema] of this.#schemas) {
      collectUnsupportedKeywords(schema, identifier, failures);
    }
    if (failures.length > 0) {
      throw new Error([
        "The test validator does not implement every schema keyword:",
        ...failures.map((failure) => `- ${failure}`)
      ].join("\n"));
    }
  }

  validate(identifier: string, value: unknown): JsonSchemaValidationError[] {
    const schema = this.#schemas.get(identifier);
    if (!schema) {
      throw new Error(`Unknown JSON Schema identifier: ${identifier}`);
    }
    return this.#validateSchema({
      schema,
      documentSchema: schema,
      documentIdentifier: identifier,
      value,
      instancePath: "$",
      schemaPath: identifier
    });
  }

  #validateSchema(input: ValidationInput): JsonSchemaValidationError[] {
    if (typeof input.schema === "boolean") {
      return input.schema
        ? []
        : [validationError(input, "The schema rejects every value.")];
    }

    const errors: JsonSchemaValidationError[] = [];
    const ref = input.schema.$ref;
    if (typeof ref === "string") {
      const resolved = this.#resolveReference({
        reference: ref,
        documentSchema: input.documentSchema,
        documentIdentifier: input.documentIdentifier
      });
      errors.push(...this.#validateSchema({
        schema: resolved.schema,
        documentSchema: resolved.documentSchema,
        documentIdentifier: resolved.documentIdentifier,
        value: input.value,
        instancePath: input.instancePath,
        schemaPath: `${input.schemaPath}/$ref(${ref})`
      }));
    }

    if ("const" in input.schema && !deepEqual(input.value, input.schema.const)) {
      errors.push(validationError(input, "The value does not equal the required constant."));
    }

    const enumValues = input.schema.enum;
    if (Array.isArray(enumValues) && !enumValues.some((candidate) => deepEqual(candidate, input.value))) {
      errors.push(validationError(input, "The value is not one of the allowed enum values."));
    }

    const expectedType = input.schema.type;
    if (typeof expectedType === "string" && !matchesType(expectedType, input.value)) {
      errors.push(validationError(input, `Expected type ${expectedType}.`));
      return errors;
    }

    const allOf = input.schema.allOf;
    if (Array.isArray(allOf)) {
      for (const [index, candidate] of allOf.entries()) {
        if (!isJsonSchema(candidate)) {
          throw new Error(`${input.schemaPath}/allOf/${index} is not a valid schema object.`);
        }
        errors.push(...this.#validateSchema({
          ...input,
          schema: candidate,
          schemaPath: `${input.schemaPath}/allOf/${index}`
        }));
      }
    }

    const anyOf = input.schema.anyOf;
    if (Array.isArray(anyOf)) {
      const alternatives = anyOf.map((candidate, index) => {
        if (!isJsonSchema(candidate)) {
          throw new Error(`${input.schemaPath}/anyOf/${index} is not a valid schema object.`);
        }
        return this.#validateSchema({
          ...input,
          schema: candidate,
          schemaPath: `${input.schemaPath}/anyOf/${index}`
        });
      });
      if (!alternatives.some((alternative) => alternative.length === 0)) {
        errors.push(validationError(input, "The value does not satisfy any anyOf alternative."));
      }
    }

    const oneOf = input.schema.oneOf;
    if (Array.isArray(oneOf)) {
      const matchCount = oneOf.reduce((count, candidate, index) => {
        if (!isJsonSchema(candidate)) {
          throw new Error(`${input.schemaPath}/oneOf/${index} is not a valid schema object.`);
        }
        const candidateErrors = this.#validateSchema({
          ...input,
          schema: candidate,
          schemaPath: `${input.schemaPath}/oneOf/${index}`
        });
        return count + (candidateErrors.length === 0 ? 1 : 0);
      }, 0);
      if (matchCount !== 1) {
        errors.push(validationError(input, "The value must satisfy exactly one oneOf alternative."));
      }
    }

    const not = input.schema.not;
    if (not !== undefined) {
      if (!isJsonSchema(not)) {
        throw new Error(`${input.schemaPath}/not is not a valid schema object.`);
      }
      if (this.#validateSchema({
        ...input,
        schema: not,
        schemaPath: `${input.schemaPath}/not`
      }).length === 0) {
        errors.push(validationError(input, "The value satisfies a forbidden not schema."));
      }
    }

    if (typeof input.value === "string") {
      validateStringConstraints(input.schema, input.value, input, errors);
    }
    if (typeof input.value === "number") {
      validateNumberConstraints(input.schema, input.value, input, errors);
    }
    if (Array.isArray(input.value)) {
      errors.push(...this.#validateArray(input, input.value));
    }
    if (isRecord(input.value)) {
      errors.push(...this.#validateObject(input, input.value));
    }

    return errors;
  }

  #validateArray(
    input: ValidationInput,
    value: unknown[]
  ): JsonSchemaValidationError[] {
    if (typeof input.schema === "boolean") {
      return [];
    }
    const errors: JsonSchemaValidationError[] = [];
    if (typeof input.schema.minItems === "number" && value.length < input.schema.minItems) {
      errors.push(validationError(input, `Expected at least ${input.schema.minItems} array items.`));
    }
    if (typeof input.schema.maxItems === "number" && value.length > input.schema.maxItems) {
      errors.push(validationError(input, `Expected at most ${input.schema.maxItems} array items.`));
    }
    if (input.schema.uniqueItems === true && hasDuplicateJsonValues(value)) {
      errors.push(validationError(input, "Expected all array items to be unique."));
    }

    const itemSchema = input.schema.items;
    if (itemSchema !== undefined) {
      if (!isJsonSchema(itemSchema)) {
        throw new Error(`${input.schemaPath}/items is not a valid schema object.`);
      }
      for (const [index, item] of value.entries()) {
        errors.push(...this.#validateSchema({
          ...input,
          schema: itemSchema,
          value: item,
          instancePath: `${input.instancePath}/${index}`,
          schemaPath: `${input.schemaPath}/items`
        }));
      }
    }
    return errors;
  }

  #validateObject(
    input: ValidationInput,
    value: Record<string, unknown>
  ): JsonSchemaValidationError[] {
    if (typeof input.schema === "boolean") {
      return [];
    }
    const errors: JsonSchemaValidationError[] = [];
    const required = input.schema.required;
    if (Array.isArray(required)) {
      for (const property of required) {
        if (typeof property === "string" && !Object.hasOwn(value, property)) {
          errors.push(validationError(
            input,
            `Missing required property ${JSON.stringify(property)}.`
          ));
        }
      }
    }

    const properties = isRecord(input.schema.properties)
      ? input.schema.properties
      : {};
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, property)) {
        continue;
      }
      if (!isJsonSchema(propertySchema)) {
        throw new Error(`${input.schemaPath}/properties/${escapePointer(property)} is not a valid schema object.`);
      }
      errors.push(...this.#validateSchema({
        ...input,
        schema: propertySchema,
        value: value[property],
        instancePath: `${input.instancePath}/${escapePointer(property)}`,
        schemaPath: `${input.schemaPath}/properties/${escapePointer(property)}`
      }));
    }

    const additionalProperties = input.schema.additionalProperties;
    for (const [property, propertyValue] of Object.entries(value)) {
      if (Object.hasOwn(properties, property)) {
        continue;
      }
      if (additionalProperties === false) {
        errors.push(validationError(
          input,
          `Unexpected property ${JSON.stringify(property)}.`
        ));
      } else if (isJsonSchema(additionalProperties)) {
        errors.push(...this.#validateSchema({
          ...input,
          schema: additionalProperties,
          value: propertyValue,
          instancePath: `${input.instancePath}/${escapePointer(property)}`,
          schemaPath: `${input.schemaPath}/additionalProperties`
        }));
      }
    }

    const dependentRequired = input.schema.dependentRequired;
    if (isRecord(dependentRequired)) {
      for (const [trigger, dependencies] of Object.entries(dependentRequired)) {
        if (!Object.hasOwn(value, trigger) || !Array.isArray(dependencies)) {
          continue;
        }
        for (const dependency of dependencies) {
          if (typeof dependency === "string" && !Object.hasOwn(value, dependency)) {
            errors.push(validationError(
              input,
              `Property ${JSON.stringify(trigger)} requires ${JSON.stringify(dependency)}.`
            ));
          }
        }
      }
    }
    return errors;
  }

  #resolveReference(input: {
    reference: string;
    documentSchema: JsonSchema;
    documentIdentifier: string;
  }): {
    schema: JsonSchema;
    documentSchema: JsonSchema;
    documentIdentifier: string;
  } {
    const hashIndex = input.reference.indexOf("#");
    const base = hashIndex === -1 ? input.reference : input.reference.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? "" : input.reference.slice(hashIndex + 1);
    const documentIdentifier = base || input.documentIdentifier;
    const documentSchema = base
      ? this.#schemas.get(documentIdentifier)
      : input.documentSchema;
    if (!documentSchema) {
      throw new Error(`Unresolved JSON Schema reference: ${input.reference}`);
    }
    return {
      schema: resolveJsonPointer(documentSchema, fragment, input.reference),
      documentSchema,
      documentIdentifier
    };
  }
}

function validateStringConstraints(
  schema: Record<string, unknown>,
  value: string,
  input: { instancePath: string; schemaPath: string },
  errors: JsonSchemaValidationError[]
): void {
  if (typeof schema.minLength === "number" && [...value].length < schema.minLength) {
    errors.push(validationError(input, `Expected a string of at least ${schema.minLength} characters.`));
  }
  if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) {
    errors.push(validationError(input, `Expected a string of at most ${schema.maxLength} characters.`));
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
    errors.push(validationError(input, `The string does not match pattern ${schema.pattern}.`));
  }
}

function validateNumberConstraints(
  schema: Record<string, unknown>,
  value: number,
  input: { instancePath: string; schemaPath: string },
  errors: JsonSchemaValidationError[]
): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(validationError(input, `Expected a number greater than or equal to ${schema.minimum}.`));
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(validationError(input, `Expected a number less than or equal to ${schema.maximum}.`));
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "string":
      return typeof value === "string";
    default:
      throw new Error(`Unsupported JSON Schema type: ${type}`);
  }
}

function resolveJsonPointer(schema: JsonSchema, fragment: string, reference: string): JsonSchema {
  if (fragment === "") {
    return schema;
  }
  if (!fragment.startsWith("/")) {
    throw new Error(`Only JSON Pointer schema fragments are supported: ${reference}`);
  }

  let current: unknown = schema;
  for (const rawSegment of fragment.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      throw new Error(`Unresolved JSON Schema pointer: ${reference}`);
    }
    current = current[segment];
  }
  if (!isJsonSchema(current)) {
    throw new Error(`JSON Schema pointer does not identify a schema: ${reference}`);
  }
  return current;
}

function collectUnsupportedKeywords(
  schema: JsonSchema,
  schemaPath: string,
  failures: string[]
): void {
  if (typeof schema === "boolean") {
    return;
  }
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      failures.push(`${schemaPath}: unsupported keyword ${keyword}`);
    }
  }

  for (const containerKeyword of ["$defs", "properties"] as const) {
    const container = schema[containerKeyword];
    if (!isRecord(container)) {
      continue;
    }
    for (const [name, child] of Object.entries(container)) {
      if (isJsonSchema(child)) {
        collectUnsupportedKeywords(
          child,
          `${schemaPath}/${containerKeyword}/${escapePointer(name)}`,
          failures
        );
      }
    }
  }

  for (const childKeyword of ["items", "additionalProperties", "not"] as const) {
    const child = schema[childKeyword];
    if (isJsonSchema(child)) {
      collectUnsupportedKeywords(child, `${schemaPath}/${childKeyword}`, failures);
    }
  }

  for (const listKeyword of ["anyOf", "allOf", "oneOf"] as const) {
    const children = schema[listKeyword];
    if (!Array.isArray(children)) {
      continue;
    }
    for (const [index, child] of children.entries()) {
      if (isJsonSchema(child)) {
        collectUnsupportedKeywords(child, `${schemaPath}/${listKeyword}/${index}`, failures);
      }
    }
  }
}

function validationError(
  input: { instancePath: string; schemaPath: string },
  message: string
): JsonSchemaValidationError {
  return {
    instancePath: input.instancePath,
    schemaPath: input.schemaPath,
    message
  };
}

function hasDuplicateJsonValues(values: unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const serialized = canonicalJson(value);
    if (seen.has(serialized)) {
      return true;
    }
    seen.add(serialized);
  }
  return false;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "boolean" || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
