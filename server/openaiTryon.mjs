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
STRICT IDENTITY-PRESERVING VIRTUAL TRY-ON.

INPUTS:
- Image 1 is the PERSON / IDENTITY reference.
- All other images are GARMENT references.

NON-NEGOTIABLE TASK:
Create a new full-body image of the EXACT SAME PERSON from Image 1 wearing the referenced garments.

IDENTITY LOCK — HIGHEST PRIORITY:
The generated face must be recognizable as the same individual from Image 1.
Do not generate a similar-looking person.
Do not generate an idealized replacement.
Do not infer a new face.

PRESERVE EXACTLY:
- head size and head shape
- face outline and skull proportions
- forehead height
- hairline
- hair color
- hairstyle
- eyebrows
- eye shape
- eye spacing
- eyelids
- nose bridge
- nose width
- nostrils
- mouth shape
- lip shape
- expression
- cheeks
- jawline
- chin
- neck
- age
- skin texture
- facial asymmetry
- body build
- posture
- hands if visible

FORBIDDEN FACE CHANGES:
- no beautification
- no younger face
- no older face
- no slimmer face
- no stronger jaw
- no larger eyes
- no smoother skin
- no different expression
- no model-like face
- no celebrity-like face
- no stock-photo face
- no generic commercial face
- no fashion campaign retouching

GARMENT LOCK:
Use the garment references as clothing to be worn by the same person.
Preserve garment color, fabric, texture, weave, pattern, lapels, collar, cuffs, buttons, pockets, length, fit and silhouette.
Do not replace garments with similar garments.
Do not invent extra layers.
Do not add accessories that are not in Image 1 or garment references.

STYLE:
This is NOT a fashion editorial.
This is NOT a creative reinterpretation.
This is NOT a beauty portrait.
This is a virtual fitting room result.

OUTPUT:
- full body
- standing
- front-facing or close to the original pose
- neutral white background
- realistic camera photo
- minimal retouching
- no text
- no logo overlay
- no watermark

FAILURE CONDITIONS:
If the face is more attractive but less similar, the result is wrong.
If the person looks like a different man, the result is wrong.
If the clothing is beautiful but not the referenced clothing, the result is wrong.
Identity preservation is more important than visual polish.

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
