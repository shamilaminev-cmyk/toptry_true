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
  buttonConfiguration: "THREE_BUTTON",
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
  assert.equal(input.configuration.jacket.buttonConfiguration, "THREE_BUTTON");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final jacket only/i);
  assert.match(prompt, /relaxed straight or gently tapered fit/i);
  assert.match(prompt, /never read as skinny/i);
  assert.match(prompt, /minimal, subtle, natural wear/i);
  assert.match(prompt, /fully tucked cleanly into the selected companion bottom/i);
  assert.match(prompt, /dark-brown leather penny loafers/i);
  assert.match(prompt, /never suede, never tassel loafers and never Oxford shoes/i);
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /fine herringbone into a wide chevron/i);
  assert.match(prompt, /worn closed and correctly buttoned/i);
  assert.match(prompt, /must be worn closed and buttoned/i);
  assert.match(prompt, /not open or hanging apart/i);
  assert.doesNotMatch(prompt, /open and unbuttoned so its lapel roll/i);
  assert.match(prompt, /approximately 15 to 20 degrees/i);
  assert.match(prompt, /fully outside every pocket/i);
  assert.match(prompt, /ticket pocket/i);
  assert.match(prompt, /three-button construction/i);
  assert.match(prompt, /Do not use a 3-roll-2 lapel roll/i);
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
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /fine herringbone into a wide chevron/i);
});

const shirt = {
  collar: {
    type: "BUTTON_DOWN",
    stand: "HIGH",
    pointSize: "LARGE",
    contrast: true,
  },
  cuff: {
    type: "BUTTON",
    shape: "MITERED",
    buttonCount: "TWO",
    contrast: false,
  },
  placket: "HIDDEN",
  chestPocket: {
    count: "ONE",
    shape: "TRAPEZOID",
    flap: true,
  },
  yoke: {
    type: "SPLIT",
    biasCut: true,
  },
  hem: "STRAIGHT_SIDE_SLIT",
};

test("shirt defaults to tucked flannel trousers, grey socks and penny loafers", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: { shirt },
  });

  assert.equal(input.configuration.garment, "SHIRT");
  assert.equal(input.configuration.wearingStyle, "TUCKED");
  assert.equal(input.configuration.collar.type, "BUTTON_DOWN");
  assert.equal(input.configuration.cuff.shape, "MITERED");
  assert.equal(input.configuration.chestPocket.count, "ONE");

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /actual cloth for the final shirt only/i);
  assert.match(prompt, /true button-down collar/i);
  assert.match(prompt, /visibly high collar stand/i);
  assert.match(prompt, /noticeably taller than standard/i);
  assert.match(prompt, /crisp white contrast collar/i);
  assert.match(prompt, /mitered angled button cuffs/i);
  assert.match(prompt, /diagonal mitered cuff corner readable/i);
  assert.match(prompt, /hidden button placket/i);
  assert.match(prompt, /exactly one chest pocket/i);
  assert.match(prompt, /split two-piece back yoke/i);
  assert.match(prompt, /straight hem with visible short side slits/i);
  assert.match(prompt, /fully and neatly tucked into the trouser waistband/i);
  assert.match(prompt, /medium-grey flannel tailored trousers/i);
  assert.match(prompt, /solid medium-grey socks/i);
  assert.match(prompt, /dark-brown leather penny loafers with a clear penny strap/i);
  assert.match(prompt, /Never use suede, tassel loafers/i);
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
});

test("shirt honours the untucked presentation from the Bourbaki shirt builder", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: {
      wearingStyle: "UNTUCKED",
      presentation: {
        wearingStyle: "UNTUCKED",
        trousers: "DARK_BLUE_LIGHTLY_AGED_JEANS_NO_HOLES",
        socks: "DARK_BLUE_SOCKS",
        shoes: "DARK_BROWN_SUEDE_TASSEL_LOAFERS",
      },
      shirt,
    },
  });

  assert.equal(input.configuration.wearingStyle, "UNTUCKED");

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /fully untucked over the jeans/i);
  assert.match(prompt, /dark indigo-blue jeans/i);
  assert.match(prompt, /minimal, subtle, natural fading and light wear/i);
  assert.match(prompt, /rips, tears, holes, patches or heavy distressing/i);
  assert.match(prompt, /solid dark navy-blue socks/i);
  assert.match(prompt, /dark-brown suede tassel loafers/i);
  assert.match(prompt, /vamp tassels and matte suede texture/i);
  assert.match(prompt, /Never use leather penny loafers, penny straps/i);
  assert.match(prompt, /Do not use grey flannel trousers/i);
});

test("shirt accepts presentation.wearingStyle for compatible callers", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: { presentation: { wearingStyle: "UNTUCKED" }, shirt },
  });

  assert.equal(input.configuration.wearingStyle, "UNTUCKED");
});

test("shirt rejects an unknown wearing style", () => {
  assert.throws(
    () => parseBourbakiOpenAiRenderInput({
      renderPreset: "MENSWEAR_SHIRT_V1",
      fabricSwatch,
      configuration: { wearingStyle: "CASUAL", shirt },
    }),
    /INVALID_SHIRT_WEARING_STYLE/,
  );
});

test("shirt accepts French cuffs without button-cuff fields", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: {
      shirt: {
        ...shirt,
        cuff: {
          type: "FRENCH",
          shape: "FRENCH_ROUNDED",
          contrast: true,
        },
        chestPocket: { count: "NONE" },
      },
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.equal(input.configuration.cuff.type, "FRENCH");
  assert.match(prompt, /rounded French double cuffs/i);
  assert.match(prompt, /cuff corners must be visibly rounded/i);
  assert.match(prompt, /visible fold-back layer and cufflinks/i);
  assert.match(prompt, /Do not add any breast or chest pockets/i);
});


test("shirt prompt distinguishes large classic collars from spread collars", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: {
      shirt: {
        ...shirt,
        collar: {
          type: "CLASSIC",
          stand: "HIGH",
          pointSize: "LARGE",
          contrast: false,
        },
      },
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /true classic point collar/i);
  assert.match(prompt, /not a semi-spread or French spread collar/i);
  assert.match(prompt, /clearly large, elongated collar points/i);
  assert.match(prompt, /must read as larger than standard/i);
  assert.match(prompt, /do not shrink it into a standard semi-spread or French collar/i);
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

const lodenCoat = {
  type: "LODEN",
  length: "BELOW_KNEE",
  collar: "STAND",
  pocketStyle: "PATCH",
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
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /wide PEAK LAPELS/i);
  assert.match(prompt, /clearly separated wide peak lapels/i);
  assert.match(prompt, /Do not render notch lapels, shawl lapels/i);
  assert.match(prompt, /generic folded overcoat collar/i);
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


test("loden prompt enforces the correct collar, sleeve tabs and relaxed fit", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: { coat: lodenCoat },
  });

  assert.equal(input.configuration.type, "LODEN");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /stand-and-fall collar built on a collar stand/i);
  assert.match(prompt, /worn down in its natural resting position/i);
  assert.match(prompt, /not raised upright around the neck/i);
  assert.match(prompt, /must not spread broadly across the chest and shoulders/i);
  assert.match(prompt, /one sleeve tab at each cuff/i);
  assert.match(prompt, /required Loden details/i);
  assert.match(prompt, /roomy and relaxed/i);
  assert.match(prompt, /Never make it slim, fitted, body-hugging or strongly waist-suppressed/i);
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


test("two-piece suit prompt keeps the jacket open but uses the same 15 cm fabric scale anchor", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_THREE_QUARTER_OPEN_V1",
    fabricSwatch,
    configuration: {
      suitType: "TWO_PIECE",
      waistcoat: false,
      jacket,
      trousers,
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /literal final suit cloth/i);
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /fine herringbone into a wide chevron/i);
  assert.match(prompt, /The jacket is open and unbuttoned/i);
});



test("standalone jacket prompt adds quantitative pattern-scale calibration", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_JACKET_V1",
    fabricSwatch,
    configuration: { jacket, companionBottom: "GREY_TROUSERS" },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /hard physical scale anchor/i);
  assert.match(prompt, /small check into a broad sport-coat check/i);
  assert.match(prompt, /Bias strongly toward a finer, denser, smaller repeat/i);
  assert.match(prompt, /lapel width should contain several small check cells/i);
  assert.match(prompt, /One front panel should show many repeated cells/i);
  assert.match(prompt, /40% to 60% smaller than the model's default guess/i);
});

test("two-piece suit prompt also carries the stronger pattern-scale calibration", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_THREE_QUARTER_OPEN_V1",
    fabricSwatch,
    configuration: {
      suitType: "TWO_PIECE",
      waistcoat: false,
      jacket,
      trousers,
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /REFERENCE B shows approximately 15 cm of real cloth/i);
  assert.match(prompt, /small check into a broad sport-coat check/i);
  assert.match(prompt, /lapel width should contain several small check cells/i);
  assert.match(prompt, /The jacket is open and unbuttoned/i);
});



test("suit prompt adds suit-specific pattern-scale calibration", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_THREE_QUARTER_OPEN_V1",
    fabricSwatch,
    configuration: {
      suitType: "TWO_PIECE",
      waistcoat: false,
      jacket,
      trousers,
    },
  });

  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /SUIT-SPECIFIC PATTERN SCALE CALIBRATION/i);
  assert.match(prompt, /full suit gives the model too much surface area/i);
  assert.match(prompt, /not only 3 to 6 large blocks/i);
  assert.match(prompt, /each trouser thigh and each trouser lower leg/i);
  assert.match(prompt, /jacket and trousers must share exactly the same fabric scale/i);
  assert.match(prompt, /reduce the suit pattern scale again by about 50%/i);
  assert.match(prompt, /not as a loud oversized stage costume pattern/i);
});

test("shoe patina accepts a shoe reference image and keeps the source scene authoritative", () => {
  const input = parseBourbakiOpenAiRenderInput({
    renderPreset: "SHOE_PATINA_STUDIO_V1",
    referenceImage: fabricSwatch,
    configuration: {
      shoe: {
        model: "FULL_BROGUES_DAINITE",
        dye: { color: "COGNAC", note: null },
      },
    },
  });

  assert.equal(input.configuration.garment, "SHOES");
  assert.equal(input.configuration.model, "FULL_BROGUES_DAINITE");
  assert.equal(input.configuration.dye.color, "COGNAC");
  const prompt = buildBourbakiOpenAiPrompt(input);
  assert.match(prompt, /exact original Bourbaki catalog photograph/i);
  assert.match(prompt, /not a fashion image/i);
  assert.match(prompt, /do not show a person, feet, legs/i);
  assert.match(prompt, /full brogue wingtip on a Dainite sole/i);
  assert.match(prompt, /rich warm cognac hand-dyed patina/i);
  assert.match(prompt, /professionally polished/i);
  assert.match(prompt, /matte, chalky, dusty, dry, unfinished or dull like raw crust leather/i);
  assert.match(prompt, /exact same Bourbaki catalog interior/i);
  assert.match(prompt, /Do not move the pair to a generic white studio/i);
});

test("shoe patina rejects an unsupported model", () => {
  assert.throws(
    () => parseBourbakiOpenAiRenderInput({
      renderPreset: "SHOE_PATINA_STUDIO_V1",
      referenceImage: fabricSwatch,
      configuration: {
        shoe: {
          model: "PENNY_LOAFERS",
          dye: { color: "BLACK", note: null },
        },
      },
    }),
    /INVALID_SHOE_PATINA_MODEL/,
  );
});


test("default supporting trousers are full length and socks are mandatory across Bourbaki prompts", () => {
  const tuckedShirtPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: { shirt },
  }));
  assert.match(tuckedShirtPrompt, /medium-grey flannel tailored trousers/i);
  assert.match(tuckedShirtPrompt, /hems must reach the shoe collars\/top line with a slight natural tailored break/i);
  assert.match(tuckedShirtPrompt, /Dress socks are mandatory/i);
  assert.match(tuckedShirtPrompt, /solid medium-grey socks/i);
  assert.match(tuckedShirtPrompt, /No bare ankles/i);
  assert.doesNotMatch(tuckedShirtPrompt, /sit high enough above the shoe collars/i);

  const untuckedShirtPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_SHIRT_V1",
    fabricSwatch,
    configuration: { shirt, wearingStyle: "UNTUCKED" },
  }));
  assert.match(untuckedShirtPrompt, /dark indigo-blue jeans/i);
  assert.match(untuckedShirtPrompt, /solid dark navy-blue socks/i);
  assert.match(untuckedShirtPrompt, /Never crop supporting trousers or jeans above the ankle/i);

  const jacketPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_JACKET_V1",
    fabricSwatch,
    configuration: { jacket, companionBottom: "GREY_TROUSERS" },
  }));
  assert.match(jacketPrompt, /mid-grey tailored trousers/i);
  assert.match(jacketPrompt, /slight natural tailored break/i);
  assert.match(jacketPrompt, /solid medium-grey socks/i);
  assert.match(jacketPrompt, /no invisible\/no-show socks/i);

  const coatPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_COAT_V1",
    fabricSwatch,
    configuration: { coat: poloCoat },
  }));
  assert.match(coatPrompt, /dark navy suit trousers worn beneath the coat/i);
  assert.match(coatPrompt, /solid dark navy socks/i);
  assert.match(coatPrompt, /No bare ankles/i);
});

test("selected trouser garments and suits explicitly forbid sockless styling", () => {
  const trousersPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_STANDALONE_TROUSERS_V1",
    fabricSwatch,
    configuration: { trousers },
  }));
  assert.match(trousersPrompt, /Dress socks are mandatory with the standalone trousers/i);
  assert.match(trousersPrompt, /same tone as the trousers/i);
  assert.match(trousersPrompt, /Never render bare ankles/i);

  const suitPrompt = buildBourbakiOpenAiPrompt(parseBourbakiOpenAiRenderInput({
    renderPreset: "MENSWEAR_THREE_QUARTER_OPEN_V1",
    fabricSwatch,
    configuration: {
      suitType: "TWO_PIECE",
      waistcoat: false,
      jacket,
      trousers,
    },
  }));
  assert.match(suitPrompt, /Dress socks are mandatory with the suit trousers/i);
  assert.match(suitPrompt, /solid sock colour coordinated with the trouser fabric/i);
  assert.match(suitPrompt, /no-show socks or sockless styling/i);
});
