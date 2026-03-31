import crypto from "node:crypto";
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

const AVATAR_BG_REMOVER_URL = process.env.AVATAR_BG_REMOVER_URL || "";

async function bgRemoveToPng(srcBuf) {
  if (!AVATAR_BG_REMOVER_URL) {
    throw new Error("AVATAR_BG_REMOVER_URL is not configured");
  }
  const resp = await fetch(`${AVATAR_BG_REMOVER_URL}/remove`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "accept": "image/png",
    },
    body: srcBuf,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`bg-remover ${resp.status}: ${t.slice(0, 200)}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
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


// ---------- PHONE AUTH HELPERS ----------
const SMSRU_API_ID = process.env.SMSRU_API_ID || "";
const OTP_SECRET = process.env.OTP_SECRET || "otp_secret_change_me";

function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  return "";
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtpCode(code) {
  return crypto.createHash("sha256").update(String(code) + OTP_SECRET).digest("hex");
}

async function sendSmsRu(phone, message) {
  if (!SMSRU_API_ID) {
    throw new Error("SMSRU_API_ID is not configured");
  }

  const url =
    "https://sms.ru/sms/send" +
    `?api_id=${encodeURIComponent(SMSRU_API_ID)}` +
    `&to=${encodeURIComponent(phone)}` +
    `&msg=${encodeURIComponent(message)}` +
    "&json=1";

  const resp = await fetch(url, { method: "GET" });
  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    throw new Error(`sms.ru http ${resp.status}`);
  }

  if (!data || (String(data.status) !== "OK" && Number(data.status_code) !== 100)) {
    throw new Error(`sms.ru send failed: ${JSON.stringify(data)}`);
  }

  return data;
}

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


app.post("/api/auth/phone/start", async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ error: "Valid phone is required" });
    }

    const existingActive = await p.phoneOtp.findFirst({
      where: {
        phone,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingActive) {
      const ageMs = Date.now() - new Date(existingActive.createdAt).getTime();
      const retryAfterSec = Math.max(0, 60 - Math.floor(ageMs / 1000));
      if (retryAfterSec > 0) {
        return res.status(429).json({
          error: "Повторная отправка кода пока недоступна",
          retryAfterSec,
        });
      }
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await p.phoneOtp.create({
      data: {
        id: "otp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        phone,
        codeHash,
        expiresAt,
      },
    });

    await sendSmsRu(phone, `Код входа TopTry: ${code}`);

    return res.json({ ok: true, retryAfterSec: 60 });
  } catch (e) {
    console.error("[toptry] /api/auth/phone/start error", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/auth/phone/verify", async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || "").trim();

    if (!phone || !code) {
      return res.status(400).json({ error: "phone and code are required" });
    }

    const otp = await p.phoneOtp.findFirst({
      where: {
        phone,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      return res.status(400).json({ error: "Код не найден" });
    }

    if (otp.expiresAt < new Date()) {
      return res.status(400).json({ error: "Срок действия кода истек" });
    }

    if ((otp.attempts || 0) >= 5) {
      return res.status(429).json({ error: "Превышено число попыток" });
    }

    const codeHash = hashOtpCode(code);

    if (otp.codeHash !== codeHash) {
      await p.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "Неверный код" });
    }

    await p.phoneOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    let user = await p.user.findUnique({
      where: { phone },
    });

    if (!user) {
      user = await p.user.create({
        data: {
          id: "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          phone,
          phoneVerifiedAt: new Date(),
        },
      });
    } else if (!user.phoneVerifiedAt) {
      user = await p.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    const token = signSession(user);
    const { cookieName, cookieOptions } = getAuthConfig();
    const isProd = process.env.NODE_ENV === "production";

    res.cookie(cookieName, token, {
      ...cookieOptions,
      ...(isProd ? { domain: ".toptry.ru" } : {}),
    });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email || null,
        username: user.username || null,
        avatarUrl: user.avatarUrl || null,
        isPublic: !!user.isPublic,
        createdAt: user.createdAt,
      },
      needsProfileCompletion: !user.username,
    });
  } catch (e) {
    console.error("[toptry] /api/auth/phone/verify error", e);
    return res.status(500).json({ error: String(e?.message || e) });
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
 * POST /api/avatar/process
 * Mandatory selfie postprocess (AUTH ONLY):
 * - remove background (bg-remover / rembg)
 * - normalize frame to 3:4 on white background
 * - store selfie + avatar in MinIO
 * - update user.avatarUrl in DB
 */
app.post("/api/avatar/process", requireAuth, async (req, res) => {
  try {
    console.warn("[toptry] avatar/process: hit", {
      userId: req.auth?.userId,
      hasPhoto: !!(req.body && req.body.photoDataUrl),
      len: (req.body && req.body.photoDataUrl && req.body.photoDataUrl.length) || 0,
    });
    console.warn("[toptry] avatar/process: AVATAR_BG_REMOVER_URL=", process.env.AVATAR_BG_REMOVER_URL || "");

    if (!AVATAR_BG_REMOVER_URL) {
      return res.status(500).json({ error: "AVATAR_BG_REMOVER_URL is not configured on the server" });
    }

    const { photoDataUrl } = req.body || {};
    if (!photoDataUrl || typeof photoDataUrl !== "string" || !photoDataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "photoDataUrl (data:) is required" });
    }

    const userId = req.auth.userId;
    const p = getPrisma();

    const srcBuf = Buffer.from(photoDataUrl.split(",")[1], "base64");

    // deterministic background removal via internal service
    const cutoutPng = await bgRemoveToPng(srcBuf);

    const cutoutRgba = await sharp(cutoutPng, { failOnError: false })
      .ensureAlpha()
      .png()
      .toBuffer();

    // auto-frame the person by alpha bbox before final normalization
    const rgbaMeta = await sharp(cutoutRgba, { failOnError: false }).metadata();
    const rw = rgbaMeta.width || 0;
    const rh = rgbaMeta.height || 0;

    let left = 0, top = 0, right = Math.max(0, rw - 1), bottom = Math.max(0, rh - 1);

    if (rw > 0 && rh > 0) {
      const alphaRaw = await sharp(cutoutRgba, { failOnError: false })
        .ensureAlpha()
        .extractChannel(3)
        .raw()
        .toBuffer();

      let minX = rw, minY = rh, maxX = -1, maxY = -1;
      for (let y = 0; y < rh; y++) {
        const row = y * rw;
        for (let x = 0; x < rw; x++) {
          if (alphaRaw[row + x] > 12) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;

        const padX = Math.round(bw * 0.08);
        const padTop = Math.round(bh * 0.06);
        const padBottom = Math.round(bh * 0.03);

        left = Math.max(0, minX - padX);
        top = Math.max(0, minY - padTop);
        right = Math.min(rw - 1, maxX + padX);
        bottom = Math.min(rh - 1, maxY + padBottom);
      }
    }

    const cropW = Math.max(1, right - left + 1);
    const cropH = Math.max(1, bottom - top + 1);

    const croppedPerson = await sharp(cutoutRgba, { failOnError: false })
      .extract({ left, top, width: cropW, height: cropH })
      .png()
      .toBuffer();

    const targetW = 768;
    const targetH = 1024;
    const personTargetH = Math.round(targetH * 0.92);

    const fittedPerson = await sharp(croppedPerson, { failOnError: false })
      .resize({
        width: targetW,
        height: personTargetH,
        fit: "inside",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    const fittedMeta = await sharp(fittedPerson, { failOnError: false }).metadata();
    const fw = fittedMeta.width || targetW;
    const fh = fittedMeta.height || personTargetH;

    const offsetLeft = Math.max(0, Math.round((targetW - fw) / 2));
    const offsetTop = Math.max(0, Math.round((targetH - fh) / 2) - Math.round(targetH * 0.02));

    const normalizedPng = await sharp({
      create: {
        width: targetW,
        height: targetH,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .composite([{ input: fittedPerson, left: offsetLeft, top: offsetTop }])
      .png()
      .toBuffer();

    const selfieDataUrlOut =
      "data:image/png;base64," + normalizedPng.toString("base64");

    const avatarPng = await sharp(normalizedPng, { failOnError: false })
      .resize(1024, 1024, { fit: "contain", background: "#ffffff" })
      .png()
      .toBuffer();

    const avatarDataUrlOut =
      "data:image/png;base64," + avatarPng.toString("base64");

    const storedSelfie = await putDataUrl(selfieDataUrlOut, `users/${userId}/selfies`);
    const storedAvatar = await putDataUrl(avatarDataUrlOut, `users/${userId}/avatars`);

    const selfieKey = storedSelfie?.key || storedSelfie;
    const avatarKey = storedAvatar?.key || storedAvatar;

    const selfieUrl = selfieKey ? `/media/${selfieKey}` : "";
    const avatarUrl = avatarKey ? `/media/${avatarKey}` : "";

    if (!selfieUrl || !avatarUrl) {
      return res.status(500).json({ error: "Failed to store avatar/selfie" });
    }

    if (p) {
      await p.user.update({ where: { id: userId }, data: { avatarUrl } });
    }

    return res.json({ selfieUrl, avatarUrl });
  } catch (err) {
    console.error("[toptry] /api/avatar/process error", err);
    return res.status(500).json({ error: err?.message || "avatar process failed" });
  }
});

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
 * POST /api/looks/create
 * Server-first create: saves look in DB/MinIO and returns persistent URLs
 */
app.post("/api/looks/create", requireAuth, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const b = req.body || {};
    const selfieDataUrl = b.selfieDataUrl;
    const itemImageUrls = b.itemImageUrls;
    const aspectRatio = b.aspectRatio;
    const sourceItems = Array.isArray(b.sourceItems) ? b.sourceItems : [];
    const itemIds = Array.isArray(b.itemIds) ? b.itemIds.map(String) : [];
    const priceBuyNowRUB = Number(b.priceBuyNowRUB || 0);

    if (!selfieDataUrl || !Array.isArray(itemImageUrls) || itemImageUrls.length === 0) {
      return res
        .status(400)
        .json({ error: "selfieDataUrl and itemImageUrls[] are required" });
    }
    if (itemImageUrls.length > 5) {
      return res.status(400).json({ error: "Maximum 5 items per try-on in MVP" });
    }

    const selfieAbs = absUrlFromReq(req, selfieDataUrl);
    const itemsAbs = itemImageUrls.map((u) => absUrlFromReq(req, u));

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const selfie = await imageToBase64(selfieAbs);
    const itemParts = await Promise.all(
      itemsAbs.map(async (url) => {
        const img = await imageToBase64(url);
        return { inlineData: { data: img.base64, mimeType: img.mimeType } };
      })
    );

    const prompt = `Act as a professional fashion photographer and AI stylist.
I am providing a selfie of a person and images of ${itemsAbs.length} clothing items.
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
    const parts = (response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) || [];
    for (const part of parts) {
      if (part && part.inlineData && part.inlineData.data) {
        const mt = (part.inlineData.mimeType || "image/png");
        imageDataUrl = "data:" + mt + ";base64," + part.inlineData.data;
        break;
      }
    }

    if (!imageDataUrl) {
      return res.status(502).json({ error: "Gemini did not return an image" });
    }

    const userId = req.auth.userId;
    const p = getPrisma();
    const storedResult = await putDataUrl(imageDataUrl, `users/${userId}/looks`);
    const resultImageKey = storedResult?.key || null;
    const resultImageUrl = resultImageKey ? `/media/${resultImageKey}` : imageDataUrl;
    const buyLinks = sourceItems
      .map((i) => i?.affiliateUrl || i?.productUrl)
      .filter(Boolean)
      .map(String);

    const id = `l-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const title = "Сгенерированный образ";

    if (p && resultImageKey) {
      await p.look.create({
        data: {
          id,
          userId,
          title,
          itemIds,
          sourceItems,
          resultImageKey,
          isPublic: false,
          aiDescription: null,
          userDescription: null,
          priceBuyNowRUB,
          buyLinks,
          likesCount: 0,
          commentsCount: 0,
        },
      });
    }

    const now = new Date();
    const look = {
      id,
      userId,
      title,
      items: itemIds,
      sourceItems,
      resultImageUrl,
      createdAt: now.toISOString(),
      isPublic: false,
      likes: 0,
      comments: 0,
      priceBuyNowRUB,
      buyLinks,
    };

    return res.json({ look });
  } catch (e) {
    console.error("[toptry] /api/looks/create error", e);
    return res.status(500).json({ error: (e && e.message) ? e.message : String(e) });
  }
});

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
        return;
      } catch (e) {
        return res.status(502).json({
          error: "AI proxy request failed",
          details: e?.message || String(e),
        });
      }
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const { photoDataUrl, hintCategory, hintGender, targetItem } = req.body || {};
    if (!photoDataUrl) {
      return res.status(400).json({ error: "photoDataUrl is required" });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const photo = await imageToBase64(photoDataUrl);

    async function cleanupCutoutDataUrl(inputDataUrl) {
      let out = inputDataUrl;
      try {
        if (AVATAR_BG_REMOVER_URL) {
          const geminiCutoutBuf = Buffer.from(String(out).split(",")[1] || "", "base64");
          const cleanedCutoutPng = await bgRemoveToPng(geminiCutoutBuf);
          const cleanedOnWhite = await sharp(cleanedCutoutPng, { failOnError: false })
            .ensureAlpha()
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer();
          out = "data:image/png;base64," + cleanedOnWhite.toString("base64");
        } else {
          const geminiCutoutBuf = Buffer.from(String(out).split(",")[1] || "", "base64");
          const cleanedOnWhite = await sharp(geminiCutoutBuf, { failOnError: false })
            .ensureAlpha()
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer();
          out = "data:image/png;base64," + cleanedOnWhite.toString("base64");
        }
      } catch (e) {
        console.warn("[toptry] wardrobe/extract post-process failed:", e?.message || e);
      }
      return out;
    }

    function parseJsonFromText(text, fallback) {
      try {
        return JSON.parse(text);
      } catch {
        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first !== -1 && last !== -1) {
          try {
            return JSON.parse(text.slice(first, last + 1));
          } catch {}
        }
      }
      return fallback;
    }

    // STEP 2: user selected a specific item -> make ONE cutout only
    if (targetItem && typeof targetItem === "object") {
      const cand = {
        title: targetItem?.title || "Моя вещь",
        category: targetItem?.category || hintCategory || "Верх",
        gender: targetItem?.gender || hintGender || "UNISEX",
        tags: Array.isArray(targetItem?.tags) ? targetItem.tags : [],
        color: targetItem?.color || "неизвестно",
        material: targetItem?.material || "неизвестно",
      };

      const cutoutPrompt = `You are an expert e-commerce catalog editor.
Extract ONLY ONE clothing item from the photo.

The target item is:
- title: ${cand.title}
- category: ${cand.category}
- gender: ${cand.gender}
- color: ${cand.color}
- material: ${cand.material}

Output a single product image centered in frame.
Requirements:
- isolate ONLY the target item
- use a SOLID PURE WHITE background
- do NOT use transparency
- do NOT use checkerboard or grid background
- front-facing view if possible
- no text, no logos, no watermark
- keep true colors
- clean edges, high-quality catalog result
- output PNG
If multiple items are visible, DO NOT choose another item.`;

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

      cutoutDataUrl = await cleanupCutoutDataUrl(cutoutDataUrl);

      return res.json({
        cutoutDataUrl,
        attributes: {
          title: cand.title,
          category: cand.category,
          gender: cand.gender,
          tags: cand.tags,
          color: cand.color,
          material: cand.material,
        },
      });
    }

    function normalizeBox(box) {
      if (!box || typeof box !== "object") return undefined;
      const toUnit = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return undefined;
        const normalized = n > 1 ? n / 1000 : n;
        return Math.max(0, Math.min(1, normalized));
      };

      const x = toUnit(box?.x);
      const y = toUnit(box?.y);
      const w = toUnit(box?.w);
      const h = toUnit(box?.h);

      if ([x, y, w, h].some((v) => v === undefined)) return undefined;
      if (w <= 0.02 || h <= 0.02) return undefined;

      const clampedW = Math.min(w, 1 - x);
      const clampedH = Math.min(h, 1 - y);
      if (clampedW <= 0.02 || clampedH <= 0.02) return undefined;

      return { x, y, w: clampedW, h: clampedH };
    }

    // STEP 1: detect candidates only
    const detectPrompt = `Analyze the photo and identify up to 4 DISTINCT wardrobe items a user may want to add to wardrobe.
Return ONLY strict JSON:
{
  "items": [
    {
      "title": string,
      "category": one of ["Верх","Низ","Платья","Обувь","Аксессуары","Верхняя одежда"],
      "gender": one of ["MALE","FEMALE","UNISEX"],
      "tags": string[],
      "color": string,
      "material": string,
      "box": {
        "x": number,
        "y": number,
        "w": number,
        "h": number
      }
    }
  ]
}
Rules:
- Use Russian for title/category/tags/color/material.
- Include only real wearable items visible in the photo.
- Items must be DISTINCT from each other.
- Do not include duplicates or near-duplicates.
- If only one meaningful item is visible, return exactly one item.
- box must tightly cover the visible item.
- box coordinates must be relative to the full image.
- Return box values as numbers in range 0..1000 where:
  - x,y = top-left corner
  - w,h = width and height
- Do not omit box unless the item truly cannot be localized.
Hints:
- hintCategory: ${hintCategory || "none"}
- hintGender: ${hintGender || "none"}`;

    const detectResp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { data: photo.base64, mimeType: photo.mimeType } },
          { text: detectPrompt },
        ],
      },
    });

    const detectText = (detectResp?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("")
      .trim();

    let items = parseJsonFromText(detectText, { items: [] })?.items || [];
    if (!Array.isArray(items)) items = [];

    const seen = new Set();
    items = items.filter((d) => {
      const key = `${String(d?.title || "").trim().toLowerCase()}|${String(d?.category || "").trim().toLowerCase()}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4).map((d) => ({
      title: d?.title || "Моя вещь",
      category: d?.category || hintCategory || "Верх",
      gender: d?.gender || hintGender || "UNISEX",
      tags: Array.isArray(d?.tags) ? d.tags : [],
      color: d?.color || "неизвестно",
      material: d?.material || "неизвестно",
      box: normalizeBox(d?.box),
    }));

    if (!items.length) {
      items = [{
        title: "Моя вещь",
        category: hintCategory || "Верх",
        gender: hintGender || "UNISEX",
        tags: [],
        color: "неизвестно",
        material: "неизвестно",
        box: undefined,
      }];
    }

    return res.json({ items });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/extract error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});


/**
 * POST /api/wardrobe/save-catalog (auth required)
 */
app.post("/api/wardrobe/save-catalog", requireAuth, async (req, res) => {
  try {
    const {
      id: externalId,
      title,
      price,
      currency,
      gender,
      category,
      images,
      storeId,
      storeName,
      brand,
      productUrl,
      affiliateUrl,
    } = req.body || {};

    const userId = req.auth.userId;
    const imageUrl = Array.isArray(images) && images[0] ? String(images[0]) : "";

    if (!title || !category || !gender || !imageUrl) {
      return res.status(400).json({ error: "Missing required catalog fields" });
    }

    const p = getPrisma();
    const id = `w-cat-${externalId || Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (p) {
      await p.wardrobeItem.create({
        data: {
          id,
          userId,
          title: String(title),
          category: String(category),
          gender: String(gender),
          tags: [],
          color: null,
          material: null,
          notes: null,
          sourceType: "catalog",
          price: Number.isFinite(Number(price)) ? Number(price) : null,
          currency: currency ? String(currency) : "RUB",
          storeId: storeId ? String(storeId) : null,
          storeName: storeName ? String(storeName) : null,
          brand: brand ? String(brand) : null,
          productUrl: productUrl ? String(productUrl) : null,
          affiliateUrl: affiliateUrl ? String(affiliateUrl) : null,
          imageUrl: imageUrl,
          originalKey: null,
          cutoutKey: null,
        },
      });
    }

    const item = {
      id,
      title,
      price: Number(price || 0),
      currency: currency || "RUB",
      gender,
      category,
      sizes: ["ONE"],
      images: [imageUrl],
      storeId: storeId || "catalog",
      storeName: storeName || undefined,
      brand: brand || undefined,
      productUrl: productUrl || undefined,
      affiliateUrl: affiliateUrl || undefined,
      availability: true,
      isCatalog: true,
      userId,
      addedAt: new Date().toISOString(),
      sourceType: "catalog",
    };

    return res.json({ item });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/save-catalog error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
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
          sourceType: "own",
          price: null,
          currency: "RUB",
          storeId: "user-upload",
          storeName: null,
          brand: null,
          productUrl: null,
          affiliateUrl: null,
          imageUrl: null,
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

    const items = rows.map((r) => {
      if (r.sourceType === "catalog") {
        return {
          id: r.id,
          title: r.title,
          price: r.price || 0,
          currency: r.currency || "RUB",
          gender: r.gender,
          category: r.category,
          sizes: ["ONE"],
          images: r.imageUrl ? [r.imageUrl] : [],
          storeId: r.storeId || "catalog",
          storeName: r.storeName || undefined,
          brand: r.brand || undefined,
          productUrl: r.productUrl || undefined,
          affiliateUrl: r.affiliateUrl || undefined,
          availability: true,
          isCatalog: true,
          userId: r.userId,
          addedAt: r.createdAt.toISOString(),
          sourceType: "catalog",
          tags: r.tags || [],
          color: r.color || undefined,
          material: r.material || undefined,
          notes: r.notes || undefined,
        };
      }

      return {
        id: r.id,
        title: r.title,
        price: 0,
        currency: "RUB",
        gender: r.gender,
        category: r.category,
        sizes: ["ONE"],
        images: r.cutoutKey ? [`/media/${r.cutoutKey}`] : [],
        storeId: "user-upload",
        availability: true,
        isCatalog: false,
        userId: r.userId,
        addedAt: r.createdAt.toISOString(),
        sourceType: "own",
        originalImage: r.originalKey ? `/media/${r.originalKey}` : undefined,
        cutoutImage: r.cutoutKey ? `/media/${r.cutoutKey}` : undefined,
        tags: r.tags || [],
        color: r.color || undefined,
        material: r.material || undefined,
        notes: r.notes || undefined,
      };
    });

    res.json({ items });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/list error", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

// ---------- LOOKS / SOCIAL ----------
// ... (ниже оставь без изменений, если хочешь — я продолжу весь файл до конца)
// В твоём файле дальше идёт весь блок looks/comments/follow/feed — он совместим с этим CORS.



// ---------- CATALOG (Admitad / Sportcourt) ----------

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
      continue;
    }

    if (ch === ';' && !q) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((v) => String(v || "").trim());
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[String(h || "").trim()] = cols[i] ?? "";
    });
    return row;
  });
}

function pickFirst(row, keys) {
  for (const key of keys) {
    const val = row?.[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }
  }
  return "";
}

function toPrice(value) {
  const s = String(value || "")
    .replace(",", ".")
    .replace(/[^\d.\-]/g, "")
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeCatalogCurrency(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s || s === "RUR") return "RUB";
  return s;
}

function normalizeCatalogGender(raw) {
  const s = String(raw || "").toLowerCase();

  const femaleRx = /(жен|female|women|woman|girl|для нее|бюстгаль|бра|лиф|бикини|купальник|юбк|плать|туник|балетк)/i;
  const maleRx = /(муж|male|men|man|boy|для него)/i;

  if (femaleRx.test(s) && !maleRx.test(s)) return "FEMALE";
  if (maleRx.test(s) && !femaleRx.test(s)) return "MALE";
  return "UNISEX";
}

function normalizeCatalogCategory(raw) {
  const s = String(raw || "").toLowerCase();

  if (/(кроссов|кед|ботин|сапог|туфл|shoe|sneaker|loafer|sandals|сандал|сланц|шлеп)/i.test(s)) {
    return "SHOES";
  }

  if (/(шапк|кепк|cap|bag|сумк|belt|ремень|очки|очк|watch|час|перчат|шарф|рюкзак|кошелек|wallet|gloves|scarf)/i.test(s)) {
    return "ACCESSORIES";
  }

  if (/(куртк|пальто|бомбер|парка|ветров|пухов|coat|jacket|blazer|жилет|vest)/i.test(s)) {
    return "JACKETS";
  }

  if (/(плать|dress)/i.test(s)) {
    return "DRESS";
  }

  if (/(брюк|джинс|trouser|pants|shorts|юбк|skirt|legging|леггин|плавки|шорты)/i.test(s)) {
    return "BOTTOMS";
  }

  if (/(футбол|майк|поло|рубаш|лонгслив|топ|худи|свитш|свитер|джемпер|кардиган|cardigan|толстовк|олимпийк|водолазк|shirt|t-shirt|tee|hoodie|sweat|bra|бюстгаль|лиф|бикини)/i.test(s)) {
    return "TOPS";
  }

  return "OTHER";
}

function normalizeCatalogDisplayCategory(raw) {
  const s = String(raw || "").toLowerCase();

  if (/(сумк|bag|клатч|тоут|шоппер|рюкзак|портфел|кошелек|wallet)/i.test(s)) {
    return "BAGS";
  }

  if (/(кроссов|кед|ботин|сапог|туфл|shoe|sneaker|loafer|sandals|сандал|сланц|шлеп)/i.test(s)) {
    return "SHOES";
  }

  if (/(куртк|пальто|бомбер|парка|ветров|пухов|coat|jacket|blazer|жилет|vest)/i.test(s)) {
    return "OUTERWEAR";
  }

  if (/(плать|dress)/i.test(s)) {
    return "DRESSES";
  }

  if (/(брюк|джинс|trouser|pants|shorts|юбк|skirt|legging|леггин|шорты)/i.test(s)) {
    return "BOTTOMS";
  }

  if (/(футбол|майк|поло|рубаш|лонгслив|топ|худи|свитш|свитер|джемпер|кардиган|cardigan|толстовк|олимпийк|водолазк|shirt|t-shirt|tee|hoodie|sweat)/i.test(s)) {
    return "TOPS";
  }

  if (/(шапк|кепк|cap|belt|ремень|очки|очк|watch|час|перчат|шарф|gloves|scarf)/i.test(s)) {
    return "ACCESSORIES";
  }

  return "ACCESSORIES";
}

function normalizeCatalogTitleForFeed(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[,/].*$/, "")
    .replace(/\b(женск(ая|ие|ий)?|мужск(ая|ие|ий)?|детск(ая|ие|ий)?)\b/g, "")
    .replace(/\b(черный|чёрный|белый|синий|розовый|бежевый|серый|коричневый|красный|зеленый|зелёный|голубой|фиолетовый|желтый|жёлтый|оранжевый)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCatalogFeedSimilarityKey(product) {
  const displayCategory = normalizeCatalogDisplayCategory([
    product?.category,
    product?.title,
    product?.brand,
  ].filter(Boolean).join(" "));
  const brand = String(product?.brand || "").toLowerCase().trim();
  const title = normalizeCatalogTitleForFeed(product?.title || "");
  return [displayCategory, brand, title].join("|");
}

function matchesCatalogRequestFilters(product, { q, displayCategory, discountOnly }) {
  const normalizedDisplayCategory = String(displayCategory || "").trim().toUpperCase();
  const productDisplayCategory = String(product?.displayCategory || "").trim().toUpperCase();

  if (normalizedDisplayCategory && productDisplayCategory !== normalizedDisplayCategory) {
    return false;
  }

  if (discountOnly) {
    const price = Number(product?.price || 0);
    const oldPrice = Number(product?.oldPrice || 0);
    if (!(oldPrice > price && price > 0)) {
      return false;
    }
  }

  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;

  const hay = [
    product?.title,
    product?.brand,
    product?.storeName,
    product?.category,
    product?.displayCategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hay.includes(needle);
}

function normalizeCatalogImageForDedupe(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+/g, "/");
}

function normalizeCatalogBrandForDedupe(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildCatalogDedupeKey(row) {
  const imageUrl = normalizeCatalogImageForDedupe(
    pickFirst(row, ["image", "imageurl", "picture", "img"])
  );
  const price = String(
    toPrice(pickFirst(row, ["price", "current_price", "price_value"])) || ""
  );
  const brand = normalizeCatalogBrandForDedupe(
    pickFirst(row, ["brand", "vendor", "manufacturer"])
  );

  return [imageUrl, brand, price].join("|");
}

function buildCatalogExternalId(row) {
  const dedupeKey = buildCatalogDedupeKey(row);
  return "dedupe-" + crypto.createHash("md5").update(dedupeKey).digest("hex");
}

function isTryOnRelevantCatalogItem(raw) {
  const s = String(raw || "").toLowerCase();

  const blocked = [
    "для мальчик", "для девоч", "детск", "подростк", "baby", "kids", "junior",
    "плаватель", "плавки", "купаль", "бикини", "пляжн",
    "крем", "спрей", "уход", "стельк", "шнурк", "космет", "чист",
    "салфет", "пропитк", "ложк", "щетк", "дезодорант", "средств",
    "губка", "краск", "воск", "очистит", "растяжит",
    "инвентарь", "мяч", "шлем", "клюш", "ракет", "велосип", "самокат",
    "ролик", "коньк", "лыж", "сноуборд", "тренаж", "гантел", "штанг",
    "турник", "палат", "спальник", "бутыл", "фляг", "коврик",
    "защит", "маск", "очки для плав", "аксессуар для обуви"
  ];

  return !blocked.some((k) => s.includes(k));
}

async function isUsableCatalogImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(parsed.protocol)) return false;
  if (![
  "sportcourt.ru",
  "www.sportcourt.ru",
  "cdn.sportmaster.ru",
  "www.rendez-vous.ru",
].includes(parsed.hostname)) return false;

  try {
    const resp = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 TopTryCatalogImport",
        "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "referer": "https://toptry.ru/",
        "range": "bytes=0-0",
      },
    });

    if (!(resp.ok || resp.status === 206)) {
      return false;
    }

    const ct = String(resp.headers.get("content-type") || "").toLowerCase();
    return ct.startsWith("image/");
  } catch {
    return false;
  }
}

app.post("/api/admin/catalog/import/sportcourt", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_SPORTCOURT_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_SPORTCOURT_FEED_URL is not set" });
    }

    const resp = await fetch(FEED_URL);
    if (!resp.ok) {
      return res.status(502).json({ error: `Feed fetch failed: ${resp.status}` });
    }

    const csv = await resp.text();
    const rows = parseCsv(csv);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "sportcourt" },
      data: { isActive: false },
    });

    for (const r of rows) {
      const title = pickFirst(r, ["name", "title", "product_name"]);
      const brand = pickFirst(r, ["brand", "vendor", "manufacturer"]);
      const imageUrl = pickFirst(r, ["image", "imageurl", "picture", "img"]);
      const productUrl = pickFirst(r, ["url", "product_url", "link"]);
      const affiliateUrl = pickFirst(r, ["deeplink", "affiliate_url", "url", "product_url", "link"]);
      const price = toPrice(pickFirst(r, ["price", "current_price", "price_value"]));
      const oldPrice = toPrice(pickFirst(r, ["oldprice", "old_price", "price_old"]));

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        skipped++;
        continue;
      }

      const hasUsableImage = await isUsableCatalogImageUrl(imageUrl);
      if (!hasUsableImage) {
        skipped++;
        continue;
      }

      const haystack = [
        title,
        brand,
        pickFirst(r, ["category", "category_name", "google_product_category"]),
        pickFirst(r, ["gender", "sex"]),
      ].join(" ");

      if (!isTryOnRelevantCatalogItem(haystack)) {
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);

      const gender = normalizeCatalogGender(haystack);
      const category = normalizeCatalogCategory(haystack);

      const data = {
        id: `cat-sportcourt-${externalId}`,
        merchant: "sportcourt",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        price,
        oldPrice,
        currency: normalizeCatalogCurrency(pickFirst(r, ["currency", "currencyId"]) || "RUB"),
        imageUrl,
        productUrl: productUrl || affiliateUrl,
        affiliateUrl,
        isActive: true,
        rawPayload: r,
      };

      const existing = await prisma.catalogProduct.findUnique({
        where: {
          merchant_externalId: {
            merchant: "sportcourt",
            externalId,
          },
        },
      });

      if (existing) {
        await prisma.catalogProduct.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await prisma.catalogProduct.create({ data });
        created++;
      }
    }

    return res.json({
      ok: true,
      merchant: "sportcourt",
      total: rows.length,
      created,
      updated,
      skipped,
      active: created + updated,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/sportcourt error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/catalog/import/sportmaster", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_SPORTMASTER_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_SPORTMASTER_FEED_URL is not set" });
    }

    const resp = await fetch(FEED_URL);
    if (!resp.ok) {
      return res.status(502).json({ error: `Feed fetch failed: ${resp.status}` });
    }

    const csv = await resp.text();
    const rows = parseCsv(csv);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "sportmaster" },
      data: { isActive: false },
    });

    for (const r of rows) {
      const title = pickFirst(r, ["name", "title", "product_name"]);
      const brand = pickFirst(r, ["brand", "vendor", "manufacturer"]);
      const imageUrl = pickFirst(r, ["image", "imageurl", "picture", "img"]);
      const productUrl = pickFirst(r, ["url", "product_url", "link"]);
      const affiliateUrl = pickFirst(r, ["deeplink", "affiliate_url", "url", "product_url", "link"]);
      const price = toPrice(pickFirst(r, ["price", "current_price", "price_value"]));
      const oldPrice = toPrice(pickFirst(r, ["oldprice", "old_price", "price_old"]));

      const rawCategory = [
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["typePrefix"]),
        pickFirst(r, ["param"]),
        title,
        brand,
      ].join(" ").toLowerCase();

      const allowKeywords = [
        "курт", "пальто", "пуховик", "ветровк",
        "футболк", "майк", "поло", "рубаш", "лонгслив",
        "толстовк", "худи", "свитшот", "свитер", "джемпер", "кардиган",
        "джинс", "брюк", "штаны", "леггин", "лосин",
        "кроссовк", "ботин", "кед", "обув", "сапог", "туфл", "лофер", "сланц", "шлеп",
        "шорт", "юбк", "плать"
      ];

      const blockKeywords = [
        "инвентарь", "мяч", "шлем", "клюш", "ракет", "велосип", "самокат",
        "ролик", "коньк", "лыж", "сноуборд", "тренаж", "гантел", "штанг",
        "турник", "палат", "спальник", "рюкзак", "бутыл", "фляг", "коврик",
        "защит", "маск", "очки", "час", "аксессуар", "перчатки хоккейные"
      ];

      const isAllowed = allowKeywords.some(k => rawCategory.includes(k));
      const isBlocked = blockKeywords.some(k => rawCategory.includes(k));

      if (!isAllowed || isBlocked) {
        skipped++;
        continue;
      }

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        skipped++;
        continue;
      }

      const hasUsableImage =
        String(imageUrl).includes("cdn.sportmaster.ru/")
          ? true
          : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        skipped++;
        continue;
      }

      const haystack = [
        title,
        brand,
        pickFirst(r, ["category", "category_name", "google_product_category"]),
        pickFirst(r, ["gender", "sex"]),
      ].join(" ");

      if (!isTryOnRelevantCatalogItem([rawCategory, haystack].join(" "))) {
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);

      const gender = normalizeCatalogGender(haystack);
      const category = normalizeCatalogCategory(haystack);

      const data = {
        id: `cat-sportmaster-${externalId}`,
        merchant: "sportmaster",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        price,
        oldPrice,
        currency: normalizeCatalogCurrency(pickFirst(r, ["currency", "currencyId"]) || "RUB"),
        imageUrl,
        productUrl: productUrl || affiliateUrl,
        affiliateUrl,
        isActive: true,
        rawPayload: r,
      };

      const existing = await prisma.catalogProduct.findUnique({
        where: {
          merchant_externalId: {
            merchant: "sportmaster",
            externalId,
          },
        },
      });

      if (existing) {
        await prisma.catalogProduct.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await prisma.catalogProduct.create({ data });
        created++;
      }
    }

    return res.json({
      ok: true,
      merchant: "sportmaster",
      total: rows.length,
      created,
      updated,
      skipped,
      active: created + updated,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/sportmaster error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/catalog/import/rendezvous", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_RENDEZVOUS_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_RENDEZVOUS_FEED_URL is not set" });
    }

    const resp = await fetch(FEED_URL);
    if (!resp.ok) {
      return res.status(502).json({ error: `Feed fetch failed: ${resp.status}` });
    }

    const csv = await resp.text();
    const rows = parseCsv(csv);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "rendezvous" },
      data: { isActive: false },
    });

    for (const r of rows) {
      const title = pickFirst(r, ["name", "title", "product_name", "model"]);
      const brand = pickFirst(r, ["brand", "vendor", "manufacturer"]);
      const imageUrl = pickFirst(r, ["image", "imageurl", "picture", "img"]);
      const productUrl = pickFirst(r, ["url", "product_url", "link"]);
      const affiliateUrl = pickFirst(r, ["deeplink", "affiliate_url", "url", "product_url", "link"]);
      const price = toPrice(pickFirst(r, ["price", "current_price", "price_value"]));
      const oldPrice = toPrice(pickFirst(r, ["oldprice", "old_price", "price_old"]));

      const rawCategory = [
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["market_category"]),
        pickFirst(r, ["typePrefix"]),
        pickFirst(r, ["param"]),
        title,
        brand,
      ].join(" ").toLowerCase();

      const allowKeywords = [
        "обув", "кроссов", "ботин", "кед", "туф", "сапог", "босонож", "лофер", "мокас", "сандал", "сланц",
        "сумк", "рюкзак", "портфел", "клатч", "тоут", "шоппер",
        "курт", "пальто", "пуховик", "плащ", "ветровк",
        "футболк", "майк", "поло", "рубаш", "лонгслив",
        "толстовк", "худи", "свитшот", "свитер", "джемпер", "кардиган",
        "джинс", "брюк", "штаны", "леггин", "лосин",
        "шорт", "юбк", "плать"
      ];

      const blockKeywords = [
        "крем", "спрей", "уход", "стельк", "шнурк", "космет", "чист",
        "салфет", "пропитк", "ложк", "щетк", "дезодорант", "средств"
      ];

      const isAllowed = allowKeywords.some(k => rawCategory.includes(k));
      const isBlocked = blockKeywords.some(k => rawCategory.includes(k));

      if (!title || !imageUrl || !affiliateUrl || price === null || !isAllowed || isBlocked) {
        skipped++;
        continue;
      }

      const hasUsableImage =
        String(imageUrl).includes("www.rendez-vous.ru/")
          ? true
          : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        skipped++;
        continue;
      }

      const haystack = [
        title,
        brand,
        pickFirst(r, ["category", "category_name", "google_product_category"]),
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["market_category"]),
        pickFirst(r, ["gender", "sex"]),
        pickFirst(r, ["param"]),
      ].join(" ");

      if (!isTryOnRelevantCatalogItem([rawCategory, haystack].join(" "))) {
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);

      const gender = normalizeCatalogGender(haystack);
      const category = normalizeCatalogCategory(haystack);

      const data = {
        id: `cat-rendezvous-${externalId}`,
        merchant: "rendezvous",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        price,
        oldPrice,
        currency: normalizeCatalogCurrency(pickFirst(r, ["currency", "currencyId"]) || "RUB"),
        imageUrl,
        productUrl: productUrl || affiliateUrl,
        affiliateUrl,
        isActive: true,
        rawPayload: r,
      };

      const existing = await prisma.catalogProduct.findUnique({
        where: {
          merchant_externalId: {
            merchant: "rendezvous",
            externalId,
          },
        },
      });

      if (existing) {
        await prisma.catalogProduct.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await prisma.catalogProduct.create({ data });
        created++;
      }
    }

    return res.json({
      ok: true,
      merchant: "rendezvous",
      total: rows.length,
      created,
      updated,
      skipped,
      active: created + updated,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/rendezvous error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});



app.get("/api/catalog/image", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) {
      return res.status(400).json({ error: "url is required" });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "invalid url" });
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return res.status(400).json({ error: "unsupported protocol" });
    }

    const allowedHosts = new Set([
      "sportcourt.ru",
      "www.sportcourt.ru",
      "cdn.sportmaster.ru",
      "www.rendez-vous.ru",
    ]);

    if (!allowedHosts.has(parsed.hostname)) {
      return res.status(403).json({ error: "host is not allowed" });
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 TopTryCatalogProxy",
        "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "referer": "https://toptry.ru/",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send("upstream image fetch failed");
    }

    const ct = upstream.headers.get("content-type") || "image/jpeg";
    const cc = upstream.headers.get("cache-control") || "public, max-age=3600";

    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", cc);

    const ab = await upstream.arrayBuffer();
    return res.send(Buffer.from(ab));
  } catch (e) {
    console.error("[toptry] /api/catalog/image error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.get("/api/catalog/products", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "40", 10), 1),
      100
    );
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    const merchant =
      typeof req.query.merchant === "string" && req.query.merchant.trim()
        ? req.query.merchant.trim().toLowerCase()
        : "";
    const gender =
      typeof req.query.gender === "string" && req.query.gender.trim()
        ? req.query.gender.trim().toUpperCase()
        : "";
    const category =
      typeof req.query.category === "string" && req.query.category.trim()
        ? req.query.category.trim().toUpperCase()
        : "";
    const displayCategory =
      typeof req.query.displayCategory === "string" && req.query.displayCategory.trim()
        ? req.query.displayCategory.trim().toUpperCase()
        : "";
    const q =
      typeof req.query.q === "string" && req.query.q.trim()
        ? req.query.q.trim()
        : "";
    const discountOnly =
      String(req.query.discountOnly || "").trim() === "1";

    const allowedMerchants = ["sportcourt", "sportmaster", "rendezvous"];

    const baseWhere = {
      isActive: true,
      ...(gender ? { gender } : {}),
      ...(category ? { category } : {}),
    };

    const mapProduct = (p) => {
      const normalizedDisplayCategory = normalizeCatalogDisplayCategory([
        p.category,
        p.title,
        p.brand,
      ].filter(Boolean).join(" "));
      const price = Number(p.price || 0);
      const oldPrice = Number(p.oldPrice || 0);
      const discountPercent =
        oldPrice > price && price > 0
          ? Math.max(1, Math.round(((oldPrice - price) / oldPrice) * 100))
          : 0;

      return {
        id: p.id,
        title: p.title,
        price,
        oldPrice: oldPrice > price ? oldPrice : undefined,
        discountPercent: discountPercent > 0 ? discountPercent : undefined,
        currency: normalizeCatalogCurrency(p.currency || "RUB"),
        gender: p.gender || "UNISEX",
        category: p.category || "OTHER",
        displayCategory: normalizedDisplayCategory,
        sizes: ["ONE"],
        images: p.imageUrl ? [p.imageUrl] : [],
        storeId: p.merchant,
        storeName:
          p.merchant === "sportmaster"
            ? "Спортмастер"
            : p.merchant === "rendezvous"
              ? "Rendez-Vous"
              : "Sportcourt",
        availability: p.isActive,
        isCatalog: true,
        brand: p.brand || undefined,
        productUrl: p.productUrl || undefined,
        affiliateUrl: p.affiliateUrl || undefined,
      };
    };

    if (merchant && allowedMerchants.includes(merchant)) {
      const where = { ...baseWhere, merchant };
      const rows = await prisma.catalogProduct.findMany({
        where,
        orderBy: { updatedAt: "desc" },
      });

      const allProducts = rows
        .map(mapProduct)
        .filter((p) => matchesCatalogRequestFilters(p, { q, displayCategory, discountOnly }));

      const products = allProducts.slice(offset, offset + limit);

      return res.json({
        products,
        total: allProducts.length,
        limit,
        offset,
        hasMore: offset + products.length < allProducts.length,
      });
    }

    const groups = await Promise.all(
      allowedMerchants.map((m) =>
        prisma.catalogProduct.findMany({
          where: { ...baseWhere, merchant: m },
          orderBy: { updatedAt: "desc" },
        })
      )
    );

    const merged = [];
    const maxGroupLen = Math.max(0, ...groups.map((g) => g.length));

    for (let i = 0; i < maxGroupLen; i++) {
      for (const group of groups) {
        if (group[i]) merged.push(group[i]);
      }
    }

    const seenKeys = new Set();
    const brandCategoryCounts = new Map();
    const primary = [];
    const overflow = [];

    for (const item of merged) {
      const similarityKey = buildCatalogFeedSimilarityKey(item);
      const normalizedDisplayCategory = normalizeCatalogDisplayCategory([
        item?.category,
        item?.title,
        item?.brand,
      ].filter(Boolean).join(" "));
      const brandCategoryKey = [
        String(item?.brand || "").toLowerCase().trim(),
        normalizedDisplayCategory,
      ].join("|");

      const currentCount = brandCategoryCounts.get(brandCategoryKey) || 0;

      if (!seenKeys.has(similarityKey) && currentCount < 2) {
        seenKeys.add(similarityKey);
        brandCategoryCounts.set(brandCategoryKey, currentCount + 1);
        primary.push(item);
      } else {
        overflow.push(item);
      }
    }

    const rankedRows = primary.concat(overflow);

    const allProducts = rankedRows
      .map(mapProduct)
      .filter((p) => matchesCatalogRequestFilters(p, { q, displayCategory, discountOnly }));

    const products = allProducts.slice(offset, offset + limit);

    return res.json({
      products,
      total: allProducts.length,
      limit,
      offset,
      hasMore: offset + products.length < allProducts.length,
    });
  } catch (e) {
    console.error("[toptry] /api/catalog/products error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});



app.get("/api/looks/my", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const p = getPrisma();
    if (!p) return res.json({ looks: [] });

    const rows = await p.look.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const looks = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      items: r.itemIds || [],
      sourceItems: r.sourceItems || [],
      resultImageUrl: r.resultImageKey ? `/media/${r.resultImageKey}` : "",
      isPublic: !!r.isPublic,
      likes: r.likesCount || 0,
      comments: r.commentsCount || 0,
      createdAt: r.createdAt.toISOString(),
      priceBuyNowRUB: r.priceBuyNowRUB || 0,
      buyLinks: r.buyLinks || [],
    }));

    return res.json({ looks });
  } catch (err) {
    console.error("[toptry] /api/looks/my error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

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
