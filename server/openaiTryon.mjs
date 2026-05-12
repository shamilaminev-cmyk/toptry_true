import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

async function fetchAsFile(url, name) {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch ${url}: ${r.status}`);
  }

  const ab = await r.arrayBuffer();

  return new File(
    [Buffer.from(ab)],
    name,
    { type: r.headers.get("content-type") || "image/png" }
  );
}

export async function runOpenAiStrictTryon({
  selfieUrl,
  itemUrls,
}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const selfieFile = await fetchAsFile(selfieUrl, "person.png");

  const itemFiles = await Promise.all(
    itemUrls.map((u, i) => fetchAsFile(u, `item-${i}.png`))
  );

  const prompt = `
Create a realistic fashion try-on photo.

STRICT REQUIREMENTS:
- Preserve the EXACT identity and facial structure of the person.
- Preserve skin tone, hairstyle, body proportions and age.
- Do NOT beautify or stylize the face.
- The generated person must look like the same real person.

GARMENT REQUIREMENTS:
- Preserve the EXACT clothing items from reference images.
- Preserve colors, fit, materials, prints, logos and proportions.
- Do not redesign or reinterpret garments.
- Do not invent new clothing details.

SCENE:
- Front-facing standing pose
- Neutral studio background
- Premium e-commerce fashion photography
- Photorealistic
`;

  const result = await client.images.edit({
    model: "gpt-image-1",
    image: [selfieFile, ...itemFiles],
    prompt,
    size: "1024x1536",
    quality: "medium",
  });

  return result.data[0].b64_json;
}
