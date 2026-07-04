import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBourbakiOpenAiPrompt,
  parseBourbakiOpenAiRenderInput,
} from "./bourbakiOpenAiRenderer.mjs";

const fabricSwatch = {
  mimeType: "image/png",
  data: Buffer.from("test fabric").toString("base64"),
};

const jacket = {
  front: "SINGLE_BREASTED",
  buttonConfiguration: "THREE_ROLL_TWO",
  lapels: "NOTCH_MEDIUM",
  shoulders: "CLASSIC",
  sleeveCharacter: "CLEAN",
  silhouette: "CLASSIC_BALANCED",
  breastPocket: "BARCHETTA",
  lowerPockets: "FLAP",
  lowerPocketOrientation: "SLANTED",
  ticketPocket: true,
  vent: "DOUBLE",
  milaneseButtonhole: true,
};

const trousers = {
  fit: "CLASSIC",
  rise: "HIGH",
  legLine: "STRAIGHT",
  pleats: "TWO",
  pleatDirection: "TOWARD_POCKETS",
  waistband: "SIDE_ADJUSTERS",
  sidePockets: "VERTICAL",
  backPockets: "ONE",
  backPocketButton: true,
  cuffs: "TURN_UPS",
  length: "SHORT",
  watchPocket: true,
};

test("standalone jacket is accepted by the existing render-v2 parser", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_JACKET_V1",
    fabricSwatch,
    configuration: { jacket, companionBottom: "DARK_BLUE_JEANS" },
  });

  assert.equal(input.configuration.garment, "JACKET");
  assert.equal(input.configuration.companionBottom, "DARK_BLUE_JEANS");
  assert.equal(input.configuration.jacket.buttonConfiguration, "THREE_ROLL_TWO");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final jacket only/i);
  assert.match(prompt, /relaxed straight or gently tapered fit/i);
  assert.match(prompt, /never read as skinny/i);
  assert.match(prompt, /minimal, subtle, natural wear/i);
  assert.match(prompt, /fully tucked cleanly into the selected companion bottom/i);
  assert.match(prompt, /dark-brown leather penny loafers/i);
  assert.match(prompt, /never suede, never tassel loafers and never Oxford shoes/i);
  assert.match(prompt, /fine check or narrow stripe/i);
  assert.match(prompt, /approximately 15 to 20 degrees/i);
  assert.match(prompt, /fully outside every pocket/i);
  assert.match(prompt, /ticket pocket/i);
});

test("standalone jacket defaults its companion bottom to grey trousers", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_JACKET_V1",
    fabricSwatch,
    configuration: { jacket },
  });

  assert.equal(input.configuration.companionBottom, "GREY_TROUSERS");
  assert.match(
    buildBourbakiOpenAiPrompt(input),
    /neutral mid-grey tailored trousers/i,
  );
});

test("standalone trousers are accepted by the existing render-v2 parser", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_TROUSERS_V1",
    fabricSwatch,
    configuration: { trousers },
  });

  assert.equal(input.configuration.garment, "TROUSERS");
  assert.equal(input.configuration.trousers.waistband, "SIDE_ADJUSTERS");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final trousers only/i);
  assert.match(prompt, /fully tucked cleanly into the trouser waistband/i);
  assert.match(prompt, /There must be no jacket/i);
  assert.match(prompt, /no belt/i);
  assert.match(prompt, /dark-brown leather penny loafers/i);
  assert.match(prompt, /never suede, never tassel loafers and never Oxford shoes/i);
  assert.match(prompt, /fine check or narrow stripe/i);
});

const poloCoat = {
  type: "POLO",
  length: "BELOW_KNEE",
  pocketStyle: "PATCH",
  pocketFlap: true,
};

const chesterfieldCoat = {
  type: "CHESTERFIELD",
  length: "TO_KNEE",
  ticketPocket: false,
  pocketFlap: true,
  contrastingVelvetCollar: false,
};

test("coat is accepted by the existing render-v2 parser with its archetype contract", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: { coat: poloCoat },
  });

  assert.equal(input.configuration.garment, "COAT");
  assert.equal(input.configuration.type, "POLO");
  assert.equal(input.configuration.pocketStyle, "PATCH");

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final coat only/i);
  assert.match(prompt, /long double-breasted Polo coat/i);
  assert.match(prompt, /mandatory back martingale/i);
  assert.match(prompt, /notably roomy, generous Polo-coat silhouette/i);
  assert.match(prompt, /Never make it slim, fitted, body-hugging, close-cut/i);
  assert.match(prompt, /dark navy tailored suit/i);
  assert.match(prompt, /muted dark tie/i);
  assert.match(prompt, /black leather brogue lace-up shoes/i);
  assert.match(prompt, /fine check or narrow stripe/i);
});

test("chesterfield accepts lower pocket flaps as an archetype-specific option", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: { coat: chesterfieldCoat },
  });

  assert.equal(input.configuration.pocketFlap, true);
  assert.match(
    buildBourbakiOpenAiPrompt(input),
    /Each lower pocket must have a clearly visible flap/i,
  );
});

test("chesterfield defaults lower pocket flaps to false for existing callers", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: {
      coat: {
        type: "CHESTERFIELD",
        length: "TO_KNEE",
        ticketPocket: false,
        contrastingVelvetCollar: false,
      },
    },
  });

  assert.equal(input.configuration.pocketFlap, false);
});

test("peacoat uses its dedicated companion outfit and no tie", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: {
      coat: {
        type: "PEACOAT",
        length: "ABOVE_KNEE",
      },
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /true classic Peacoat/i);
  assert.match(prompt, /medium-grey flannel tailored trousers/i);
  assert.match(prompt, /dark charcoal or navy cardigan/i);
  assert.match(prompt, /Do not add a tie/i);
  assert.match(prompt, /one adjustable sleeve cuff tab on each sleeve/i);
  assert.match(prompt, /exactly one visible button/i);
});
