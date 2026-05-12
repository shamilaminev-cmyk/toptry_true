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
Create a realistic fashion try-on photo.

CRITICAL IDENTITY PRESERVATION:
- Preserve the EXACT same person from the avatar image.
- Preserve facial geometry exactly.
- Preserve eyes, nose, mouth, jawline, beard, hairstyle and hairline.
- Preserve age and ethnicity.
- Preserve body proportions exactly.
- Do NOT beautify.
- Do NOT make the person more attractive.
- Do NOT change facial structure.
- The output must look like the same real human photographed in different clothing.

CRITICAL GARMENT PRESERVATION:
- Preserve the EXACT garment from the clothing reference.
- Preserve fabric texture exactly.
- Preserve stitching exactly.
- Preserve fit and silhouette exactly.
- Preserve colors exactly.
- Preserve patterns exactly.
- Preserve logos and buttons exactly.
- Do NOT redesign the garment.
- Do NOT replace the garment with similar clothing.
- Do NOT generate a new interpretation.

OUTPUT REQUIREMENTS:
- Photorealistic fashion e-commerce photo
- Front-facing standing pose
- Neutral studio background
- Full body
- Natural anatomy
- No stylization
- No cinematic effects
- No fashion editorial style
- No beauty retouching
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
