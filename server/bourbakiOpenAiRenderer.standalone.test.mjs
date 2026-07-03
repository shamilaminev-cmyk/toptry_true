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
    configuration: { jacket },
  });

  assert.equal(input.configuration.garment, "JACKET");
  assert.equal(input.configuration.jacket.buttonConfiguration, "THREE_ROLL_TWO");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final jacket only/i);
  assert.match(prompt, /neutral mid-grey tailored trousers/i);
  assert.match(prompt, /direct front full-length view/i);
  assert.match(prompt, /ticket pocket/i);
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
