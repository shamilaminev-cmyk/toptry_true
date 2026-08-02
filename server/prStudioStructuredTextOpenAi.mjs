import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_REASONING_EFFORT = "low";
const REASONING_EFFORT_BY_OPERATION = new Map([
  ["brand-memory.website-batch-analysis", "medium"],
  ["brand-memory.website-profile-synthesis", "medium"],
  ["content.research", "medium"],
  ["content.copywrite", "medium"],
  ["content.edit", "medium"],
]);
const DEFAULT_MAX_OUTPUT_TOKENS = 6_000;
const MIN_MAX_OUTPUT_TOKENS = 256;
const MAX_MAX_OUTPUT_TOKENS = 12_000;
const MAX_INSTRUCTIONS_LENGTH = 30_000;
const MAX_INPUT_JSON_LENGTH = 300_000;
const MAX_SCHEMA_JSON_LENGTH = 60_000;
const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_PROPERTIES = 300;
const MAX_SCHEMA_ENUM_VALUES = 1_500;
const OPENAI_TIMEOUT_MS = 300_000;
const OPENAI_MAX_RETRIES = 1;

const ALLOWED_OPERATIONS = new Set([
  "brand-memory.website-batch-analysis",
  "brand-memory.website-profile-synthesis",
  "brand-memory.claim-consolidation",
  "brand-memory.document-batch-analysis",
  "brand-memory.document-profile-synthesis",
  "content.research",
  "content.copywrite",
  "content.edit",
]);

const ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

const ALLOWED_SCHEMA_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

export function parsePrStudioStructuredTextInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }

  const operation = cleanString(value.operation, 100);
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw invalidInput("Structured text operation is not allowed");
  }

  const promptVersion = cleanString(value.promptVersion, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(promptVersion)) {
    throw invalidInput("promptVersion must use letters, numbers, dots, underscores or hyphens");
  }

  const instructions = cleanString(value.instructions, MAX_INSTRUCTIONS_LENGTH);
  if (!instructions) throw invalidInput("instructions are required");
  if (typeof value.instructions !== "string" || value.instructions.trim().length > MAX_INSTRUCTIONS_LENGTH) {
    throw invalidInput(`instructions must not exceed ${MAX_INSTRUCTIONS_LENGTH} characters`);
  }

  if (!("input" in value)) throw invalidInput("input is required");
  const serializedInput = serializeJson(value.input, "input");
  if (serializedInput.length > MAX_INPUT_JSON_LENGTH) {
    throw invalidInput(`input JSON must not exceed ${MAX_INPUT_JSON_LENGTH} characters`);
  }

  const responseSchema = parseResponseSchema(value.responseSchema);
  const maxOutputTokens = parseBoundedInteger(
    value.maxOutputTokens,
    DEFAULT_MAX_OUTPUT_TOKENS,
    MIN_MAX_OUTPUT_TOKENS,
    MAX_MAX_OUTPUT_TOKENS,
    "maxOutputTokens",
  );

  return {
    operation,
    promptVersion,
    instructions,
    input: value.input,
    serializedInput,
    responseSchema,
    maxOutputTokens,
  };
}

export function buildPrStudioStructuredTextRequest(parsed) {
  const model = String(process.env.PR_STUDIO_TEXT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return {
    model,
    reasoning: { effort: reasoningEffortForOperation(parsed.operation) },
    instructions: parsed.instructions,
    input: parsed.serializedInput,
    max_output_tokens: parsed.maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: parsed.responseSchema.name,
        strict: true,
        schema: parsed.responseSchema.schema,
      },
    },
  };
}

function reasoningEffortForOperation(operation) {
  return REASONING_EFFORT_BY_OPERATION.get(operation) || DEFAULT_REASONING_EFFORT;
}

export async function executePrStudioStructuredText(input, options = {}) {
  const parsed = parsePrStudioStructuredTextInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const client = options.client || createOpenAiClient(apiKey);
  const request = buildPrStudioStructuredTextRequest(parsed);
  const response = await client.responses.create(request);
  const diagnostics = collectProviderDiagnostics(response);

  if (response?.status === "incomplete") {
    const reason = diagnostics.incompleteReason || "unknown_reason";
    throw invalidResponse(`OpenAI response was incomplete: ${reason}`, {
      code: "PR_STUDIO_TRANSPORT_INCOMPLETE_RESPONSE",
      ...diagnostics,
    });
  }
  if (response?.status && response.status !== "completed") {
    throw invalidResponse(`OpenAI response status was ${response.status}`, {
      code: "PR_STUDIO_TRANSPORT_INVALID_RESPONSE",
      ...diagnostics,
    });
  }

  const refusal = extractRefusal(response);
  if (refusal) {
    throw invalidResponse("OpenAI refused structured output", {
      code: "PR_STUDIO_TRANSPORT_REFUSAL",
      ...diagnostics,
    });
  }

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw invalidResponse("OpenAI returned no structured output", {
      ...diagnostics,
      outputLength: 0,
    });
  }

  let output;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw invalidResponse("OpenAI returned malformed JSON", {
      ...diagnostics,
      outputLength: outputText.length,
    });
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw invalidResponse("OpenAI returned an invalid structured response", {
      ...diagnostics,
      outputLength: outputText.length,
    });
  }

  return {
    operation: parsed.operation,
    promptVersion: parsed.promptVersion,
    output,
    model: response.model || request.model,
    responseId: response.id || null,
    usage: normalizeUsage(response.usage),
  };
}

function collectProviderDiagnostics(response) {
  return {
    providerStatus:
      typeof response?.status === "string" ? response.status : null,
    incompleteReason:
      typeof response?.incomplete_details?.reason === "string"
        ? response.incomplete_details.reason
        : null,
    providerRequestId:
      typeof response?._request_id === "string" ? response._request_id : null,
    responseId: typeof response?.id === "string" ? response.id : null,
    model: typeof response?.model === "string" ? response.model : null,
    usage: normalizeUsage(response?.usage),
    outputItemTypes: Array.isArray(response?.output)
      ? response.output
          .map((item) => (typeof item?.type === "string" ? item.type : "unknown"))
          .slice(0, 20)
      : [],
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

function extractRefusal(response) {
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "refusal") return true;
    }
  }
  return false;
}

function createOpenAiClient(apiKey) {
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
    throw error;
  }
  return new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
  });
}

function parseResponseSchema(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("responseSchema must be an object");
  }
  const name = cleanString(value.name, 64);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw invalidInput("responseSchema.name must be a valid schema name");
  }
  if (!value.schema || typeof value.schema !== "object" || Array.isArray(value.schema)) {
    throw invalidInput("responseSchema.schema must be an object");
  }
  const serializedSchema = serializeJson(value.schema, "responseSchema.schema");
  if (serializedSchema.length > MAX_SCHEMA_JSON_LENGTH) {
    throw invalidInput(`response schema must not exceed ${MAX_SCHEMA_JSON_LENGTH} characters`);
  }

  const counters = { properties: 0, enumValues: 0 };
  validateSchemaNode(value.schema, 0, counters, "responseSchema.schema");
  if (value.schema.type !== "object") {
    throw invalidInput("response schema root type must be object");
  }

  return { name, schema: value.schema };
}

function validateSchemaNode(node, depth, counters, path) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw invalidInput(`${path} must be an object`);
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    throw invalidInput(`response schema depth must not exceed ${MAX_SCHEMA_DEPTH}`);
  }

  for (const key of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) {
      throw invalidInput(`${path} uses unsupported schema keyword ${key}`);
    }
  }

  const { baseType: schemaType, nullable } = parseSchemaType(node.type, path);
  if (node.description !== undefined && typeof node.description !== "string") {
    throw invalidInput(`${path}.description must be a string`);
  }

  validateEnum(node.enum, schemaType, nullable, counters, path);
  validateTypeSpecificKeywords(node, schemaType, path);

  if (schemaType === "object") {
    if (node.additionalProperties !== false) {
      throw invalidInput(`${path}.additionalProperties must be false`);
    }
    if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
      throw invalidInput(`${path}.properties must be an object`);
    }
    const propertyNames = Object.keys(node.properties);
    counters.properties += propertyNames.length;
    if (counters.properties > MAX_SCHEMA_PROPERTIES) {
      throw invalidInput(`response schema properties must not exceed ${MAX_SCHEMA_PROPERTIES}`);
    }
    if (!Array.isArray(node.required)) {
      throw invalidInput(`${path}.required must be an array`);
    }
    const required = [...new Set(node.required)];
    if (
      required.length !== propertyNames.length ||
      required.some((name) => typeof name !== "string" || !propertyNames.includes(name))
    ) {
      throw invalidInput(`${path}.required must contain every property exactly once`);
    }
    for (const propertyName of propertyNames) {
      validateSchemaNode(
        node.properties[propertyName],
        depth + 1,
        counters,
        `${path}.properties.${propertyName}`,
      );
    }
  } else {
    if (node.properties !== undefined || node.required !== undefined || node.additionalProperties !== undefined) {
      throw invalidInput(`${path} uses object keywords for a non-object type`);
    }
  }

  if (schemaType === "array") {
    if (!node.items) throw invalidInput(`${path}.items is required for arrays`);
    validateSchemaNode(node.items, depth + 1, counters, `${path}.items`);
  } else if (node.items !== undefined) {
    throw invalidInput(`${path}.items is allowed only for arrays`);
  }
}

function parseSchemaType(value, path) {
  if (typeof value === "string" && ALLOWED_SCHEMA_TYPES.has(value)) {
    return { baseType: value, nullable: value === "null" };
  }
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.includes("null")
  ) {
    const nonNullTypes = value.filter((item) => item !== "null");
    if (
      nonNullTypes.length === 1 &&
      ["string", "number", "integer", "boolean"].includes(nonNullTypes[0])
    ) {
      return { baseType: nonNullTypes[0], nullable: true };
    }
  }
  throw invalidInput(`${path}.type is not supported`);
}

function validateEnum(values, schemaType, nullable, counters, path) {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length === 0) {
    throw invalidInput(`${path}.enum must be a non-empty array`);
  }
  if (["object", "array"].includes(schemaType)) {
    throw invalidInput(`${path}.enum is not supported for ${schemaType}`);
  }
  counters.enumValues += values.length;
  if (counters.enumValues > MAX_SCHEMA_ENUM_VALUES) {
    throw invalidInput(`response schema enum values must not exceed ${MAX_SCHEMA_ENUM_VALUES}`);
  }
  for (const value of values) {
    if (value === null) {
      if (!nullable) {
        throw invalidInput(`${path}.enum contains null outside its declared type`);
      }
      continue;
    }
    if (schemaType === "string" && typeof value !== "string") {
      throw invalidInput(`${path}.enum contains a value outside its declared type`);
    }
    if (schemaType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw invalidInput(`${path}.enum contains a value outside its declared type`);
    }
    if (schemaType === "integer" && !Number.isInteger(value)) {
      throw invalidInput(`${path}.enum contains a value outside its declared type`);
    }
    if (schemaType === "boolean" && typeof value !== "boolean") {
      throw invalidInput(`${path}.enum contains a value outside its declared type`);
    }
    if (schemaType === "null" && value !== null) {
      throw invalidInput(`${path}.enum contains a value outside its declared type`);
    }
  }
}

function validateTypeSpecificKeywords(node, schemaType, path) {
  validateNumericKeyword(node, "minLength", path, 0, 100_000);
  validateNumericKeyword(node, "maxLength", path, 1, 100_000);
  validateNumericKeyword(node, "minItems", path, 0, 10_000);
  validateNumericKeyword(node, "maxItems", path, 1, 10_000);

  if (schemaType !== "string" && (node.minLength !== undefined || node.maxLength !== undefined)) {
    throw invalidInput(`${path} uses string keywords for a non-string type`);
  }
  if (schemaType !== "array" && (node.minItems !== undefined || node.maxItems !== undefined)) {
    throw invalidInput(`${path} uses array keywords for a non-array type`);
  }
  if (
    !["number", "integer"].includes(schemaType) &&
    (node.minimum !== undefined || node.maximum !== undefined)
  ) {
    throw invalidInput(`${path} uses numeric keywords for a non-numeric type`);
  }
  if (node.minimum !== undefined && (typeof node.minimum !== "number" || !Number.isFinite(node.minimum))) {
    throw invalidInput(`${path}.minimum must be a finite number`);
  }
  if (node.maximum !== undefined && (typeof node.maximum !== "number" || !Number.isFinite(node.maximum))) {
    throw invalidInput(`${path}.maximum must be a finite number`);
  }
  if (node.minimum !== undefined && node.maximum !== undefined && node.minimum > node.maximum) {
    throw invalidInput(`${path}.minimum must not exceed maximum`);
  }
  if (node.minLength !== undefined && node.maxLength !== undefined && node.minLength > node.maxLength) {
    throw invalidInput(`${path}.minLength must not exceed maxLength`);
  }
  if (node.minItems !== undefined && node.maxItems !== undefined && node.minItems > node.maxItems) {
    throw invalidInput(`${path}.minItems must not exceed maxItems`);
  }
}

function validateNumericKeyword(node, key, path, minimum, maximum) {
  if (node[key] === undefined) return;
  if (!Number.isInteger(node[key]) || node[key] < minimum || node[key] > maximum) {
    throw invalidInput(`${path}.${key} must be an integer between ${minimum} and ${maximum}`);
  }
}

function parseBoundedInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidInput(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function serializeJson(value, field) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
    return serialized;
  } catch {
    throw invalidInput(`${field} must be JSON serializable`);
  }
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: finiteNumberOrNull(usage.input_tokens),
    outputTokens: finiteNumberOrNull(usage.output_tokens),
    totalTokens: finiteNumberOrNull(usage.total_tokens),
    cachedInputTokens: finiteNumberOrNull(usage.input_tokens_details?.cached_tokens),
    reasoningTokens: finiteNumberOrNull(usage.output_tokens_details?.reasoning_tokens),
  };
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_TRANSPORT_INVALID_INPUT";
  return error;
}

function invalidResponse(message, details = {}) {
  const error = new Error(message);
  error.code =
    details.code || "PR_STUDIO_TRANSPORT_INVALID_RESPONSE";
  for (const [key, value] of Object.entries(details)) {
    if (key !== "code") error[key] = value;
  }
  return error;
}
