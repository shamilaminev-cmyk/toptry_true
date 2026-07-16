import OpenAI from "openai";

export const NEVERENDING_NOVEL_ARC_PLANNER_GATEWAY_VERSION =
  "neverending-novel-opening-arc-planner-gateway-v1";

export const NEVERENDING_NOVEL_ARC_PLANNER_SCHEMA_NAME =
  "opening_arc_planner_output_v0";

const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_MAX_OUTPUT_TOKENS = 64000;

function createGatewayError(code, message, statusCode, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;

  for (const [key, value] of Object.entries(details)) {
    error[key] = value;
  }

  return error;
}

function normalizeModel(value) {
  return String(value || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function normalizeReasoningEffort(value) {
  const normalized = String(
    value || DEFAULT_REASONING_EFFORT
  ).trim().toLowerCase();

  if (
    normalized === "none" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized;
  }

  return DEFAULT_REASONING_EFFORT;
}

function normalizeMaxOutputTokens(value) {
  const numeric = Number(value || DEFAULT_MAX_OUTPUT_TOKENS);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.max(
    4096,
    Math.min(128000, Math.floor(numeric))
  );
}

function ensureString(value, field, maximumLength) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_INPUT",
      `${field} is required`,
      400
    );
  }

  if (normalized.length > maximumLength) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_INPUT",
      `${field} is too large`,
      400
    );
  }

  return normalized;
}

function assertStrictSchemaObjects(node, path = "$") {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      assertStrictSchemaObjects(item, `${path}[${index}]`);
    });
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  if (
    node.type === "object" &&
    node.properties &&
    typeof node.properties === "object" &&
    !Array.isArray(node.properties)
  ) {
    const propertyNames = Object.keys(node.properties);
    const required = Array.isArray(node.required)
      ? node.required
      : [];

    const requiredSet = new Set(required);

    if (
      propertyNames.some(
        (propertyName) => !requiredSet.has(propertyName)
      )
    ) {
      throw createGatewayError(
        "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_SCHEMA",
        `All object properties must be required at ${path}`,
        400
      );
    }

    if (node.additionalProperties !== false) {
      throw createGatewayError(
        "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_SCHEMA",
        `additionalProperties must be false at ${path}`,
        400
      );
    }
  }

  for (const [key, value] of Object.entries(node)) {
    assertStrictSchemaObjects(value, `${path}.${key}`);
  }
}

export function parseNeverendingNovelOpeningArcPlannerInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_INPUT",
      "Request body must be an object",
      400
    );
  }

  if (raw.role !== "opening_arc_planner") {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_INPUT",
      "role must be opening_arc_planner",
      400
    );
  }

  if (
    raw.schemaName !==
    NEVERENDING_NOVEL_ARC_PLANNER_SCHEMA_NAME
  ) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_INPUT",
      `schemaName must be ${NEVERENDING_NOVEL_ARC_PLANNER_SCHEMA_NAME}`,
      400
    );
  }

  const systemPrompt = ensureString(
    raw.systemPrompt,
    "systemPrompt",
    100000
  );

  const userPrompt = ensureString(
    raw.userPrompt,
    "userPrompt",
    200000
  );

  const responseJsonSchema = raw.responseJsonSchema;

  if (
    !responseJsonSchema ||
    typeof responseJsonSchema !== "object" ||
    Array.isArray(responseJsonSchema)
  ) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_SCHEMA",
      "responseJsonSchema must be an object",
      400
    );
  }

  if (responseJsonSchema.type !== "object") {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_SCHEMA",
      "responseJsonSchema root must be an object",
      400
    );
  }

  const schemaSize = JSON.stringify(
    responseJsonSchema
  ).length;

  if (schemaSize > 250000) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_SCHEMA",
      "responseJsonSchema is too large",
      400
    );
  }

  assertStrictSchemaObjects(responseJsonSchema);

  return {
    role: "opening_arc_planner",
    schemaName:
      NEVERENDING_NOVEL_ARC_PLANNER_SCHEMA_NAME,
    systemPrompt,
    userPrompt,
    responseJsonSchema
  };
}

export function describeNeverendingNovelOpeningArcPlanner() {
  return {
    gatewayVersion:
      NEVERENDING_NOVEL_ARC_PLANNER_GATEWAY_VERSION,
    provider: "openai",
    model: normalizeModel(
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_MODEL
    ),
    reasoningEffort: normalizeReasoningEffort(
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_REASONING_EFFORT
    ),
    maxOutputTokens: normalizeMaxOutputTokens(
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_MAX_OUTPUT_TOKENS
    ),
    providerConfigured: Boolean(
      String(process.env.OPENAI_API_KEY || "").trim()
    )
  };
}

export function buildNeverendingNovelOpeningArcPlannerRequest(
  input,
  overrides = {}
) {
  const parsed =
    parseNeverendingNovelOpeningArcPlannerInput(input);

  const model = normalizeModel(
    overrides.model ||
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_MODEL
  );

  const reasoningEffort = normalizeReasoningEffort(
    overrides.reasoningEffort ||
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_REASONING_EFFORT
  );

  const maxOutputTokens = normalizeMaxOutputTokens(
    overrides.maxOutputTokens ||
      process.env.NEVERENDING_NOVEL_ARC_PLANNER_MAX_OUTPUT_TOKENS
  );

  return {
    model,
    instructions: parsed.systemPrompt,
    input: parsed.userPrompt,
    text: {
      format: {
        type: "json_schema",
        name: parsed.schemaName,
        strict: true,
        schema: parsed.responseJsonSchema
      }
    },
    reasoning: {
      effort: reasoningEffort
    },
    max_output_tokens: maxOutputTokens,
    background: true,
    store: false
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  return {
    inputTokens:
      Number.isFinite(Number(usage.input_tokens))
        ? Number(usage.input_tokens)
        : null,
    outputTokens:
      Number.isFinite(Number(usage.output_tokens))
        ? Number(usage.output_tokens)
        : null,
    reasoningTokens:
      Number.isFinite(
        Number(
          usage.output_tokens_details?.reasoning_tokens
        )
      )
        ? Number(
            usage.output_tokens_details.reasoning_tokens
          )
        : null,
    totalTokens:
      Number.isFinite(Number(usage.total_tokens))
        ? Number(usage.total_tokens)
        : null
  };
}

function createNeverendingNovelOpenAiClient() {
  const apiKey = String(
    process.env.OPENAI_API_KEY || ""
  ).trim();

  if (!apiKey) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_NOT_CONFIGURED",
      "OPENAI_API_KEY is not configured on the AI gateway",
      503
    );
  }

  return new OpenAI({ apiKey });
}

function normalizeBackgroundResponse(
  response,
  requestMetadata
) {
  return {
    provider: "openai",
    model:
      requestMetadata?.model ||
      response?.model ||
      null,
    gatewayVersion:
      NEVERENDING_NOVEL_ARC_PLANNER_GATEWAY_VERSION,
    role: "opening_arc_planner",
    schemaName:
      NEVERENDING_NOVEL_ARC_PLANNER_SCHEMA_NAME,
    responseId: response?.id ?? null,
    providerRequestId:
      response?._request_id ?? null,
    status: String(response?.status || ""),
    usage: normalizeUsage(response?.usage),
    output: null
  };
}

function parseCompletedArcPlannerResponse(
  response,
  requestMetadata
) {
  const outputText = String(
    response?.output_text || ""
  ).trim();

  if (!outputText) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_INVALID_RESPONSE",
      "OpenAI did not return Opening Arc Planner output",
      502,
      {
        providerRequestId:
          response?._request_id ?? null
      }
    );
  }

  let output;

  try {
    output = JSON.parse(outputText);
  } catch {
    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_INVALID_RESPONSE",
      "OpenAI Opening Arc Planner output is not valid JSON",
      502,
      {
        providerRequestId:
          response?._request_id ?? null
      }
    );
  }

  return {
    ...normalizeBackgroundResponse(
      response,
      requestMetadata
    ),
    status: "completed",
    output
  };
}

function validateResponseId(value) {
  const responseId = String(value || "").trim();

  if (
    !/^resp_[A-Za-z0-9_-]+$/.test(responseId) ||
    responseId.length > 220
  ) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_ARC_PLANNER_INVALID_RESPONSE_ID",
      "Invalid OpenAI response id",
      400
    );
  }

  return responseId;
}

function logOpenAiProviderError(
  operation,
  providerError
) {
  const normalize = (value, maximumLength = 2000) => {
    const normalized = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(0, maximumLength);
  };

  console.error(
    `[toptry] Neverending Novel Opening Arc Planner OpenAI ${operation} provider error`,
    {
      status: providerError?.status ?? null,
      requestId:
        providerError?.request_id ?? null,
      name: normalize(providerError?.name, 200),
      code: normalize(providerError?.code, 500),
      type: normalize(providerError?.type, 500),
      param: normalize(providerError?.param, 1000),
      message: normalize(
        providerError?.message,
        2000
      )
    }
  );
}

export async function startNeverendingNovelOpeningArcPlanner(
  rawInput
) {
  const input =
    parseNeverendingNovelOpeningArcPlannerInput(rawInput);

  const request =
    buildNeverendingNovelOpeningArcPlannerRequest(input);

  const client =
    createNeverendingNovelOpenAiClient();

  let response;

  try {
    response = await client.responses.create(request);
  } catch (providerError) {
    logOpenAiProviderError(
      "start",
      providerError
    );

    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_UPSTREAM_FAILED",
      "OpenAI Opening Arc Planner request failed",
      502,
      {
        providerStatus:
          providerError?.status ?? null,
        providerRequestId:
          providerError?.request_id ?? null,
        cause: providerError
      }
    );
  }

  if (!response?.id) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_INVALID_RESPONSE",
      "OpenAI did not return a background response id",
      502
    );
  }

  if (response.status === "completed") {
    return parseCompletedArcPlannerResponse(
      response,
      request
    );
  }

  return normalizeBackgroundResponse(
    response,
    request
  );
}

export async function retrieveNeverendingNovelOpeningArcPlanner(
  rawResponseId
) {
  const responseId = validateResponseId(rawResponseId);

  const client =
    createNeverendingNovelOpenAiClient();

  let response;

  try {
    response = await client.responses.retrieve(
      responseId
    );
  } catch (providerError) {
    throw createGatewayError(
      "NEVERENDING_NOVEL_OPENAI_UPSTREAM_FAILED",
      "OpenAI Opening Arc Planner status request failed",
      502,
      {
        providerStatus:
          providerError?.status ?? null,
        providerRequestId:
          providerError?.request_id ?? null,
        cause: providerError
      }
    );
  }

  if (
    response.status === "queued" ||
    response.status === "in_progress"
  ) {
    return normalizeBackgroundResponse(
      response,
      response
    );
  }

  if (response.status === "completed") {
    return parseCompletedArcPlannerResponse(
      response,
      response
    );
  }

  throw createGatewayError(
    "NEVERENDING_NOVEL_OPENAI_TERMINAL_FAILURE",
    `Opening Arc Planner response reached terminal status: ${response.status}`,
    502,
    {
      providerRequestId:
        response?._request_id ?? null,
      responseId: response?.id ?? responseId
    }
  );
}
