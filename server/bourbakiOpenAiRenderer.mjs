import crypto from "node:crypto";
import OpenAI from "openai";

export const BOURBAKI_OPENAI_RENDER_PROMPT_VERSION =
  "bourbaki-openai-one-shot-v1";

const DEFAULT_MODEL = "gpt-image-2";
const OUTPUT_SIZE = "1152x1536"; // exact 3:4, valid for GPT Image 2
const OUTPUT_FORMAT = "webp";
const OUTPUT_COMPRESSION = 92;
const MAX_SWATCH_BYTES = 8 * 1024 * 1024;
const MAX_SWATCH_BASE64_CHARS = 12_000_000;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ENUMS = {
  suitType: new Set(["TWO_PIECE", "THREE_PIECE"]),
  renderPreset: new Set(["MENSWEAR_THREE_QUARTER_OPEN_V1"]),
  jacketFront: new Set(["SINGLE_BREASTED"]),
  buttonConfiguration: new Set(["THREE_ROLL_TWO", "TWO_BUTTON"]),
  lapels: new Set(["NOTCH_MEDIUM", "PEAK_NARROW"]),
  shoulders: new Set(["STRUCTURED", "CLASSIC"]),
  silhouette: new Set(["CLASSIC_BALANCED", "FITTED_SHAPED"]),
  breastPocket: new Set(["STRAIGHT_WELT", "BARCHETTA"]),
  lowerPockets: new Set(["PATCH", "JETTED_NO_FLAP"]),
  vent: new Set(["SINGLE"]),
  trouserFit: new Set(["RELAXED", "SLIM"]),
  waistband: new Set(["BELT_LOOPS", "GURKHA"]),
  cuffs: new Set(["TURN_UPS", "NONE"]),
  length: new Set(["MEDIUM", "LONG"]),
};

function inputError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(code);
  }
  return value;
}

function requiredEnum(value, allowed, code) {
  const normalized = typeof value === "string"
    ? value.trim().toUpperCase()
    : "";

  if (!allowed.has(normalized)) {
    throw inputError(code);
  }

  return normalized;
}

function requiredBoolean(value, code) {
  if (typeof value !== "boolean") {
    throw inputError(code);
  }
  return value;
}

function normalizeQuality(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(normalized) ? normalized : "high";
}

function normalizeModel(value) {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_MODEL;
}

function fileNameForMimeType(mimeType) {
  if (mimeType === "image/jpeg") return "fabric-swatch.jpg";
  if (mimeType === "image/png") return "fabric-swatch.png";
  return "fabric-swatch.webp";
}

function parseFabricSwatch(value) {
  const swatch = requiredObject(value, "INVALID_FABRIC_SWATCH");
  const mimeType = typeof swatch.mimeType === "string"
    ? swatch.mimeType.trim().toLowerCase()
    : "";
  const data = typeof swatch.data === "string" ? swatch.data.trim() : "";

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw inputError("UNSUPPORTED_FABRIC_SWATCH");
  }

  if (
    !data ||
    data.length > MAX_SWATCH_BASE64_CHARS ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    throw inputError("INVALID_FABRIC_SWATCH");
  }

  const bytes = Buffer.from(data, "base64");

  if (!bytes.length || bytes.length > MAX_SWATCH_BYTES) {
    throw inputError("FABRIC_SWATCH_TOO_LARGE");
  }

  return {
    mimeType,
    data,
    byteLength: bytes.length,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseJacket(value) {
  const jacket = requiredObject(value, "INVALID_JACKET_CONFIGURATION");

  return {
    front: requiredEnum(
      jacket.front,
      ENUMS.jacketFront,
      "INVALID_JACKET_FRONT",
    ),
    buttonConfiguration: requiredEnum(
      jacket.buttonConfiguration,
      ENUMS.buttonConfiguration,
      "INVALID_BUTTON_CONFIGURATION",
    ),
    lapels: requiredEnum(
      jacket.lapels,
      ENUMS.lapels,
      "INVALID_LAPELS",
    ),
    shoulders: requiredEnum(
      jacket.shoulders,
      ENUMS.shoulders,
      "INVALID_SHOULDERS",
    ),
    silhouette: requiredEnum(
      jacket.silhouette,
      ENUMS.silhouette,
      "INVALID_JACKET_SILHOUETTE",
    ),
    breastPocket: requiredEnum(
      jacket.breastPocket,
      ENUMS.breastPocket,
      "INVALID_BREAST_POCKET",
    ),
    lowerPockets: requiredEnum(
      jacket.lowerPockets,
      ENUMS.lowerPockets,
      "INVALID_LOWER_POCKETS",
    ),
    ticketPocket: requiredBoolean(
      jacket.ticketPocket,
      "INVALID_TICKET_POCKET",
    ),
    vent: requiredEnum(
      jacket.vent,
      ENUMS.vent,
      "INVALID_JACKET_VENT",
    ),
    milaneseButtonhole: requiredBoolean(
      jacket.milaneseButtonhole,
      "INVALID_MILANESE_BUTTONHOLE",
    ),
  };
}

function parseTrousers(value) {
  const trousers = requiredObject(value, "INVALID_TROUSER_CONFIGURATION");

  return {
    fit: requiredEnum(
      trousers.fit,
      ENUMS.trouserFit,
      "INVALID_TROUSER_FIT",
    ),
    waistband: requiredEnum(
      trousers.waistband,
      ENUMS.waistband,
      "INVALID_TROUSER_WAISTBAND",
    ),
    cuffs: requiredEnum(
      trousers.cuffs,
      ENUMS.cuffs,
      "INVALID_TROUSER_CUFFS",
    ),
    length: requiredEnum(
      trousers.length,
      ENUMS.length,
      "INVALID_TROUSER_LENGTH",
    ),
  };
}

export function parseBourbakiOpenAiRenderInput(value) {
  const body = requiredObject(value, "INVALID_BODY");
  const configuration = requiredObject(
    body.configuration,
    "INVALID_SUIT_CONFIGURATION",
  );

  const suitType = requiredEnum(
    configuration.suitType,
    ENUMS.suitType,
    "INVALID_SUIT_TYPE",
  );
  const waistcoat = requiredBoolean(
    configuration.waistcoat,
    "INVALID_WAISTCOAT_CONFIGURATION",
  );

  if ((suitType === "THREE_PIECE") !== waistcoat) {
    throw inputError("INCONSISTENT_WAISTCOAT_CONFIGURATION");
  }

  const renderPreset = requiredEnum(
    body.renderPreset,
    ENUMS.renderPreset,
    "INVALID_RENDER_PRESET",
  );
  const fabricSwatch = parseFabricSwatch(body.fabricSwatch);
  const jacket = parseJacket(configuration.jacket);
  const trousers = parseTrousers(configuration.trousers);
  const dryRun = body.dryRun === true;

  const normalizedConfiguration = {
    suitType,
    waistcoat,
    jacket,
    trousers,
  };

  const configurationHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      promptVersion: BOURBAKI_OPENAI_RENDER_PROMPT_VERSION,
      renderPreset,
      configuration: normalizedConfiguration,
      fabricSwatchHash: fabricSwatch.hash,
    }))
    .digest("hex");

  return {
    dryRun,
    renderPreset,
    configuration: normalizedConfiguration,
    fabricSwatch,
    configurationHash,
  };
}

function buttonInstruction(buttonConfiguration) {
  if (buttonConfiguration === "THREE_ROLL_TWO") {
    return [
      "Single-breasted true 3-roll-2 construction.",
      "There are exactly three physical front buttons in total.",
      "The jacket is open, but all three button positions must remain clearly identifiable.",
      "The lapel must softly roll toward the middle button position, so the jacket reads as a true 3-roll-2 rather than a flat generic three-button or ordinary two-button jacket.",
    ].join(" ");
  }

  return [
    "Single-breasted two-button construction.",
    "There are exactly two visible front buttons and no third button or extra visible fastener.",
  ].join(" ");
}

function lapelInstruction(lapels) {
  return lapels === "PEAK_NARROW"
    ? "Use clearly recognisable narrow, elegant peak lapels. They must not read as notch lapels."
    : "Use medium-width notch lapels with a classic, balanced roll.";
}

function shoulderInstruction(shoulders) {
  return shoulders === "STRUCTURED"
    ? "Use structured, pronounced shoulders with a clear shoulder-to-sleeve transition."
    : "Use classic shoulder construction with a clean, natural tailored sleeve attachment.";
}

function silhouetteInstruction(silhouette) {
  return silhouette === "FITTED_SHAPED"
    ? "Use a fitted, shaped silhouette with a clean suppressed waist."
    : "Use a classic balanced tailoring silhouette.";
}

function breastPocketInstruction(breastPocket) {
  if (breastPocket === "BARCHETTA") {
    return [
      "Render exactly one true Barchetta breast pocket on the wearer's left chest.",
      "Its welt opening must be visibly curved in a shallow boat-shaped line, not straight, almost straight, merely diagonal, or a conventional angled breast welt.",
      "The Barchetta curve must remain recognisable in the final full-length image.",
    ].join(" ");
  }

  return "Render exactly one straight welt breast pocket on the wearer's left chest.";
}

function lowerPocketInstruction(lowerPockets, ticketPocket) {
  const ticketRule = ticketPocket
    ? "Render exactly one small ticket pocket above the wearer's right lower pocket."
    : "A ticket pocket is forbidden. Do not add any third small pocket, flap, welt or opening above either lower pocket.";

  if (lowerPockets === "PATCH") {
    return [
      "Render exactly two lower patch pockets, one on each side.",
      ticketRule,
      "No extra flaps, no extra welts, no duplicated pockets and no additional pocket layers.",
    ].join(" ");
  }

  return [
    "Render exactly two lower jetted pockets without flaps, one on each side.",
    ticketRule,
    "No lower pocket flaps, no patch pockets, no extra welts, no duplicated pockets and no additional pocket layers.",
  ].join(" ");
}

function ventInstruction(vent) {
  return vent === "SINGLE"
    ? "The jacket construction includes one single rear vent."
    : "Use the selected rear vent configuration.";
}

function milaneseInstruction(selected) {
  return selected
    ? "Include one subtle Milanese buttonhole on the lapel."
    : "Do not add a Milanese buttonhole.";
}

function trouserInstruction(trousers) {
  const fit = trousers.fit === "SLIM"
    ? "Use a slim, narrow tailored leg."
    : "Use a slightly fuller, relaxed tailored leg with elegant drape.";
  const waistband = trousers.waistband === "GURKHA"
    ? "Use a clearly visible Gurkha waistband with distinctive side fastening straps and buckles, no belt and no belt loops."
    : "Use a trouser waistband with visible belt loops.";
  const cuffs = trousers.cuffs === "TURN_UPS"
    ? "Use clearly visible turn-up cuffs at both trouser hems."
    : "Use plain trouser hems with no turn-up cuffs.";
  const length = trousers.length === "LONG"
    ? "Use a longer trouser length with a clean tailored break."
    : "Use a medium trouser length with a neat, proportional break.";

  return [fit, waistband, cuffs, length].join(" ");
}

function poseInstruction(ticketPocket) {
  if (ticketPocket) {
    return [
      "The model's LEFT hand is placed naturally in the left trouser pocket, gently pulling the left front of the jacket back.",
      "Keep the model's right jacket front fully readable so the ticket pocket and right lower pocket remain visible.",
      "The other side of the jacket hangs naturally and freely.",
    ].join(" ");
  }

  return [
    "The model's right hand is placed naturally in the right trouser pocket, gently pulling that front of the jacket back.",
    "The other side of the jacket hangs naturally and freely.",
  ].join(" ");
}

export function buildBourbakiOpenAiPrompt(input) {
  const { configuration, renderPreset } = input;
  const { jacket, trousers } = configuration;
  const waistcoatInstruction = configuration.waistcoat
    ? "This is a three-piece suit. A matching tailored waistcoat in the same literal fabric is required and must be visibly worn beneath the open jacket."
    : "This is a two-piece suit. Do not add a waistcoat.";

  if (renderPreset !== "MENSWEAR_THREE_QUARTER_OPEN_V1") {
    throw inputError("INVALID_RENDER_PRESET");
  }

  return [
    "REFERENCE B is the fabric swatch and must be used as the literal final suit cloth.",
    "",
    "Create a realistic full-length studio fashion image of one adult man wearing the exact tailored suit specified below.",
    "Important: prioritise garment construction accuracy and exact pocket architecture over stylistic interpretation.",
    "",
    "FABRIC FIDELITY — CRITICAL:",
    "REFERENCE B is not merely a colour reference. It is the actual cloth for the final jacket, trousers, and matching waistcoat when present.",
    "Use it faithfully for colour, contrast, texture, weave character, pattern visibility, and apparent scale.",
    "Treat the swatch as a close-up of the real cloth. Do not reinterpret, simplify, smooth out, blur, enlarge, shrink, stylise, or genericise the fabric.",
    "The garment must remain recognisably made from the same cloth as REFERENCE B at realistic garment scale.",
    "Do not show the swatch, any diagram, labels, text or logos in the final image.",
    "",
    "JACKET CONSTRUCTION:",
    buttonInstruction(jacket.buttonConfiguration),
    lapelInstruction(jacket.lapels),
    shoulderInstruction(jacket.shoulders),
    silhouetteInstruction(jacket.silhouette),
    breastPocketInstruction(jacket.breastPocket),
    lowerPocketInstruction(jacket.lowerPockets, jacket.ticketPocket),
    ventInstruction(jacket.vent),
    milaneseInstruction(jacket.milaneseButtonhole),
    "The jacket is open and unbuttoned.",
    "",
    "TROUSERS:",
    "The trousers are tailored in the same literal fabric as the jacket.",
    trouserInstruction(trousers),
    "",
    "WAISTCOAT:",
    waistcoatInstruction,
    "",
    "POSE AND PRESENTATION:",
    "Full-length view: the complete head, jacket, trousers and both shoes must be inside the frame.",
    "The model stands upright at a slight angle to the camera, approximately 15 to 20 degrees away from the frontal plane.",
    "The pose must make the shoulder, sleeve attachment and tailored silhouette clearly visible.",
    poseInstruction(jacket.ticketPocket),
    "The pose must remain elegant and natural, not exaggerated.",
    "Do not let hands, lapels, deep shadows or excessive drape hide the selected breast pocket, lower pockets, ticket pocket or button configuration.",
    "",
    "STYLING:",
    "Wear only a plain white open-collar dress shirt, no tie, and black Oxford shoes.",
    "Use a neutral, plain studio background, realistic proportions, sharp tailoring details and an elegant luxury menswear look.",
    "No pocket square, scarf, watch, jewellery, belt ornament, bag, outerwear, extra accessories, visible branding, text or watermark.",
  ].join("\n");
}

function publicConfiguration(input) {
  return {
    renderPreset: input.renderPreset,
    configuration: input.configuration,
    configurationHash: input.configurationHash,
    fabric: {
      mimeType: input.fabricSwatch.mimeType,
      byteLength: input.fabricSwatch.byteLength,
      sha256: input.fabricSwatch.hash,
    },
  };
}

export function describeBourbakiOpenAiRender(input) {
  return {
    provider: "openai",
    model: normalizeModel(process.env.BOURBAKI_OPENAI_IMAGE_MODEL),
    promptVersion: BOURBAKI_OPENAI_RENDER_PROMPT_VERSION,
    output: {
      size: OUTPUT_SIZE,
      format: OUTPUT_FORMAT,
      quality: normalizeQuality(process.env.BOURBAKI_OPENAI_IMAGE_QUALITY),
    },
    ...publicConfiguration(input),
    prompt: buildBourbakiOpenAiPrompt(input),
    providerConfigured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()),
  };
}

function createFabricFile(fabricSwatch) {
  return new File(
    [Buffer.from(fabricSwatch.data, "base64")],
    fileNameForMimeType(fabricSwatch.mimeType),
    { type: fabricSwatch.mimeType },
  );
}

function normalizeOpenAiError(error) {
  if (error?.code === "BOURBAKI_OPENAI_NOT_CONFIGURED") {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error || "Unknown provider error");
  const normalized = new Error(message.slice(0, 700));
  normalized.code = "BOURBAKI_OPENAI_UPSTREAM_FAILED";
  normalized.providerStatus = Number(error?.status || error?.statusCode || 0) || null;
  normalized.providerRequestId =
    typeof error?.request_id === "string"
      ? error.request_id
      : typeof error?.requestId === "string"
        ? error.requestId
        : null;
  return normalized;
}

export async function renderBourbakiOpenAiSuit(input) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();

  if (!apiKey) {
    throw inputError(
      "BOURBAKI_OPENAI_NOT_CONFIGURED",
      "OPENAI_API_KEY is not configured on the AI gateway",
    );
  }

  const model = normalizeModel(process.env.BOURBAKI_OPENAI_IMAGE_MODEL);
  const quality = normalizeQuality(process.env.BOURBAKI_OPENAI_IMAGE_QUALITY);
  const prompt = buildBourbakiOpenAiPrompt(input);
  const client = new OpenAI({ apiKey });

  try {
    const response = await client.images.edit({
      model,
      image: createFabricFile(input.fabricSwatch),
      prompt,
      size: OUTPUT_SIZE,
      quality,
      background: "opaque",
      output_format: OUTPUT_FORMAT,
      output_compression: OUTPUT_COMPRESSION,
    });

    const data = typeof response?.data?.[0]?.b64_json === "string"
      ? response.data[0].b64_json
      : "";

    if (!data) {
      const error = new Error("OpenAI did not return image data");
      error.code = "BOURBAKI_OPENAI_INVALID_RESPONSE";
      throw error;
    }

    return {
      provider: "openai",
      model,
      promptVersion: BOURBAKI_OPENAI_RENDER_PROMPT_VERSION,
      configurationHash: input.configurationHash,
      mimeType: "image/webp",
      data,
      output: {
        size: OUTPUT_SIZE,
        format: OUTPUT_FORMAT,
        quality,
      },
    };
  } catch (error) {
    throw normalizeOpenAiError(error);
  }
}
