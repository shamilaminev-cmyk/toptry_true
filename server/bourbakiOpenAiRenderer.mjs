import crypto from "node:crypto";
import OpenAI from "openai";

export const BOURBAKI_OPENAI_RENDER_PROMPT_VERSION =
  "bourbaki-openai-one-shot-v6-shirt-builder";

const DEFAULT_MODEL = "gpt-image-2";
const OUTPUT_SIZE = "1152x1536";
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
  renderPreset: new Set([
    "MENSWEAR_THREE_QUARTER_OPEN_V1",
    "MENSWEAR_STANDALONE_JACKET_V1",
    "MENSWEAR_STANDALONE_TROUSERS_V1",
    "MENSWEAR_COAT_V1",
    "MENSWEAR_SHIRT_V1",
  ]),
  shirtCollar: new Set([
    "CLASSIC",
    "SEMI_FRENCH",
    "FRENCH",
    "BLUNT_ANGLE",
    "SPREAD_ANGLE",
    "ROUNDED",
    "BUTTON_DOWN",
  ]),
  shirtCollarStand: new Set(["LOW", "STANDARD", "HIGH"]),
  shirtCollarPointSize: new Set(["SMALL", "STANDARD", "INCREASED", "LARGE"]),
  shirtCuffType: new Set(["BUTTON", "FRENCH"]),
  shirtButtonCuffShape: new Set([
    "STRAIGHT",
    "MITERED",
    "SMALL_ROUND",
    "MEDIUM_ROUND",
    "LARGE_ROUND",
    "NEAPOLITAN",
    "CONICAL",
  ]),
  shirtFrenchCuffShape: new Set(["FRENCH_STRAIGHT", "FRENCH_ROUNDED"]),
  shirtCuffButtonCount: new Set(["ONE", "TWO", "THREE"]),
  shirtPlacket: new Set(["NONE", "STANDARD", "HIDDEN"]),
  shirtChestPocketCount: new Set(["NONE", "ONE", "TWO"]),
  shirtChestPocketShape: new Set([
    "WITH_CORNERS",
    "ROUNDED",
    "SQUARE",
    "TRAPEZOID",
  ]),
  shirtYoke: new Set(["ONE_PIECE", "SPLIT"]),
  shirtHem: new Set([
    "ROUND",
    "STRAIGHT",
    "CURVED_CUTOUT",
    "STRAIGHT_SIDE_SLIT",
  ]),
  coatType: new Set([
    "CHESTERFIELD",
    "POLO",
    "COVERT",
    "ULSTER",
    "RAGLAN",
    "LODEN",
    "PEACOAT",
  ]),
  coatLength: new Set([
    "ABOVE_KNEE",
    "TO_KNEE",
    "BELOW_KNEE",
    "MID_CALF",
  ]),
  coatPocketStyle: new Set(["PATCH", "WELT"]),
  coatFastening: new Set(["SINGLE_BREASTED", "DOUBLE_BREASTED"]),
  coatCollar: new Set(["TURN_DOWN", "STAND"]),
  jacketCompanionBottom: new Set([
    "DARK_BLUE_JEANS",
    "GREY_TROUSERS",
    "BEIGE_TROUSERS",
  ]),
  jacketFront: new Set(["SINGLE_BREASTED", "DOUBLE_BREASTED"]),
  buttonConfiguration: new Set([
    "THREE_ROLL_TWO",
    "TWO_BUTTON",
    "FOUR_BY_ONE",
    "SIX_BY_TWO",
  ]),
  lapels: new Set([
    "NOTCH_NARROW",
    "NOTCH_MEDIUM",
    "NOTCH_WIDE",
    "PEAK_NARROW",
    "PEAK_MEDIUM",
    "PEAK_WIDE",
  ]),
  shoulders: new Set(["SOFT", "CLASSIC", "STRUCTURED"]),
  sleeveCharacter: new Set(["CLEAN", "NEAPOLITAN_SPALLA_CAMICIA"]),
  jacketSilhouette: new Set([
    "FITTED_SHAPED",
    "CLASSIC_BALANCED",
    "RELAXED",
  ]),
  breastPocket: new Set(["STRAIGHT_WELT", "BARCHETTA", "PATCH"]),
  lowerPockets: new Set(["PATCH", "JETTED_NO_FLAP", "FLAP"]),
  lowerPocketOrientation: new Set(["STRAIGHT", "SLANTED"]),
  vent: new Set(["SINGLE", "DOUBLE", "NONE"]),
  trouserFit: new Set(["SLIM", "CLASSIC", "RELAXED"]),
  trouserRise: new Set(["LOW", "CLASSIC", "HIGH"]),
  trouserLegLine: new Set(["TAPERED", "MODERATELY_TAPERED", "STRAIGHT"]),
  trouserPleats: new Set(["NONE", "ONE", "TWO"]),
  trouserPleatDirection: new Set(["TOWARD_FLY", "TOWARD_POCKETS"]),
  waistband: new Set([
    "BELT_LOOPS",
    "SIDE_ADJUSTERS",
    "SUSPENDER_BUTTONS",
    "GURKHA",
    "HOLLYWOOD",
  ]),
  sidePockets: new Set(["SLANTED", "VERTICAL"]),
  backPockets: new Set(["NONE", "ONE", "TWO"]),
  cuffs: new Set(["TURN_UPS", "NONE"]),
  length: new Set(["SHORT", "MEDIUM", "LONG"]),
  vestNeckline: new Set(["HIGH_CLOSED", "CLASSIC"]),
  vestHem: new Set(["POINTED", "STRAIGHT"]),
  vestPockets: new Set(["NONE", "TWO_STRAIGHT", "TWO_SLANTED"]),
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

function optionalEnum(value, allowed, code, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return requiredEnum(value, allowed, code);
}

function optionalNullableEnum(value, allowed, code, fallback = null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null || value === "") {
    return null;
  }

  return requiredEnum(value, allowed, code);
}

function requiredBoolean(value, code) {
  if (typeof value !== "boolean") {
    throw inputError(code);
  }
  return value;
}

function optionalBoolean(value, code, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return requiredBoolean(value, code);
}

function optionalNullableBoolean(value, code, fallback = null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  return requiredBoolean(value, code);
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

function assertButtonConfiguration(front, buttonConfiguration) {
  const isSingleBreasted = front === "SINGLE_BREASTED";
  const valid = isSingleBreasted
    ? ["THREE_ROLL_TWO", "TWO_BUTTON"].includes(buttonConfiguration)
    : ["FOUR_BY_ONE", "SIX_BY_TWO"].includes(buttonConfiguration);

  if (!valid) {
    throw inputError("INCONSISTENT_BUTTON_CONFIGURATION");
  }
}

function parseJacket(value) {
  const jacket = requiredObject(value, "INVALID_JACKET_CONFIGURATION");
  const front = requiredEnum(
    jacket.front,
    ENUMS.jacketFront,
    "INVALID_JACKET_FRONT",
  );
  const buttonConfiguration = requiredEnum(
    jacket.buttonConfiguration,
    ENUMS.buttonConfiguration,
    "INVALID_BUTTON_CONFIGURATION",
  );
  assertButtonConfiguration(front, buttonConfiguration);

  const lowerPockets = requiredEnum(
    jacket.lowerPockets,
    ENUMS.lowerPockets,
    "INVALID_LOWER_POCKETS",
  );
  const ticketPocket = requiredBoolean(
    jacket.ticketPocket,
    "INVALID_TICKET_POCKET",
  );
  const lowerPocketOrientation = optionalNullableEnum(
    jacket.lowerPocketOrientation,
    ENUMS.lowerPocketOrientation,
    "INVALID_LOWER_POCKET_ORIENTATION",
    lowerPockets === "PATCH" ? null : "STRAIGHT",
  );

  if (lowerPockets === "PATCH" && lowerPocketOrientation !== null) {
    throw inputError("INCONSISTENT_LOWER_POCKET_ORIENTATION");
  }

  if (lowerPockets !== "PATCH" && lowerPocketOrientation === null) {
    throw inputError("INCONSISTENT_LOWER_POCKET_ORIENTATION");
  }

  if (lowerPockets === "PATCH" && ticketPocket) {
    throw inputError("INCONSISTENT_TICKET_POCKET_CONFIGURATION");
  }

  return {
    front,
    buttonConfiguration,
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
    sleeveCharacter: optionalEnum(
      jacket.sleeveCharacter,
      ENUMS.sleeveCharacter,
      "INVALID_SLEEVE_CHARACTER",
      "CLEAN",
    ),
    silhouette: requiredEnum(
      jacket.silhouette,
      ENUMS.jacketSilhouette,
      "INVALID_JACKET_SILHOUETTE",
    ),
    breastPocket: requiredEnum(
      jacket.breastPocket,
      ENUMS.breastPocket,
      "INVALID_BREAST_POCKET",
    ),
    lowerPockets,
    lowerPocketOrientation,
    ticketPocket,
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
  const pleats = optionalEnum(
    trousers.pleats,
    ENUMS.trouserPleats,
    "INVALID_TROUSER_PLEATS",
    "NONE",
  );
  const pleatDirection = optionalNullableEnum(
    trousers.pleatDirection,
    ENUMS.trouserPleatDirection,
    "INVALID_TROUSER_PLEAT_DIRECTION",
    pleats === "NONE" ? null : "TOWARD_FLY",
  );

  if (pleats === "NONE" && pleatDirection !== null) {
    throw inputError("INCONSISTENT_TROUSER_PLEAT_DIRECTION");
  }

  if (pleats !== "NONE" && pleatDirection === null) {
    throw inputError("INCONSISTENT_TROUSER_PLEAT_DIRECTION");
  }

  const backPockets = optionalEnum(
    trousers.backPockets,
    ENUMS.backPockets,
    "INVALID_TROUSER_BACK_POCKETS",
    "TWO",
  );
  const backPocketButton = optionalNullableBoolean(
    trousers.backPocketButton,
    "INVALID_TROUSER_BACK_POCKET_BUTTON",
    backPockets === "NONE" ? null : false,
  );

  if (backPockets === "NONE" && backPocketButton !== null) {
    throw inputError("INCONSISTENT_TROUSER_BACK_POCKET_BUTTON");
  }

  if (backPockets !== "NONE" && backPocketButton === null) {
    throw inputError("INCONSISTENT_TROUSER_BACK_POCKET_BUTTON");
  }

  return {
    fit: requiredEnum(
      trousers.fit,
      ENUMS.trouserFit,
      "INVALID_TROUSER_FIT",
    ),
    rise: optionalEnum(
      trousers.rise,
      ENUMS.trouserRise,
      "INVALID_TROUSER_RISE",
      "CLASSIC",
    ),
    legLine: optionalEnum(
      trousers.legLine,
      ENUMS.trouserLegLine,
      "INVALID_TROUSER_LEG_LINE",
      "MODERATELY_TAPERED",
    ),
    pleats,
    pleatDirection,
    waistband: requiredEnum(
      trousers.waistband,
      ENUMS.waistband,
      "INVALID_TROUSER_WAISTBAND",
    ),
    sidePockets: optionalEnum(
      trousers.sidePockets,
      ENUMS.sidePockets,
      "INVALID_TROUSER_SIDE_POCKETS",
      "SLANTED",
    ),
    backPockets,
    backPocketButton,
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
    watchPocket: optionalBoolean(
      trousers.watchPocket,
      "INVALID_TROUSER_WATCH_POCKET",
      false,
    ),
  };
}

function parseVest(value, waistcoat) {
  if (!waistcoat) {
    if (value !== undefined && value !== null) {
      throw inputError("INCONSISTENT_VEST_CONFIGURATION");
    }
    return null;
  }

  const vest = value === undefined || value === null
    ? {}
    : requiredObject(value, "INVALID_VEST_CONFIGURATION");

  return {
    neckline: optionalEnum(
      vest.neckline,
      ENUMS.vestNeckline,
      "INVALID_VEST_NECKLINE",
      "CLASSIC",
    ),
    hem: optionalEnum(
      vest.hem,
      ENUMS.vestHem,
      "INVALID_VEST_HEM",
      "POINTED",
    ),
    pockets: optionalEnum(
      vest.pockets,
      ENUMS.vestPockets,
      "INVALID_VEST_POCKETS",
      "TWO_STRAIGHT",
    ),
  };
}

function parseSuitConfiguration(configuration) {
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

  return {
    suitType,
    waistcoat,
    jacket: parseJacket(configuration.jacket),
    trousers: parseTrousers(configuration.trousers),
    vest: parseVest(configuration.vest, waistcoat),
  };
}

function parseStandaloneJacketConfiguration(configuration) {
  return {
    garment: "JACKET",
    companionBottom: optionalEnum(
      configuration.companionBottom,
      ENUMS.jacketCompanionBottom,
      "INVALID_JACKET_COMPANION_BOTTOM",
      "GREY_TROUSERS",
    ),
    jacket: parseJacket(configuration.jacket),
  };
}

function parseStandaloneTrousersConfiguration(configuration) {
  return {
    garment: "TROUSERS",
    trousers: parseTrousers(configuration.trousers),
  };
}

function parseShirtConfiguration(configuration) {
  const shirt = requiredObject(configuration.shirt, "INVALID_SHIRT_CONFIGURATION");
  const collar = requiredObject(shirt.collar, "INVALID_SHIRT_COLLAR");
  const cuff = requiredObject(shirt.cuff, "INVALID_SHIRT_CUFF");
  const chestPocket = requiredObject(shirt.chestPocket, "INVALID_SHIRT_CHEST_POCKET");
  const yoke = requiredObject(shirt.yoke, "INVALID_SHIRT_YOKE");

  const cuffType = requiredEnum(
    cuff.type,
    ENUMS.shirtCuffType,
    "INVALID_SHIRT_CUFF_TYPE",
  );
  const normalizedCuff = cuffType === "BUTTON"
    ? {
        type: cuffType,
        shape: requiredEnum(
          cuff.shape,
          ENUMS.shirtButtonCuffShape,
          "INVALID_SHIRT_BUTTON_CUFF_SHAPE",
        ),
        buttonCount: requiredEnum(
          cuff.buttonCount,
          ENUMS.shirtCuffButtonCount,
          "INVALID_SHIRT_CUFF_BUTTON_COUNT",
        ),
        contrast: requiredBoolean(
          cuff.contrast,
          "INVALID_SHIRT_CUFF_CONTRAST",
        ),
      }
    : {
        type: cuffType,
        shape: requiredEnum(
          cuff.shape,
          ENUMS.shirtFrenchCuffShape,
          "INVALID_SHIRT_FRENCH_CUFF_SHAPE",
        ),
        contrast: requiredBoolean(
          cuff.contrast,
          "INVALID_SHIRT_CUFF_CONTRAST",
        ),
      };

  const chestPocketCount = requiredEnum(
    chestPocket.count,
    ENUMS.shirtChestPocketCount,
    "INVALID_SHIRT_CHEST_POCKET_COUNT",
  );
  const normalizedChestPocket = chestPocketCount === "NONE"
    ? { count: chestPocketCount }
    : {
        count: chestPocketCount,
        shape: requiredEnum(
          chestPocket.shape,
          ENUMS.shirtChestPocketShape,
          "INVALID_SHIRT_CHEST_POCKET_SHAPE",
        ),
        flap: requiredBoolean(
          chestPocket.flap,
          "INVALID_SHIRT_CHEST_POCKET_FLAP",
        ),
      };

  return {
    garment: "SHIRT",
    collar: {
      type: requiredEnum(
        collar.type,
        ENUMS.shirtCollar,
        "INVALID_SHIRT_COLLAR_TYPE",
      ),
      stand: requiredEnum(
        collar.stand,
        ENUMS.shirtCollarStand,
        "INVALID_SHIRT_COLLAR_STAND",
      ),
      pointSize: requiredEnum(
        collar.pointSize,
        ENUMS.shirtCollarPointSize,
        "INVALID_SHIRT_COLLAR_POINT_SIZE",
      ),
      contrast: requiredBoolean(
        collar.contrast,
        "INVALID_SHIRT_COLLAR_CONTRAST",
      ),
    },
    cuff: normalizedCuff,
    placket: requiredEnum(
      shirt.placket,
      ENUMS.shirtPlacket,
      "INVALID_SHIRT_PLACKET",
    ),
    chestPocket: normalizedChestPocket,
    yoke: {
      type: requiredEnum(yoke.type, ENUMS.shirtYoke, "INVALID_SHIRT_YOKE_TYPE"),
      biasCut: requiredBoolean(yoke.biasCut, "INVALID_SHIRT_YOKE_BIAS_CUT"),
    },
    hem: requiredEnum(shirt.hem, ENUMS.shirtHem, "INVALID_SHIRT_HEM"),
  };
}

function parseCoatConfiguration(configuration) {
  const coat = requiredObject(configuration.coat, "INVALID_COAT_CONFIGURATION");
  const type = requiredEnum(coat.type, ENUMS.coatType, "INVALID_COAT_TYPE");
  const length = requiredEnum(coat.length, ENUMS.coatLength, "INVALID_COAT_LENGTH");

  switch (type) {
    case "CHESTERFIELD":
      return {
        garment: "COAT",
        type,
        length,
        ticketPocket: requiredBoolean(
          coat.ticketPocket,
          "INVALID_CHESTERFIELD_TICKET_POCKET",
        ),
        pocketFlap: optionalBoolean(
          coat.pocketFlap,
          "INVALID_CHESTERFIELD_POCKET_FLAP",
          false,
        ),
        contrastingVelvetCollar: requiredBoolean(
          coat.contrastingVelvetCollar,
          "INVALID_CHESTERFIELD_VELVET_COLLAR",
        ),
      };
    case "POLO":
      return {
        garment: "COAT",
        type,
        length,
        pocketStyle: requiredEnum(
          coat.pocketStyle,
          ENUMS.coatPocketStyle,
          "INVALID_POLO_POCKET_STYLE",
        ),
        pocketFlap: requiredBoolean(
          coat.pocketFlap,
          "INVALID_POLO_POCKET_FLAP",
        ),
      };
    case "COVERT":
      return {
        garment: "COAT",
        type,
        length,
        ticketPocket: requiredBoolean(
          coat.ticketPocket,
          "INVALID_COVERT_TICKET_POCKET",
        ),
        decorativeStitching: requiredBoolean(
          coat.decorativeStitching,
          "INVALID_COVERT_DECORATIVE_STITCHING",
        ),
      };
    case "ULSTER":
      return {
        garment: "COAT",
        type,
        length,
        pocketStyle: requiredEnum(
          coat.pocketStyle,
          ENUMS.coatPocketStyle,
          "INVALID_ULSTER_POCKET_STYLE",
        ),
      };
    case "RAGLAN":
      return {
        garment: "COAT",
        type,
        length,
        fastening: requiredEnum(
          coat.fastening,
          ENUMS.coatFastening,
          "INVALID_RAGLAN_FASTENING",
        ),
        pocketStyle: requiredEnum(
          coat.pocketStyle,
          ENUMS.coatPocketStyle,
          "INVALID_RAGLAN_POCKET_STYLE",
        ),
      };
    case "LODEN":
      return {
        garment: "COAT",
        type,
        length,
        collar: requiredEnum(
          coat.collar,
          ENUMS.coatCollar,
          "INVALID_LODEN_COLLAR",
        ),
        pocketStyle: requiredEnum(
          coat.pocketStyle,
          ENUMS.coatPocketStyle,
          "INVALID_LODEN_POCKET_STYLE",
        ),
      };
    case "PEACOAT":
      return { garment: "COAT", type, length };
    default:
      throw inputError("INVALID_COAT_TYPE");
  }
}

export function parseBourbakiOpenAiRenderInput(value) {
  const body = requiredObject(value, "INVALID_BODY");
  const renderPreset = requiredEnum(
    body.renderPreset,
    ENUMS.renderPreset,
    "INVALID_RENDER_PRESET",
  );
  const configuration = requiredObject(
    body.configuration,
    "INVALID_MENSWEAR_CONFIGURATION",
  );
  const fabricSwatch = parseFabricSwatch(body.fabricSwatch);
  const dryRun = body.dryRun === true;

  let normalizedConfiguration;
  switch (renderPreset) {
    case "MENSWEAR_THREE_QUARTER_OPEN_V1":
      normalizedConfiguration = parseSuitConfiguration(configuration);
      break;
    case "MENSWEAR_STANDALONE_JACKET_V1":
      normalizedConfiguration = parseStandaloneJacketConfiguration(configuration);
      break;
    case "MENSWEAR_STANDALONE_TROUSERS_V1":
      normalizedConfiguration = parseStandaloneTrousersConfiguration(configuration);
      break;
    case "MENSWEAR_COAT_V1":
      normalizedConfiguration = parseCoatConfiguration(configuration);
      break;
    case "MENSWEAR_SHIRT_V1":
      normalizedConfiguration = parseShirtConfiguration(configuration);
      break;
    default:
      throw inputError("INVALID_RENDER_PRESET");
  }

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

function buttonInstruction(front, buttonConfiguration) {
  if (front === "DOUBLE_BREASTED") {
    if (buttonConfiguration === "SIX_BY_TWO") {
      return [
        "Double-breasted 6x2 construction.",
        "There are exactly six visible exterior front buttons, arranged in two symmetrical vertical columns of three.",
        "The jacket is open, but the six-button layout must remain clearly recognisable.",
        "Do not add a seventh button, an isolated centre button, or a single-breasted closure.",
      ].join(" ");
    }

    return [
      "Double-breasted 4x1 construction.",
      "There are exactly four visible exterior front buttons, arranged in two symmetrical vertical columns of two.",
      "The jacket is open, but the 4x1 double-breasted layout must remain clearly recognisable.",
      "Do not add a fifth button, an isolated centre button, or a single-breasted closure.",
    ].join(" ");
  }

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
  const descriptions = {
    NOTCH_NARROW: "Use clearly recognisable narrow notch lapels.",
    NOTCH_MEDIUM: "Use medium-width notch lapels with a classic, balanced roll.",
    NOTCH_WIDE: "Use clearly recognisable wide notch lapels with a fuller, more expressive proportion.",
    PEAK_NARROW: "Use clearly recognisable narrow, elegant peak lapels. They must not read as notch lapels.",
    PEAK_MEDIUM: "Use clearly recognisable medium-width peak lapels. They must not read as notch lapels.",
    PEAK_WIDE: "Use clearly recognisable wide, expressive peak lapels. They must not read as notch lapels.",
  };

  return descriptions[lapels];
}

function shoulderInstruction(shoulders, sleeveCharacter) {
  const shoulder = {
    SOFT: "Use soft, natural shoulders with a relaxed, lightly padded line.",
    CLASSIC: "Use classic shoulder construction with a clean, natural tailored sleeve attachment.",
    STRUCTURED: "Use structured, pronounced shoulders with a clear shoulder-to-sleeve transition.",
  }[shoulders];

  const sleeve = sleeveCharacter === "NEAPOLITAN_SPALLA_CAMICIA"
    ? "Use a visible Neapolitan spalla camicia sleeve attachment with subtle hand-gathered sleevehead character."
    : "Keep the sleevehead clean, smooth and tailored with no visible Neapolitan gathering.";

  return `${shoulder} ${sleeve}`;
}

function silhouetteInstruction(silhouette) {
  if (silhouette === "FITTED_SHAPED") {
    return "Use a fitted, shaped silhouette with a clean suppressed waist.";
  }

  if (silhouette === "RELAXED") {
    return "Use a relaxed tailored silhouette with more ease through the body while preserving a refined jacket line.";
  }

  return "Use a classic balanced tailoring silhouette.";
}

function breastPocketInstruction(breastPocket) {
  if (breastPocket === "BARCHETTA") {
    return [
      "Render exactly one true Barchetta breast pocket on the wearer's left chest.",
      "Its welt opening must be visibly curved in a shallow boat-shaped line, not straight, almost straight, merely diagonal, or a conventional angled breast welt.",
      "The Barchetta curve must remain recognisable in the final full-length image.",
    ].join(" ");
  }

  if (breastPocket === "PATCH") {
    return [
      "Render exactly one patch breast pocket on the wearer's left chest.",
      "It must read as a true applied patch pocket rather than a welt, a flap pocket or a seam line.",
    ].join(" ");
  }

  return "Render exactly one straight welt breast pocket on the wearer's left chest.";
}

function pocketOrientationInstruction(orientation) {
  return orientation === "SLANTED"
    ? "with a clearly slanted opening"
    : "with a straight horizontal opening";
}

function lowerPocketInstruction(lowerPockets, lowerPocketOrientation, ticketPocket) {
  const ticketRule = ticketPocket
    ? [
        "Render exactly one small ticket pocket above the wearer's right lower pocket.",
        "It must follow the selected lower-pocket construction and stay clearly visible.",
      ].join(" ")
    : "A ticket pocket is forbidden. Do not add any third small pocket, flap, welt or opening above either lower pocket.";

  if (lowerPockets === "PATCH") {
    return [
      "Render exactly two lower patch pockets, one on each side.",
      ticketRule,
      "No extra flaps, no extra welts, no duplicated pockets and no additional pocket layers.",
    ].join(" ");
  }

  if (lowerPockets === "FLAP") {
    return [
      `Render exactly two lower flap pockets, one on each side, ${pocketOrientationInstruction(lowerPocketOrientation)}.`,
      ticketRule,
      "Do not replace the selected flap pockets with patch pockets or jetted pockets.",
    ].join(" ");
  }

  return [
    `Render exactly two lower jetted pockets without flaps, one on each side, ${pocketOrientationInstruction(lowerPocketOrientation)}.`,
    ticketRule,
    "No lower pocket flaps, no patch pockets, no extra welts, no duplicated pockets and no additional pocket layers.",
  ].join(" ");
}

function ventInstruction(vent) {
  if (vent === "DOUBLE") {
    return "The jacket construction includes two rear side vents.";
  }

  if (vent === "NONE") {
    return "The jacket construction has no rear vent.";
  }

  return "The jacket construction includes one single rear vent.";
}

function milaneseInstruction(selected) {
  return selected
    ? "Include one subtle Milanese buttonhole on the lapel."
    : "Do not add a Milanese buttonhole.";
}

function trouserInstruction(trousers) {
  const fit = {
    SLIM: "Use a slim, narrow tailored leg.",
    CLASSIC: "Use a classic tailored trouser silhouette with balanced ease.",
    RELAXED: "Use a slightly fuller, relaxed tailored leg with elegant drape.",
  }[trousers.fit];

  const rise = {
    LOW: "Use a lower trouser rise.",
    CLASSIC: "Use a classic mid rise.",
    HIGH: "Use a visibly high trouser rise.",
  }[trousers.rise];

  const legLine = {
    TAPERED: "Use a clearly tapered leg line.",
    MODERATELY_TAPERED: "Use a moderately tapered leg line.",
    STRAIGHT: "Use a straight leg line from thigh to hem.",
  }[trousers.legLine];

  let pleats = "Use a flat front with no pleats.";
  if (trousers.pleats === "ONE") {
    pleats = trousers.pleatDirection === "TOWARD_POCKETS"
      ? "Use one reverse pleat on each side, opening toward the side pockets."
      : "Use one forward pleat on each side, opening toward the fly.";
  } else if (trousers.pleats === "TWO") {
    pleats = trousers.pleatDirection === "TOWARD_POCKETS"
      ? "Use two reverse pleats on each side, opening toward the side pockets."
      : "Use two forward pleats on each side, opening toward the fly.";
  }

  const waistband = {
    BELT_LOOPS: "Use a trouser waistband with visible belt loops.",
    SIDE_ADJUSTERS: "Use clean side adjusters at the trouser waistband, with no belt loops.",
    SUSPENDER_BUTTONS: "Use a waistband with visible suspender buttons and no belt loops.",
    GURKHA: "Use a clearly visible Gurkha waistband with distinctive side fastening straps and buckles, no belt and no belt loops.",
    HOLLYWOOD: "Use a Hollywood waistband with a continuous extended waistband rising at the sides, with no belt loops.",
  }[trousers.waistband];

  const sidePockets = trousers.sidePockets === "VERTICAL"
    ? "Use vertical side trouser pockets."
    : "Use slanted side trouser pockets.";

  const backPockets = {
    NONE: "Do not add rear trouser pockets.",
    ONE: "Use exactly one rear trouser pocket.",
    TWO: "Use exactly two rear trouser pockets.",
  }[trousers.backPockets];

  const backPocketButton = trousers.backPockets === "NONE"
    ? ""
    : trousers.backPocketButton
      ? " The rear pocket opening(s) include visible button closure."
      : " The rear pocket opening(s) have no visible button closure.";

  const cuffs = trousers.cuffs === "TURN_UPS"
    ? "Use clearly visible turn-up cuffs at both trouser hems."
    : "Use plain trouser hems with no turn-up cuffs.";

  const length = {
    SHORT: "Use a short, clean trouser length with no break.",
    MEDIUM: "Use a medium trouser length with a neat, proportional light break.",
    LONG: "Use a longer trouser length with a clean full tailored break.",
  }[trousers.length];

  const watchPocket = trousers.watchPocket
    ? "Include one small watch pocket at the front waistband, visibly integrated into the trouser construction."
    : "Do not add a watch pocket.";

  return [
    fit,
    rise,
    legLine,
    pleats,
    waistband,
    sidePockets,
    backPockets + backPocketButton,
    cuffs,
    length,
    watchPocket,
  ].join(" ");
}

function waistcoatInstruction(waistcoat, vest) {
  if (!waistcoat) {
    return "This is a two-piece suit. Do not add a waistcoat.";
  }

  const neckline = vest.neckline === "HIGH_CLOSED"
    ? "Use a high, closed waistcoat neckline."
    : "Use a classic waistcoat neckline.";

  const hem = vest.hem === "POINTED"
    ? "Use a pointed waistcoat front hem."
    : "Use a straight waistcoat front hem.";

  const pockets = {
    NONE: "Do not add waistcoat pockets.",
    TWO_STRAIGHT: "Use exactly two straight waistcoat pockets.",
    TWO_SLANTED: "Use exactly two slanted waistcoat pockets.",
  }[vest.pockets];

  return [
    "This is a three-piece suit. A matching tailored waistcoat in the same literal fabric is required and must be visibly worn beneath the open jacket.",
    "Use a single-breasted six-button waistcoat.",
    neckline,
    hem,
    pockets,
  ].join(" ");
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

function standaloneJacketCompanionBottomInstruction(companionBottom) {
  const descriptions = {
    DARK_BLUE_JEANS: [
      "Wear dark-blue premium-denim jeans in a relaxed straight or gently tapered fit, with visible ease through the thigh, knee and calf. They must never read as skinny, spray-on or tightly clinging jeans.",
      "Allow only minimal, subtle, natural wear and faint fading at pressure points. Do not add tears, aggressive distressing, strong whiskering, contrast stitching or visible branding.",
      "The jeans are a neutral styling companion only and are not part of the bespoke order.",
    ].join(" "),
    GREY_TROUSERS: [
      "Wear neutral mid-grey tailored trousers with a clean classic line.",
      "The trousers are a neutral styling companion only and are not part of the bespoke order.",
    ].join(" "),
    BEIGE_TROUSERS: [
      "Wear light-to-medium beige tailored trousers with a clean classic line.",
      "The trousers are a neutral styling companion only and are not part of the bespoke order.",
    ].join(" "),
  };

  return descriptions[companionBottom] ?? descriptions.GREY_TROUSERS;
}

function coatLengthInstruction(length) {
  return {
    ABOVE_KNEE: "Use a short coat length ending clearly above the knee.",
    TO_KNEE: "Use a classic coat length ending at the knee.",
    BELOW_KNEE: "Use a long coat length falling clearly below the knee.",
    MID_CALF: "Use a long, formal coat length falling to mid-calf.",
  }[length];
}

function coatPocketInstruction(pocketStyle, pocketFlap = null) {
  const base = pocketStyle === "PATCH"
    ? "Use exactly two lower applied patch pockets, one on each side."
    : "Use exactly two lower welted inset pockets, one on each side.";

  if (pocketFlap === true) {
    return `${base} Each lower pocket must have a clearly visible flap.`;
  }

  if (pocketFlap === false) {
    return `${base} Do not add flaps to the lower pockets.`;
  }

  return base;
}

function coatTicketPocketInstruction(ticketPocket) {
  return ticketPocket
    ? "Add exactly one small ticket pocket above the wearer's right lower pocket. Do not add any other extra pocket."
    : "Do not add a ticket pocket or any extra small pocket.";
}

function coatConstructionInstruction(coat) {
  switch (coat.type) {
    case "CHESTERFIELD":
      return [
        "Render a formal single-breasted Chesterfield overcoat with a clean concealed fly front. It must read as a Chesterfield, not as a generic overcoat, trench coat or car coat.",
        coatLengthInstruction(coat.length),
        "Use a restrained formal collar.",
        coatPocketInstruction("WELT", coat.pocketFlap),
        coatTicketPocketInstruction(coat.ticketPocket),
        coat.contrastingVelvetCollar
          ? "Use a clearly visible black contrasting velvet collar. The velvet is a collar facing detail only; it must not replace the selected coat cloth."
          : "Use the collar in the selected coat cloth. Do not add a contrasting velvet collar.",
      ].join(" ");
    case "POLO":
      return [
        "Render a long double-breasted Polo coat. It must have a true 6x2 front with exactly six visible exterior buttons in two symmetrical columns of three, wide peak lapels, cuffed sleeves and a mandatory back martingale.",
        "The back martingale must be physically present at the waist, even if it is only partly visible in the three-quarter view. Do not omit it.",
        "Use a notably roomy, generous Polo-coat silhouette with substantial ease through the chest, waist, hips, armholes and sleeves so a full suit fits comfortably underneath. Keep the waist straight and unsuppressed. Never make it slim, fitted, body-hugging, close-cut, sharply tapered, cinched or fashion-tailored.",
        coatLengthInstruction(coat.length),
        coatPocketInstruction(coat.pocketStyle, coat.pocketFlap),
        "Do not turn this into a Chesterfield, Ulster, trench coat or generic double-breasted overcoat.",
      ].join(" ");
    case "COVERT":
      return [
        "Render a classic single-breasted Covert coat with a clean country-tailoring character. It must read as a Covert, not as a generic Chesterfield or trench coat.",
        coatLengthInstruction(coat.length),
        "Use exactly two lower welted pockets.",
        coatTicketPocketInstruction(coat.ticketPocket),
        coat.decorativeStitching
          ? "Add the traditional Covert decorative topstitching in several close parallel rows at the cuffs and lower hem. Keep it neat and restrained."
          : "Do not add decorative Covert topstitching at the cuffs or lower hem.",
      ].join(" ");
    case "ULSTER":
      return [
        "Render a long, substantial double-breasted Ulster coat with its characteristic broad Ulster collar and generous tailored volume. It must not read as a Polo coat or a generic double-breasted overcoat.",
        coatLengthInstruction(coat.length),
        coatPocketInstruction(coat.pocketStyle),
      ].join(" ");
    case "RAGLAN":
      return [
        "Render a true Raglan coat. The sleeves must use a continuous raglan construction with visible diagonal seams running from the neckline to the underarm; do not use ordinary set-in sleeves.",
        coat.fastening === "DOUBLE_BREASTED"
          ? "Use a clearly recognisable double-breasted front."
          : "Use a clearly recognisable single-breasted front.",
        coatLengthInstruction(coat.length),
        coatPocketInstruction(coat.pocketStyle),
        "Do not turn this into a Chesterfield, Polo, Ulster or generic set-in-sleeve overcoat.",
      ].join(" ");
    case "LODEN":
      return [
        "Render a true Loden coat with a roomy, practical Alpine character and an unforced relaxed line. It must not read as a formal Chesterfield or generic overcoat.",
        coatLengthInstruction(coat.length),
        coat.collar === "STAND"
          ? "Use a clearly visible stand collar that protects the neck."
          : "Use a clearly visible turn-down collar.",
        coatPocketInstruction(coat.pocketStyle),
      ].join(" ");
    case "PEACOAT":
      return [
        "Render a true classic Peacoat: a short, naval-inspired double-breasted coat with exactly six visible exterior buttons in two columns of three, broad lapels and a wide sailor-style collar.",
        "Use the fixed short Peacoat proportion; do not turn it into a long overcoat, Polo coat, Ulster or trench coat.",
        "Use clean vertical welted hand pockets and no ticket pocket, belt, martingale or extra decorative pockets.",
        "Add one adjustable sleeve cuff tab on each sleeve, each secured by exactly one visible button. The sleeve tabs are mandatory Peacoat construction details, not optional decoration.",
      ].join(" ");
    default:
      throw inputError("INVALID_COAT_TYPE");
  }
}

function coatStylingInstruction(coatType) {
  if (coatType === "PEACOAT") {
    return [
      "Wear medium-grey flannel tailored trousers, a plain white dress shirt and a dark charcoal or navy cardigan.",
      "Do not add a tie.",
      "Wear classic black leather brogue lace-up shoes. Never use loafers, sneakers, boots or suede footwear.",
    ].join(" ");
  }

  return [
    "Wear a dark navy tailored suit beneath the coat, a plain white dress shirt and a muted dark tie in navy, charcoal or dark burgundy. The tie must have no bright or loud pattern.",
    "Wear classic black leather brogue lace-up shoes. Never use loafers, sneakers, boots or suede footwear.",
  ].join(" ");
}

function shirtCollarInstruction(collar) {
  const type = {
    CLASSIC: "Use a classic point collar.",
    SEMI_FRENCH: "Use a semi-spread collar with a restrained, versatile opening.",
    FRENCH: "Use a true spread collar with a wider, more open angle.",
    BLUNT_ANGLE: "Use a blunt-angle collar with deliberately broad points.",
    SPREAD_ANGLE: "Use a pronounced cutaway spread collar.",
    ROUNDED: "Use a rounded club collar with softly rounded points.",
    BUTTON_DOWN: "Use a true button-down collar with both collar points visibly fastened by buttons.",
  }[collar.type];
  const stand = {
    LOW: "Use a low collar stand.",
    STANDARD: "Use a standard-height collar stand.",
    HIGH: "Use a high collar stand.",
  }[collar.stand];
  const pointSize = {
    SMALL: "Use short collar points.",
    STANDARD: "Use standard-length collar points.",
    INCREASED: "Use slightly elongated collar points.",
    LARGE: "Use clearly elongated large collar points.",
  }[collar.pointSize];
  const contrast = collar.contrast
    ? "Use a crisp white contrast collar. The contrast applies only to the collar; the shirt body remains the selected fabric."
    : "Make the collar from the selected shirt fabric; do not add a contrasting collar.";

  return [type, stand, pointSize, contrast].join(" ");
}

function shirtCuffInstruction(cuff) {
  const contrast = cuff.contrast
    ? "Use crisp white contrast cuffs only; the sleeves and shirt body remain the selected fabric."
    : "Make the cuffs from the selected shirt fabric; do not add contrasting cuffs.";

  if (cuff.type === "FRENCH") {
    const shape = cuff.shape === "FRENCH_ROUNDED"
      ? "Use rounded French cuffs, folded back and fastened with restrained cufflinks."
      : "Use straight French cuffs, folded back and fastened with restrained cufflinks.";
    return [shape, contrast].join(" ");
  }

  const shape = {
    STRAIGHT: "straight",
    MITERED: "mitered angled",
    SMALL_ROUND: "small rounded",
    MEDIUM_ROUND: "medium rounded",
    LARGE_ROUND: "large rounded",
    NEAPOLITAN: "Neapolitan rounded",
    CONICAL: "conical",
  }[cuff.shape];
  const count = { ONE: "one", TWO: "two", THREE: "three" }[cuff.buttonCount];
  return [
    `Use ${shape} button cuffs with exactly ${count} visible cuff button${cuff.buttonCount === "ONE" ? "" : "s"}.`,
    contrast,
  ].join(" ");
}

function shirtPlacketInstruction(placket) {
  return {
    NONE: "Use no separate front placket; the button stand is clean and seamless.",
    STANDARD: "Use a standard visible front placket with a clean row of exposed buttons.",
    HIDDEN: "Use a clean hidden button placket; do not show a conventional row of exposed front buttons.",
  }[placket];
}

function shirtChestPocketInstruction(chestPocket) {
  if (chestPocket.count === "NONE") {
    return "Do not add any breast or chest pockets.";
  }

  const location = chestPocket.count === "ONE"
    ? "Add exactly one chest pocket on the wearer's left chest."
    : "Add exactly two symmetrical chest pockets, one on each side.";
  const shape = {
    WITH_CORNERS: "with pointed lower corners",
    ROUNDED: "with rounded lower corners",
    SQUARE: "with a square lower edge",
    TRAPEZOID: "with a tapered trapezoid lower shape",
  }[chestPocket.shape];
  const flap = chestPocket.flap
    ? "Each selected chest pocket must have a visible flap."
    : "Do not add pocket flaps.";

  return [
    location,
    `Make the selected chest pocket shape ${shape}.`,
    flap,
    "Do not add any extra chest pockets.",
  ].join(" ");
}

function shirtYokeInstruction(yoke) {
  const yokeType = yoke.type === "SPLIT"
    ? "Use a split two-piece back yoke with a clearly readable centre seam."
    : "Use a one-piece back yoke without a centre seam.";
  const biasCut = yoke.biasCut
    ? "Cut the yoke on the bias relative to the shirt body; preserve the selected fabric's pattern direction accordingly."
    : "Keep the yoke on the straight grain, aligned with the shirt body.";
  return [yokeType, biasCut].join(" ");
}

function shirtHemInstruction(hem) {
  return {
    ROUND: "Use a clearly visible rounded shirttail hem.",
    STRAIGHT: "Use a clean straight hem.",
    CURVED_CUTOUT: "Use a curved hem with distinct side cut-outs.",
    STRAIGHT_SIDE_SLIT: "Use a straight hem with visible short side slits.",
  }[hem];
}

export function buildBourbakiOpenAiPrompt(input) {
  const { configuration, renderPreset } = input;

  if (renderPreset === "MENSWEAR_SHIRT_V1") {
    const shirt = configuration;

    return [
      "REFERENCE B is the fabric swatch and must be used as the literal final cloth for the selected shirt.",
      "",
      "Create one realistic full-length studio fashion image of one adult man wearing the exact bespoke shirt specified below.",
      "Important: prioritise shirt construction, visible details and exact fabric fidelity over generic styling.",
      "",
      "FABRIC FIDELITY — CRITICAL:",
      "REFERENCE B is not merely a colour reference. It is the actual cloth for the final shirt only.",
      "Use it faithfully for colour, contrast, texture, weave character, pattern visibility, and apparent scale.",
      "Treat the swatch as a close-up of the real cloth. Preserve the same realistic apparent repeat on the complete shirt. Do not enlarge, simplify, smooth out, blur, shrink, stylise or genericise the pattern.",
      "The trousers and shoes are supporting garments only. They must not use or imitate REFERENCE B.",
      "Do not show the swatch, any diagram, labels, text or logos in the final image.",
      "",
      "SHIRT CONSTRUCTION:",
      shirtCollarInstruction(shirt.collar),
      shirtCuffInstruction(shirt.cuff),
      shirtPlacketInstruction(shirt.placket),
      shirtChestPocketInstruction(shirt.chestPocket),
      shirtYokeInstruction(shirt.yoke),
      shirtHemInstruction(shirt.hem),
      "",
      "POSE AND PRESENTATION:",
      "Use a full-length three-quarter front studio view. The complete head, shirt hem, trouser hems and both shoes must be inside the frame.",
      "The model stands upright with the torso turned approximately 15 to 20 degrees away from the frontal plane. Keep the collar, placket, chest-pocket architecture, both cuffs and the hem clearly readable.",
      "Wear the shirt untucked, with the selected hem fully visible. Do not cover the shirt with a jacket, cardigan, knitwear, coat, overshirt, tie or scarf.",
      "Both arms remain relaxed naturally at the sides. Both hands must remain fully outside every pocket and must not cover the collar, placket, chest pockets, cuffs or shirt hem.",
      "The pose must remain elegant and natural, not exaggerated. Do not let hands, deep shadows or excessive drape hide the selected construction.",
      "",
      "STYLING:",
      "Wear dark charcoal tailored trousers with a clean, relaxed straight or gently tapered line. Do not use jeans, shorts, cargo trousers or casual joggers.",
      "Wear dark-brown leather penny loafers. Never use sneakers, boots, suede footwear, tassel loafers or Oxford shoes.",
      "Use a neutral, plain studio background, realistic proportions, sharp shirtmaking details and an elegant luxury menswear look.",
      "No belt ornament, jacket, neckwear, bag, watch, jewellery, visible branding, text or watermark.",
    ].join("\n");
  }

  if (renderPreset === "MENSWEAR_COAT_V1") {
    const coat = configuration;

    return [
      "REFERENCE B is the fabric swatch and must be used as the literal final cloth for the selected coat.",
      "",
      "Create one realistic full-length studio fashion image of one adult man wearing the exact tailored coat specified below.",
      "Important: prioritise the recognisable coat archetype, construction identity and fabric fidelity over stylistic interpretation.",
      "",
      "FABRIC FIDELITY — CRITICAL:",
      "REFERENCE B is not merely a colour reference. It is the actual cloth for the final coat only.",
      "Use it faithfully for colour, contrast, texture, weave character, pattern visibility, and apparent scale.",
      "Treat the swatch as a close-up of the real cloth. Preserve the same realistic apparent repeat on the complete coat. Do not enlarge, simplify, smooth out, blur, shrink, stylise or genericise the pattern.",
      "Never turn a fine check or narrow stripe into a large windowpane, broad check or oversized stripe. If the physical repeat is ambiguous in the swatch, favour a smaller, subtler realistic repeat rather than magnifying it.",
      "The suit, shirt, tie, cardigan, trousers and shoes are supporting garments only. They must not use or imitate REFERENCE B.",
      "Do not show the swatch, any diagram, labels, text or logos in the final image.",
      "",
      "COAT ARCHETYPE AND CONSTRUCTION:",
      coatConstructionInstruction(coat),
      "",
      "POSE AND PRESENTATION:",
      "Use a full-length three-quarter front studio view. The complete head, full coat length, trouser hems and both shoes must be inside the frame.",
      "The model stands upright at a slight angle to the camera, approximately 15 to 20 degrees away from the frontal plane. The pose must make the closure, collar, sleeve construction, both lower pockets and overall coat length readable.",
      "Both arms remain relaxed naturally at the sides. Both hands must remain fully outside every pocket and must not cover or pull the coat fronts, lower pockets, lapels, cuffs or closure.",
      "Wear the coat naturally fastened enough to make its selected closure and archetype unmistakable. Do not render a generic fully open overcoat that hides the fly, button arrangement or coat shape.",
      "The pose must remain elegant and natural, not exaggerated. Do not let hands, deep shadows or excessive drape hide the selected construction.",
      "",
      "STYLING:",
      coatStylingInstruction(coat.type),
      "Use a neutral, plain studio background, realistic proportions, sharp tailoring details and an elegant luxury menswear look.",
      "No pocket square, scarf, bag, watch, jewellery, belt ornament, extra outerwear, visible branding, text or watermark.",
    ].join("\n");
  }

  if (renderPreset === "MENSWEAR_STANDALONE_JACKET_V1") {
    const { jacket, companionBottom } = configuration;
    const companionBottomInstruction = standaloneJacketCompanionBottomInstruction(companionBottom);

    return [
      "REFERENCE B is the fabric swatch and must be used as the literal final cloth for the standalone jacket.",
      "",
      "Create one realistic full-length studio fashion image of one adult man wearing the exact standalone tailored jacket specified below.",
      "Important: prioritise jacket construction accuracy and exact pocket architecture over stylistic interpretation.",
      "",
      "FABRIC FIDELITY — CRITICAL:",
      "REFERENCE B is not merely a colour reference. It is the actual cloth for the final jacket only.",
      "Use it faithfully for colour, contrast, texture, weave character, pattern visibility, and apparent scale.",
      "Treat the swatch as a close-up of the real cloth. Preserve the same realistic apparent repeat on the jacket. Do not enlarge, simplify, smooth out, blur, shrink, stylise or genericise the pattern.",
      "Never turn a fine check or narrow stripe into a large windowpane, broad check or oversized stripe. If the physical repeat is ambiguous in the swatch, favour a smaller, subtler realistic repeat rather than magnifying it.",
      "The white shirt, selected companion bottom and dark-brown leather penny loafers are supporting garments only. They must not use or imitate REFERENCE B.",
      "Do not show the swatch, any diagram, labels, text or logos in the final image.",
      "",
      "JACKET CONSTRUCTION:",
      buttonInstruction(jacket.front, jacket.buttonConfiguration),
      lapelInstruction(jacket.lapels),
      shoulderInstruction(jacket.shoulders, jacket.sleeveCharacter),
      silhouetteInstruction(jacket.silhouette),
      breastPocketInstruction(jacket.breastPocket),
      lowerPocketInstruction(
        jacket.lowerPockets,
        jacket.lowerPocketOrientation,
        jacket.ticketPocket,
      ),
      ventInstruction(jacket.vent),
      milaneseInstruction(jacket.milaneseButtonhole),
      "The jacket is open and unbuttoned so its lapel roll, breast pocket and both lower pockets remain fully readable.",
      "",
      "POSE AND PRESENTATION:",
      "Use a full-length three-quarter front view. The complete head, jacket, companion bottom and both shoes must be inside the frame.",
      "The model stands upright at a slight angle to the camera, approximately 15 to 20 degrees away from the frontal plane, so the shoulder line, sleeve attachment and tailored silhouette remain visible.",
      "Keep both arms relaxed naturally at the sides. Both hands must remain fully outside every pocket and must not touch, pull or cover the jacket fronts, lower pockets or breast pocket.",
      "The pose must remain elegant and natural, not exaggerated. Do not let hands, lapels, deep shadows or excessive drape hide the selected breast pocket, lower pockets, ticket pocket or button configuration.",
      "",
      "STYLING:",
      "Wear only a plain white open-collar dress shirt without a tie, fully tucked cleanly into the selected companion bottom with no untucked shirt hem visible.",
      "Wear dark-brown leather penny loafers. They must be smooth or subtly patinated leather, never suede, never tassel loafers and never Oxford shoes.",
      companionBottomInstruction,
      "Use a neutral, plain studio background, realistic proportions, sharp tailoring details and an elegant luxury menswear look.",
      "No pocket square, scarf, watch, jewellery, belt ornament, bag, outerwear, extra accessories, visible branding, text or watermark.",
    ].join("\n");
  }

  if (renderPreset === "MENSWEAR_STANDALONE_TROUSERS_V1") {
    const { trousers } = configuration;

    return [
      "REFERENCE B is the fabric swatch and must be used as the literal final cloth for the standalone trousers.",
      "",
      "Create one realistic full-length studio fashion image of one adult man wearing the exact standalone tailored trousers specified below.",
      "Important: prioritise trouser construction accuracy and a clearly readable waistband over stylistic interpretation.",
      "",
      "FABRIC FIDELITY — CRITICAL:",
      "REFERENCE B is not merely a colour reference. It is the actual cloth for the final trousers only.",
      "Use it faithfully for colour, contrast, texture, weave character, pattern visibility, and apparent scale.",
      "Treat the swatch as a close-up of the real cloth. Preserve the same realistic apparent repeat on the trousers. Do not enlarge, simplify, smooth out, blur, shrink, stylise or genericise the pattern.",
      "Never turn a fine check or narrow stripe into a large windowpane, broad check or oversized stripe. If the physical repeat is ambiguous in the swatch, favour a smaller, subtler realistic repeat rather than magnifying it.",
      "The white shirt and dark-brown leather penny loafers are supporting garments only. They must not use or imitate REFERENCE B.",
      "Do not show the swatch, any diagram, labels, text or logos in the final image.",
      "",
      "TROUSER CONSTRUCTION:",
      trouserInstruction(trousers),
      "",
      "POSE AND PRESENTATION:",
      "Use a direct front full-length view. The complete head, shirt, waistband, trouser hems and both shoes must be inside the frame.",
      "The model stands upright facing directly toward the camera; both shoulders, hips and shoes face forward.",
      "Wear only a plain white classic dress shirt, fully tucked cleanly into the trouser waistband, without a tie or belt, and dark-brown leather penny loafers. The loafers must be smooth or subtly patinated leather, never suede, never tassel loafers and never Oxford shoes.",
      "There must be no jacket, waistcoat, knitwear, overshirt, coat, belt, scarf, bag, watch, jewellery or other accessory.",
      "Keep the waistband, closure, front pleats and side pockets unobstructed. Keep both hands relaxed at the sides.",
      "Use a neutral, plain studio background, realistic proportions, sharp tailoring details and an elegant luxury menswear look.",
      "No visible branding, text or watermark.",
    ].join("\n");
  }

  if (renderPreset !== "MENSWEAR_THREE_QUARTER_OPEN_V1") {
    throw inputError("INVALID_RENDER_PRESET");
  }

  const { jacket, trousers, vest } = configuration;

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
    buttonInstruction(jacket.front, jacket.buttonConfiguration),
    lapelInstruction(jacket.lapels),
    shoulderInstruction(jacket.shoulders, jacket.sleeveCharacter),
    silhouetteInstruction(jacket.silhouette),
    breastPocketInstruction(jacket.breastPocket),
    lowerPocketInstruction(
      jacket.lowerPockets,
      jacket.lowerPocketOrientation,
      jacket.ticketPocket,
    ),
    ventInstruction(jacket.vent),
    milaneseInstruction(jacket.milaneseButtonhole),
    "The jacket is open and unbuttoned.",
    "",
    "TROUSERS:",
    "The trousers are tailored in the same literal fabric as the jacket.",
    trouserInstruction(trousers),
    "",
    "WAISTCOAT:",
    waistcoatInstruction(configuration.waistcoat, vest),
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

export async function renderBourbakiOpenAiMenswear(input) {
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

// Keep the original gateway entry point stable. The render-v2 route still
// imports this name, while it now accepts suit and standalone menswear presets.
export const renderBourbakiOpenAiSuit = renderBourbakiOpenAiMenswear;
