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
  assert.match(prompt, /dark-indigo tailored jeans/i);
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
});
