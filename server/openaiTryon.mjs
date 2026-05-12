import OpenAI from "openai";

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

async function fetchAsFile(url, name) {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch ${url}: ${r.status}`);
  }

  const ab = await r.arrayBuffer();

  let mime = String(
    r.headers.get("content-type") || "image/png"
  ).toLowerCase().trim();

  if (mime === "image/jpg") {
    mime = "image/jpeg";
  }

  if (mime.includes(";")) {
    mime = mime.split(";")[0].trim();
  }

  return new File(
    [Buffer.from(ab)],
    name,
    { type: mime }
  );
}

export async function runOpenAiStrictTryon({
  selfieUrl,
  itemUrls,
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const selfieFile = await fetchAsFile(selfieUrl, "person.png");

  const itemFiles = await Promise.all(
    itemUrls.map((u, i) => fetchAsFile(u, `item-${i}.png`))
  );

  const prompt = `
IDENTITY-LOCKED VIRTUAL TRY-ON.

The FIRST image is the identity reference.
All other images are clothing references.

PRIMARY GOAL:
Generate the same real person from the FIRST image wearing the provided clothing items.

IDENTITY IS MORE IMPORTANT THAN FASHION BEAUTY.
If there is any conflict, preserve the person's identity over making the image more attractive.

CRITICAL IDENTITY RULES:
- Preserve the exact same face from the FIRST image.
- Preserve face shape, head shape and skull proportions.
- Preserve forehead height and hairline.
- Preserve hairstyle, hair color and hair density.
- Preserve eyebrows, eyes, eyelids and eye spacing.
- Preserve nose shape and nose size.
- Preserve mouth shape, lips and smile/expression.
- Preserve cheeks, jawline, chin and neck.
- Preserve beard/stubble/moustache exactly if present.
- Preserve glasses exactly if present.
- Preserve age, weight, body proportions and posture.
- Preserve facial asymmetry and natural imperfections.
- Do NOT make the person younger.
- Do NOT make the person slimmer.
- Do NOT make the person more handsome.
- Do NOT beautify.
- Do NOT smooth skin.
- Do NOT create an idealized face.
- Do NOT change expression unless absolutely required.
- The output must be recognizable as the SAME PERSON, not a similar person.

GARMENT RULES:
- Dress the same person in the clothing items from the reference images.
- Preserve garment color, fabric texture, silhouette, cut, length, lapels, buttons, zipper, pockets, collar, hood, pattern and proportions.
- Do NOT replace the garment with a similar item.
- Do NOT invent a new garment.
- Do NOT add extra accessories unless they already exist in the references.

COMPOSITION:
- Full body.
- Front-facing standing pose.
- Neutral white or light studio background.
- Realistic e-commerce try-on photo.
- Natural lighting.
- No cinematic style.
- No editorial fashion styling.
- No luxury campaign retouching.
- No text, no watermark, no logo overlay.

NEGATIVE CONSTRAINT:
A result with a beautiful but different face is a failed result.
A result with a slightly imperfect outfit but the exact same face is preferred.

`;

  const client = getOpenAiClient();

  const result = await client.images.edit({
    model: "gpt-image-1",
    image: [selfieFile, ...itemFiles],
    prompt,
    size: "1024x1536",
    quality: "medium",
  });

  return result.data[0].b64_json;
}
