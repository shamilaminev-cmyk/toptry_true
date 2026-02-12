import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { ensureBucket, putDataUrl, getObjectStream } from "./storage.mjs";
import { getPrisma, getPublicUserById } from "./db.mjs";
import {
  authMiddleware,
  requireAuth,
  getAuthConfig,
  registerUser,
  loginUser,
  signSession,
} from "./auth.mjs";
import sharp from "sharp";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });

const PORT = Number(process.env.API_PORT || 5174);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  // Server can still start (so the app boots), but AI endpoints will error.
  console.warn(
    "[toptry] GEMINI_API_KEY is not set. AI endpoints will return 500."
  );
}
function normalizeBaseUrl(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function proxyJsonPost(upstreamUrl, bodyObj) {
  const resp = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(bodyObj ?? {}),
  });

  const text = await resp.text(); // ВАЖНО: не трогаем ответ
  return { resp, text };
}

const app = express();

function absUrlFromReq(req, url) {
  if (!url) return url;

  const s = String(url);

  // Уже абсолютный или data/blob
  if (/^https?:\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s)) {
    return s;
  }

  const proto =
    (req.headers["x-forwarded-proto"] || req.protocol || "https")
      .toString()
      .split(",")[0]
      .trim();

  const host =
    (req.headers["x-forwarded-host"] || req.headers.host || "")
      .toString()
      .split(",")[0]
      .trim();

  if (!host) return s;

  const origin = `${proto}://${host}`;

  if (s.startsWith("/")) return origin + s;
  return origin + "/" + s;
}


// behind nginx
app.set("trust proxy", 1);

/**
 * CORS
 * Для cross-origin cookie (toptry.ru -> api.toptry.ru):
 * - origin НЕ может быть '*'
 * - credentials: true
 * - нужно явно разрешить toptry.ru и (опционально) www/staging
 */
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "https://toptry.ru,https://www.toptry.ru,https://staging.toptry.ru"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // запросы без Origin (healthcheck, curl, server-to-server)
    if (!origin) return cb(null, true);

    

    // normalize Origin (strip spaces and trailing slash)
    const ot = String(origin).trim();
    const o = ot.endsWith("/") ? ot.slice(0, -1) : ot;
    if (allowedOrigins.includes(o)) {
      return cb(null, true);
    }

    // В проде лучше логировать и возвращать false, но так быстрее диагностировать
    return cb(new Error(`CORS blocked: ${o}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// важно: CORS должен идти ДО cookie/auth и ДО роутов
app.use(cors(corsOptions));
// и preflight
app.options("*", cors(corsOptions));

app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use(authMiddleware);

// Initialize optional infrastructure (MinIO bucket, Prisma)
(async () => {
  try {
    await ensureBucket();
  } catch (e) {
    console.warn(
      "[toptry] MinIO not available (will run without object storage):",
      e?.message || e
    );
  }
  try {
    if (process.env.DATABASE_URL) {
      // ensure prisma is reachable
      await prisma.$queryRaw`SELECT 1`;
    }
  } catch (e) {
    console.warn(
      "[toptry] Database not available (will run without DB):",
      e?.message || e
    );
  }
})();

// Basic DB connectivity check (optional)
if (!process.env.DATABASE_URL) {
  console.warn("[toptry] DATABASE_URL is not set. DB persistence is disabled.");
}

// --- try-on image normalization (speed-up) ---
const TRYON_MAX_SIDE = Number(process.env.TRYON_MAX_SIDE || 1024); // 768 = ещё быстрее
const TRYON_WEBP_QUALITY = Number(process.env.TRYON_WEBP_QUALITY || 80);

async function normalizeToWebp(buffer) {
  const out = await sharp(buffer, { failOnError: false })
    .rotate() // EXIF orientation
    .resize({
      width: TRYON_MAX_SIDE,
      height: TRYON_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: TRYON_WEBP_QUALITY })
    .toBuffer();

  return { buffer: out, mimeType: "image/webp" };
}

/**
 * Convert a remote image URL or a data URL to base64 (without data: prefix),
 * and normalize it (resize + compress) to speed up Gemini try-on.
 */
async function imageToBase64(input) {
  if (typeof input !== "string") throw new Error("Invalid image input");

  // ✅ важно: убираем пробелы/переводы строк, которые ломают new URL(...)
  const clean = input.trim();

  let buf;
  let mimeType = "image/jpeg";

  if (clean.startsWith("data:")) {
    const comma = clean.indexOf(",");
    if (comma === -1) throw new Error("Invalid data URL");

    const meta = clean.slice(0, comma);
    const raw = clean.slice(comma + 1);

    const m = meta.match(/data:([^;]+);base64/i);
    mimeType = m?.[1] || "image/png";

    buf = Buffer.from(raw, "base64");
  } else {
    // ✅ Node fetch не умеет относительные URL типа "/media/..."
    // поэтому делаем абсолютный URL через base.
    const base =
      process.env.INTERNAL_BASE_URL ||
      `http://127.0.0.1:`;

    const url =
      clean.startsWith("http://") || clean.startsWith("https://")
        ? clean
        : new URL(clean, base).toString();

    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Failed to fetch image: ${res.status} (${url})`);
    const arrayBuffer = await res.arrayBuffer();
    buf = Buffer.from(arrayBuffer);
    mimeType = res.headers.get("content-type") || "image/jpeg";
  }

  const norm = await normalizeToWebp(buf);
  return { base64: norm.buffer.toString("base64"), mimeType: norm.mimeType };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------- AUTH ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const { email, password, username } = req.body || {};
    if (!email || !password || !username) {
      return res
        .status(400)
        .json({ error: "email, password, username are required" });
    }

    const user = await registerUser({ email, password, username });

    const token = signSession(user);
    const { cookieName, cookieOptions } = getAuthConfig();
    const isProd = process.env.NODE_ENV === "production";

    // Важно для prod (toptry.ru <-> api.toptry.ru):
    // domain: .toptry.ru нужен чтобы cookie была доступна на поддоменах,
    // sameSite/secure должны быть уже в cookieOptions (проверь auth.mjs)
    res.cookie(cookieName, token, {
      ...cookieOptions,
      ...(isProd ? { domain: ".toptry.ru" } : {}),
    });

    res.json({ user });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("Unique constraint")) {
      return res.status(409).json({ error: "Email or username already exists" });
    }
    res.status(500).json({ error: msg });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) {
      return res
        .status(400)
        .json({ error: "emailOrUsername and password are required" });
    }

    const user = await loginUser({ emailOrUsername, password });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const token = signSession(user);
    const { cookieName, cookieOptions } = getAuthConfig();
    const isProd = process.env.NODE_ENV === "production";

    res.cookie(cookieName, token, {
      ...cookieOptions,
      ...(isProd ? { domain: ".toptry.ru" } : {}),
    });

    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const { cookieName } = getAuthConfig();
  const isProd = process.env.NODE_ENV === "production";

  res.clearCookie(cookieName, {
    path: "/",
    ...(isProd ? { domain: ".toptry.ru" } : {}),
  });

  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.json({ user: null });

    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const user = await p.user.findUnique({
      where: { id: req.auth.userId },
      select: {
        id: true,
        email: true,
        username: true,
        avatarUrl: true,
        isPublic: true,
        createdAt: true,
      },
    });

    res.json({ user: user || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Serve stored images from MinIO via the backend to avoid CORS issues.
 * GET /media/<key>
 */
app.get("/media/:key(*)", async (req, res) => {
  try {
    const key = req.params.key;
    const stream = await getObjectStream(key);
    if (!stream) return res.status(404).send("Storage not configured");

    if (key.endsWith(".png")) res.setHeader("Content-Type", "image/png");
    else if (key.endsWith(".webp")) res.setHeader("Content-Type", "image/webp");
    else res.setHeader("Content-Type", "image/jpeg");

    stream.on("error", (e) => {
      console.error("[toptry] media stream error", e);
      res.status(404).end();
    });
    stream.pipe(res);
  } catch (e) {
    res.status(500).send(e?.message || "media error");
  }
});

/**
 * POST /api/tryon
 */
/* POST /api/looks/create
 * Legacy alias (frontend expects this path)
 */
app.post("/api/looks/create", (req, res) => res.redirect(307, "/api/tryon"));

app.post("/api/tryon", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const { selfieDataUrl, itemImageUrls, aspectRatio } = req.body || {};
    if (
      !selfieDataUrl ||
      !Array.isArray(itemImageUrls) ||
      itemImageUrls.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "selfieDataUrl and itemImageUrls[] are required" });
    }
    if (itemImageUrls.length > 5) {
      return res.status(400).json({ error: "Maximum 5 items per try-on in MVP" });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const selfie = await imageToBase64(selfieDataUrl);
    const itemParts = await Promise.all(
      itemImageUrls.map(async (url) => {
        const img = await imageToBase64(url);
        return { inlineData: { data: img.base64, mimeType: img.mimeType } };
      })
    );

    const prompt = `Act as a professional fashion photographer and AI stylist.
I am providing a selfie of a person and images of ${itemImageUrls.length} clothing items.
Generate a high-quality studio-style catalog image of this person wearing ALL the provided items.
The person should have the same face as in the selfie.
Style: premium e-commerce, professional lighting, consistent with luxury fashion brands.
Result should be front view, clean neutral background.
Avoid brand logos and text.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: {
        parts: [
          { inlineData: { data: selfie.base64, mimeType: selfie.mimeType } },
          ...itemParts,
          { text: prompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio || "3:4",
          imageSize: "1K",
        },
      },
    });

    let imageDataUrl = "";
    const parts = response?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mt = part.inlineData.mimeType || "image/png";
        imageDataUrl = `data:${mt};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!imageDataUrl) {
      return res.status(502).json({ error: "Gemini did not return an image" });
    }

    res.json({ imageDataUrl });
  } catch (err) {
    console.error("[toptry] /api/tryon error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

/**
 * POST /api/wardrobe/extract
 */
app.post("/api/wardrobe/extract", async (req, res) => {
  try {
    const AI_PROXY_URL = normalizeBaseUrl(process.env.AI_PROXY_URL);

    if (AI_PROXY_URL) {
      try {
        const upstream = `${AI_PROXY_URL}/api/wardrobe/extract`;

        const { resp, text } = await proxyJsonPost(upstream, req.body);

        const ct = resp.headers.get("content-type");
        if (ct) res.setHeader("content-type", ct);

        res.status(resp.status).send(text);
        return; // ОЧЕНЬ ВАЖНО
      } catch (e) {
        return res.status(502).json({
          error: "AI proxy request failed",
          details: e?.message || String(e),
        });
      }
    }
    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured on the server" });
    }
    const { photoDataUrl, hintCategory, hintGender } = req.body || {};
    if (!photoDataUrl)
      return res.status(400).json({ error: "photoDataUrl is required" });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const photo = await imageToBase64(photoDataUrl);

    const cutoutPrompt = `You are an expert e-commerce catalog editor.
Remove the background and isolate ONLY the main clothing item in the photo.
Output a single product cutout centered in frame.
Requirements:
- transparent background (alpha) if possible
- front-facing view if possible
- no text, no logos, no watermark
- keep true colors
- clean edges, high-quality cutout
- output PNG
If multiple items are visible, choose the most prominent garment.`;

    const cutoutResp = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: {
        parts: [
          { inlineData: { data: photo.base64, mimeType: photo.mimeType } },
          { text: cutoutPrompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K",
        },
      },
    });
    let cutoutDataUrl = "";
    const cutoutParts = cutoutResp?.candidates?.[0]?.content?.parts || [];
    for (const part of cutoutParts) {
      if (part.inlineData?.data) {
        const mt = part.inlineData.mimeType || "image/png";
        cutoutDataUrl = `data:${mt};base64,${part.inlineData.data}`;
        break;
      }
    }
    if (!cutoutDataUrl) {
      return res.status(502).json({ error: "Gemini did not return cutout image" });
}

    const attrPrompt = `Analyze the clothing item in the image.
Return ONLY strict JSON with keys:
{
  "title": string,
  "category": one of ["Верх","Низ","Платья","Обувь","Аксессуары","Верхняя одежда"],
  "gender": one of ["MALE","FEMALE","UNISEX"],
  "tags": string[],
  "color": string,
  "material": string
}
Use Russian for title/category/tags/color/material.
If unsure, make best guess.
Hints:
- hintCategory: ${hintCategory || "none"}
- hintGender: ${hintGender || "none"}`;

    const attrResp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { data: photo.base64, mimeType: photo.mimeType } },
          { text: attrPrompt },
        ],
      },
    });

    const attrText = (attrResp?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("")
      .trim();

    let attributes = null;
    try {
      attributes = JSON.parse(attrText);
    } catch {
      const first = attrText.indexOf("{");
      const last = attrText.lastIndexOf("}");
      if (first !== -1 && last !== -1) {
        attributes = JSON.parse(attrText.slice(first, last + 1));
      }
    }

    if (!attributes) {
      attributes = {
        title: "Моя вещь",
        category: hintCategory || "Верх",
        gender: hintGender || "UNISEX",
        tags: [],
        color: "неизвестно",
        material: "неизвестно",
      };
    }

    res.json({ cutoutDataUrl, attributes });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/extract error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

/**
 * POST /api/wardrobe/save (auth required)
 */
app.post("/api/wardrobe/save", requireAuth, async (req, res) => {
  try {
    const {
      title,
      category,
      gender,
      tags,
      color,
      material,
      notes,
      originalDataUrl,
      cutoutDataUrl,
    } = req.body || {};

    const userId = req.auth.userId;
    if (!title || !category || !gender || !originalDataUrl || !cutoutDataUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const p = getPrisma();
    const storedOriginal = await putDataUrl(originalDataUrl, `users/${userId}/original`);
    const storedCutout = await putDataUrl(cutoutDataUrl, `users/${userId}/cutouts`);

    const originalRef = storedOriginal ? `/media/${storedOriginal.key}` : originalDataUrl;
    const cutoutRef = storedCutout ? `/media/${storedCutout.key}` : cutoutDataUrl;

    const id = `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (p && storedOriginal && storedCutout) {
      await p.wardrobeItem.create({
        data: {
          id,
          userId,
          title,
          category: String(category),
          gender: String(gender),
          tags: Array.isArray(tags) ? tags.map(String) : [],
          color: color ? String(color) : null,
          material: material ? String(material) : null,
          notes: notes ? String(notes) : null,
          originalKey: storedOriginal.key,
          cutoutKey: storedCutout.key,
        },
      });
    }

    const item = {
      id,
      title,
      price: 0,
      currency: "RUB",
      gender,
      category,
      sizes: ["ONE"],
      images: [cutoutRef],
      storeId: "user-upload",
      availability: true,
      isCatalog: false,
      userId,
      addedAt: new Date().toISOString(),
      sourceType: "own",
      originalImage: originalRef,
      cutoutImage: cutoutRef,
      tags: Array.isArray(tags) ? tags : [],
      color: color || undefined,
      material: material || undefined,
      notes: notes || undefined,
    };

    res.json({ item });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/save error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

/**
 * GET /api/wardrobe/list (auth required)
 */
app.get("/api/wardrobe/list", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const p = getPrisma();
    if (!p) return res.json({ items: [] });

    const rows = await p.wardrobeItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      price: 0,
      currency: "RUB",
      gender: r.gender,
      category: r.category,
      sizes: ["ONE"],
      images: [`/media/${r.cutoutKey}`],
      storeId: "user-upload",
      availability: true,
      isCatalog: false,
      userId: r.userId,
      addedAt: r.createdAt.toISOString(),
      sourceType: "own",
      originalImage: `/media/${r.originalKey}`,
      cutoutImage: `/media/${r.cutoutKey}`,
      tags: r.tags || [],
      color: r.color || undefined,
      material: r.material || undefined,
      notes: r.notes || undefined,
    }));

    res.json({ items });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/list error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

// ---------- LOOKS / SOCIAL ----------
// ... (ниже оставь без изменений, если хочешь — я продолжу весь файл до конца)
// В твоём файле дальше идёт весь блок looks/comments/follow/feed — он совместим с этим CORS.

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "toptry-api" });
});

app.listen(PORT, () => {
  console.log(`[toptry] AI server running on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
