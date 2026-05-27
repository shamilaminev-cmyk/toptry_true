import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
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
import { runOpenAiStrictTryon } from "./openaiTryon.mjs";

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

const CATALOG_IMAGE_CACHE_DIR =
  process.env.CATALOG_IMAGE_CACHE_DIR || "/data/catalog-image-cache";

function getCatalogImageCachePath(rawUrl, requestedWidth) {
  const key = crypto
    .createHash("sha256")
    .update(`${String(rawUrl || "").trim()}|w=${Number(requestedWidth || 0)}`)
    .digest("hex");

  return {
    key,
    dir: path.join(CATALOG_IMAGE_CACHE_DIR, key.slice(0, 2), key.slice(2, 4)),
    filePath: path.join(CATALOG_IMAGE_CACHE_DIR, key.slice(0, 2), key.slice(2, 4), `${key}.webp`),
  };
}

async function readCatalogImageCache(rawUrl, requestedWidth) {
  if (!requestedWidth || requestedWidth <= 0) return null;

  const cache = getCatalogImageCachePath(rawUrl, requestedWidth);

  try {
    const buf = await fs.readFile(cache.filePath);
    return { ...cache, buffer: buf };
  } catch {
    return { ...cache, buffer: null };
  }
}

async function writeCatalogImageCache(cache, buffer) {
  if (!cache?.filePath || !buffer?.length) return;

  try {
    await fs.mkdir(cache.dir, { recursive: true });
    await fs.writeFile(cache.filePath, buffer);
  } catch (e) {
    console.warn("[toptry] catalog image cache write failed", e?.message || e);
  }
}


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

const AI_GATEWAY_URL = normalizeBaseUrl(process.env.AI_GATEWAY_URL || process.env.AI_PROXY_URL || "");
const AI_GATEWAY_SECRET = String(process.env.AI_GATEWAY_SECRET || process.env.PROXY_SHARED_SECRET || "").trim();

async function proxyJsonPost(upstreamUrl, bodyObj, extraHeaders = {}) {
  const resp = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(bodyObj ?? {}),
  });

  const text = await resp.text(); // ВАЖНО: не трогаем ответ
  return { resp, text };
}

function assertInternalAiRequest(req, res) {
  const expected = AI_GATEWAY_SECRET;
  if (!expected) {
    return true;
  }

  const got = String(req.headers["x-toptry-internal-secret"] || "").trim();
  if (got && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return true;
  }

  res.status(403).json({ error: "Forbidden" });
  return false;
}


function getPublicApiOriginForInternalUrls() {
  return String(
    process.env.PUBLIC_API_ORIGIN ||
    process.env.VITE_API_ORIGIN ||
    "https://api.toptry.ru"
  ).replace(/\/+$/, "");
}

function isExternalCatalogImageUrlForProxy(url) {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname.toLowerCase();

    if (u.protocol !== "http:" && u.protocol !== "https:") return false;

    // TopTry URLs are already stable and should not be wrapped again.
    if (host === "api.toptry.ru" || host === "toptry.ru" || host.endsWith(".toptry.ru")) {
      return false;
    }

    return new Set([
      "sportcourt.ru",
      "www.sportcourt.ru",
      "cdn.sportmaster.ru",
      "www.rendez-vous.ru",
      "static.rendez-vous.ru",
      "goods.thecultt.com",
      "thecultt.com",
      "www.thecultt.com",
      "remington.fashion",
      "www.remington.fashion",
    ]).has(host);
  } catch {
    return false;
  }
}

function toAiGatewayStableImageUrl(url) {
  const s = String(url || "").trim();

  if (!s) return s;
  if (s.startsWith("data:")) return s;
  if (!isExternalCatalogImageUrlForProxy(s)) return s;

  const apiOrigin = getPublicApiOriginForInternalUrls();
  return `${apiOrigin}/api/catalog/image?url=${encodeURIComponent(s)}&w=900`;
}

function toAiGatewayStableImageUrls(urls) {
  return (Array.isArray(urls) ? urls : []).map(toAiGatewayStableImageUrl);
}

function prepareAiGatewayTryonPayload(payload) {
  const p = payload || {};
  return {
    ...p,
    itemImageUrls: toAiGatewayStableImageUrls(p.itemImageUrls),
  };
}


async function callAiGatewayTryon(payload) {
  if (!AI_GATEWAY_URL) return null;

  const upstream = `${AI_GATEWAY_URL}/internal/ai/tryon`;
  const headers = AI_GATEWAY_SECRET
    ? { "x-toptry-internal-secret": AI_GATEWAY_SECRET }
    : {};

  const stablePayload = prepareAiGatewayTryonPayload(payload);

  console.log("[toptry] AI gateway payload prepared", {
    itemCount: Array.isArray(stablePayload.itemImageUrls) ? stablePayload.itemImageUrls.length : 0,
    firstItemPrefix: stablePayload.itemImageUrls?.[0]
      ? String(stablePayload.itemImageUrls[0]).slice(0, 96)
      : null,
  });

  const resp = await fetch(upstream, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(stablePayload || {}),
  });

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}

  if (!resp.ok) {
    throw new Error(`AI gateway ${resp.status}: ${(data?.error || text || "").slice(0, 500)}`);
  }

  if (!data?.imageDataUrl) {
    throw new Error("AI gateway returned no imageDataUrl");
  }

  return data.imageDataUrl;
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
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
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
      `http://127.0.0.1:5174`;

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
        sizeTop: user.sizeTop || null,
        sizeBottom: user.sizeBottom || null,
        sizeShoes: user.sizeShoes || null,
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
        sizeTop: true,
        sizeBottom: true,
        sizeShoes: true,
        isPublic: true,
        createdAt: true,
      },
    });

    res.json({ user: user || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


app.post("/api/profile/update", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { sizeTop, sizeBottom, sizeShoes } = req.body || {};

    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const normalizeSize = (v) => {
      const s = String(v || "").trim().toUpperCase();
      if (!s) return null;
      const allowed = new Set(["XS", "S", "M", "L", "XL", "XXL"]);
      return allowed.has(s) ? s : null;
    };

    const normalizeShoeSize = (v) => {
      const s = String(v || "").trim().replace(",", ".");
      if (!s) return null;
      const allowed = new Set(["35","36","37","38","39","40","41","42","43","44","45","46"]);
      return allowed.has(s) ? s : null;
    };

    const user = await p.user.update({
      where: { id: userId },
      data: {
        sizeTop: normalizeSize(sizeTop),
        sizeBottom: normalizeSize(sizeBottom),
        sizeShoes: normalizeShoeSize(sizeShoes),
      },
      select: {
        id: true,
        sizeTop: true,
        sizeBottom: true,
        sizeShoes: true,
      },
    });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("[toptry] /api/profile/update error", err);
    return res.status(500).json({ error: err?.message || "Failed to update profile" });
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


async function generateImageWithRetry(ai, payload, { primaryModel, fallbackModel, retries = 1 }) {
  let lastError;

  const tryModel = async (modelName) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const t0 = Date.now();
      try {
        const resp = await ai.models.generateContent({
          model: modelName,
          ...payload,
        });
        console.log("[toptry] Gemini image OK", {
          model: modelName,
          attempt: attempt + 1,
          ms: Date.now() - t0,
        });
        return resp;
      } catch (e) {
        lastError = e;
        const msg = String(e?.message || e);
        const retryable =
          msg.includes("503") ||
          msg.includes("Deadline expired") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("timed out");

        console.warn("[toptry] Gemini image error", {
          model: modelName,
          attempt: attempt + 1,
          ms: Date.now() - t0,
          message: msg.slice(0, 300),
          retryable,
        });

        if (!retryable || attempt == retries) break;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    return null;
  };

  const primary = await tryModel(primaryModel);
  if (primary) return primary;

  if (fallbackModel && fallbackModel !== primaryModel) {
    console.warn("[toptry] Gemini fallback model", {
      from: primaryModel,
      to: fallbackModel,
    });
    const fallback = await tryModel(fallbackModel);
    if (fallback) return fallback;
  }

  throw lastError || new Error("Gemini image generation failed");
}

async function generateTryOnImageDataUrl({ selfieDataUrl, itemImageUrls, aspectRatio, reqForAbsUrl = null }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  if (!selfieDataUrl || !Array.isArray(itemImageUrls) || itemImageUrls.length === 0) {
    const err = new Error("selfieDataUrl and itemImageUrls[] are required");
    err.statusCode = 400;
    throw err;
  }

  if (itemImageUrls.length > 5) {
    const err = new Error("Maximum 5 items per try-on in MVP");
    err.statusCode = 400;
    throw err;
  }

  const selfieAbs = reqForAbsUrl ? absUrlFromReq(reqForAbsUrl, selfieDataUrl) : selfieDataUrl;
  const itemsAbs = reqForAbsUrl ? itemImageUrls.map((u) => absUrlFromReq(reqForAbsUrl, u)) : itemImageUrls;

  console.log("[toptry] using Gemini quality try-on", {
    itemCount: itemsAbs.length,
  });

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  console.log("[debug ai/tryon] before imageToBase64", {
    selfieAbsPrefix: typeof selfieAbs === "string" ? selfieAbs.slice(0, 64) : null,
    itemsAbsCount: Array.isArray(itemsAbs) ? itemsAbs.length : null,
    firstItemAbsPrefix: Array.isArray(itemsAbs) && itemsAbs[0] ? String(itemsAbs[0]).slice(0, 64) : null,
  });

  const selfie = await imageToBase64(selfieAbs);

  console.log("[debug ai/tryon] selfie prepared", {
    mimeType: selfie?.mimeType || null,
    base64Len: selfie?.base64 ? String(selfie.base64).length : null,
  });

  const itemParts = await Promise.all(
    itemsAbs.map(async (url, idx) => {
      console.log("[debug ai/tryon] preparing item", {
        idx,
        prefix: typeof url === "string" ? url.slice(0, 64) : null,
      });
      const img = await imageToBase64(url);
      console.log("[debug ai/tryon] item prepared", {
        idx,
        mimeType: img?.mimeType || null,
        base64Len: img?.base64 ? String(img.base64).length : null,
      });
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

  const response = await generateImageWithRetry(
    ai,
    {
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
    },
    {
      primaryModel: process.env.GEMINI_MODEL_IMAGE || "gemini-3-pro-image-preview",
      fallbackModel: process.env.GEMINI_MODEL_IMAGE_FALLBACK || "gemini-2.5-flash-image",
      retries: Number(process.env.GEMINI_IMAGE_RETRIES || 1),
    }
  );

  console.log("[debug ai/tryon] Gemini response meta", {
    candidates: Array.isArray(response?.candidates) ? response.candidates.length : null,
    parts: Array.isArray(response?.candidates?.[0]?.content?.parts) ? response.candidates[0].content.parts.length : null,
    finishReason: response?.candidates?.[0]?.finishReason || null,
  });

  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      const mt = part.inlineData.mimeType || "image/png";
      return `data:${mt};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Gemini did not return an image");
}

app.post("/internal/ai/tryon", async (req, res) => {
  try {
    if (!assertInternalAiRequest(req, res)) return;

    const { selfieDataUrl, itemImageUrls, aspectRatio } = req.body || {};
    const imageDataUrl = await generateTryOnImageDataUrl({
      selfieDataUrl,
      itemImageUrls,
      aspectRatio,
      reqForAbsUrl: null,
    });

    return res.json({ imageDataUrl });
  } catch (err) {
    console.error("[toptry] /internal/ai/tryon error", err?.stack || err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || "AI gateway error" });
  }
});


app.post("/api/looks/create", requireAuth, async (req, res) => {
  try {
    console.log("[debug looks/create] hit", {
      userId: req.auth?.userId,
      hasBody: !!req.body,
      selfieType: typeof req.body?.selfieDataUrl,
      selfiePrefix: typeof req.body?.selfieDataUrl === "string" ? String(req.body.selfieDataUrl).slice(0, 32) : null,
      itemCount: Array.isArray(req.body?.itemImageUrls) ? req.body.itemImageUrls.length : null,
      firstItemPrefix: Array.isArray(req.body?.itemImageUrls) && req.body.itemImageUrls[0]
        ? String(req.body.itemImageUrls[0]).slice(0, 32)
        : null,
    });
    const b = req.body || {};
    const selfieDataUrl = b.selfieDataUrl;
    const itemImageUrls = b.itemImageUrls;
    const aspectRatio = b.aspectRatio;
    const qualityMode = String(b.qualityMode || "quality").trim().toLowerCase();
    const useOpenAI = false;
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

    let imageDataUrl = "";

    if (AI_GATEWAY_URL) {
      console.log("[toptry] using AI gateway try-on", {
        upstream: AI_GATEWAY_URL,
        itemCount: itemsAbs.length,
      });

      imageDataUrl = await callAiGatewayTryon({
        selfieDataUrl: selfieAbs,
        itemImageUrls: itemsAbs,
        aspectRatio,
      });
    } else if (useOpenAI) {
      console.log("[toptry] using OpenAI strict fast try-on", {
        itemCount: itemsAbs.length,
      });

      const b64 = await runOpenAiStrictTryon({
        selfieUrl: selfieAbs,
        itemUrls: itemsAbs,
      });

      if (!b64) {
        return res.status(502).json({ error: "OpenAI did not return an image" });
      }

      imageDataUrl = `data:image/png;base64,${b64}`;
    } else {
      imageDataUrl = await generateTryOnImageDataUrl({
        selfieDataUrl: selfieAbs,
        itemImageUrls: itemsAbs,
        aspectRatio,
        reqForAbsUrl: null,
      });
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
    console.error("[toptry] /api/looks/create error", e?.stack || e);
    return res.status(500).json({ error: (e && e.message) ? e.message : String(e) });
  }
});

app.post("/api/tryon", async (req, res) => {
  try {
    const { selfieDataUrl, itemImageUrls, aspectRatio } = req.body || {};

    let imageDataUrl = "";

    if (AI_GATEWAY_URL) {
      imageDataUrl = await callAiGatewayTryon({
        selfieDataUrl,
        itemImageUrls,
        aspectRatio,
      });
    } else {
      imageDataUrl = await generateTryOnImageDataUrl({
        selfieDataUrl,
        itemImageUrls,
        aspectRatio,
        reqForAbsUrl: null,
      });
    }

    return res.json({ imageDataUrl });
  } catch (err) {
    console.error("[toptry] /api/tryon error", err);
    res.status(err?.statusCode || 500).json({ error: err?.message || "Unknown server error" });
  }
});

/**
 * POST /api/wardrobe/extract
 */
app.post("/api/wardrobe/extract", async (req, res) => {
  try {
    const AI_PROXY_URL = AI_GATEWAY_URL;

    if (AI_PROXY_URL) {
      try {
        const upstream = `${AI_PROXY_URL}/api/wardrobe/extract`;
        const headers = AI_GATEWAY_SECRET
          ? { "x-toptry-internal-secret": AI_GATEWAY_SECRET }
          : {};
        const { resp, text } = await proxyJsonPost(upstream, req.body, headers);
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

    const mapCatalogWardrobeRow = (row) => ({
      id: row.id,
      title: row.title,
      price: Number(row.price || 0),
      currency: row.currency || "RUB",
      gender: row.gender,
      category: row.category,
      sizes: ["ONE"],
      images: row.imageUrl ? [row.imageUrl] : [],
      storeId: row.storeId || "catalog",
      storeName: row.storeName || undefined,
      brand: row.brand || undefined,
      productUrl: row.productUrl || undefined,
      affiliateUrl: row.affiliateUrl || undefined,
      availability: true,
      isCatalog: true,
      userId: row.userId,
      addedAt: row.createdAt.toISOString(),
      sourceType: "catalog",
    });

    if (p) {
      const orClauses = [
        affiliateUrl ? { affiliateUrl: String(affiliateUrl) } : null,
        productUrl ? { productUrl: String(productUrl) } : null,
        imageUrl ? { imageUrl } : null,
      ].filter(Boolean);

      const existing = await p.wardrobeItem.findFirst({
        where: orClauses.length
          ? {
              userId,
              sourceType: "catalog",
              OR: orClauses,
            }
          : {
              userId,
              sourceType: "catalog",
              title: String(title),
              category: String(category),
              gender: String(gender),
              imageUrl,
            },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        return res.json({ item: mapCatalogWardrobeRow(existing), deduped: true });
      }

      const id = `w-cat-${externalId || Date.now()}-${Math.random().toString(16).slice(2)}`;

      const created = await p.wardrobeItem.create({
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

      return res.json({ item: mapCatalogWardrobeRow(created), deduped: false });
    }

    const item = {
      id: `w-cat-${externalId || Date.now()}-${Math.random().toString(16).slice(2)}`,
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

    return res.json({ item, deduped: false });
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

app.delete("/api/wardrobe/item/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const id = String(req.params.id || "");
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: "Database is not configured" });

    const existing = await p.wardrobeItem.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    await p.wardrobeItem.delete({
      where: { id: existing.id },
    });

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[toptry] /api/wardrobe/item/:id delete error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

// ---------- LOOKS / SOCIAL ----------

function publicAuthorName(user) {
  const name = String(user?.username || "").trim();
  return name || "Пользователь TopTry";
}

async function mapLookForApi(row, viewerUserId = "") {
  const author = row?.user || (row?.userId
    ? await prisma.user.findUnique({
        where: { id: row.userId },
        select: { id: true, username: true, avatarUrl: true },
      }).catch(() => null)
    : null);

  let viewerLiked = false;
  if (viewerUserId && row?.id) {
    const like = await prisma.like.findUnique({
      where: { userId_lookId: { userId: viewerUserId, lookId: row.id } },
      select: { id: true },
    }).catch(() => null);
    viewerLiked = !!like;
  }

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    items: row.itemIds || [],
    itemIds: row.itemIds || [],
    sourceItems: row.sourceItems || [],
    resultImageUrl: row.resultImageKey ? `/media/${row.resultImageKey}` : "",
    isPublic: !!row.isPublic,
    likes: row.likesCount || 0,
    comments: row.commentsCount || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : row.createdAt.toISOString(),
    priceBuyNowRUB: row.priceBuyNowRUB || 0,
    buyLinks: row.buyLinks || [],
    aiDescription: row.aiDescription || null,
    userDescription: row.userDescription || null,
    authorName: publicAuthorName(author),
    authorAvatar: author?.avatarUrl || "",
    viewerLiked,
  };
}

async function getLookVisibleToViewer(lookId, viewerUserId = "") {
  const row = await prisma.look.findUnique({
    where: { id: lookId },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
    },
  });

  if (!row) return null;
  if (row.isPublic || (viewerUserId && row.userId === viewerUserId)) return row;
  return null;
}

app.get("/api/looks/public", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "24"), 10) || 24, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const viewerUserId = req.auth?.userId || "";

    const [rows, total] = await Promise.all([
      prisma.look.findMany({
        where: { isPublic: true },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.look.count({ where: { isPublic: true } }),
    ]);

    const looks = await Promise.all(rows.map((r) => mapLookForApi(r, viewerUserId)));

    return res.json({
      looks,
      total,
      limit,
      offset,
      hasMore: offset + looks.length < total,
    });
  } catch (err) {
    console.error("[toptry] /api/looks/public error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.get("/api/looks/my", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    const rows = await prisma.look.findMany({
      where: { userId },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const looks = await Promise.all(rows.map((r) => mapLookForApi(r, userId)));
    return res.json({ looks });
  } catch (err) {
    console.error("[toptry] /api/looks/my error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.get("/api/looks/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const viewerUserId = req.auth?.userId || "";
    const row = await getLookVisibleToViewer(id, viewerUserId);

    if (!row) return res.status(404).json({ error: "Look not found" });

    const look = await mapLookForApi(row, viewerUserId);
    return res.json({ look });
  } catch (err) {
    console.error("[toptry] /api/looks/:id get error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/publish", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const userId = req.auth.userId;

    const existing = await prisma.look.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) return res.status(404).json({ error: "Look not found" });

    const row = await prisma.look.update({
      where: { id },
      data: { isPublic: true },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    return res.json({ ok: true, look: await mapLookForApi(row, userId) });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/publish error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/unpublish", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const userId = req.auth.userId;

    const existing = await prisma.look.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) return res.status(404).json({ error: "Look not found" });

    const row = await prisma.look.update({
      where: { id },
      data: { isPublic: false },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    return res.json({ ok: true, look: await mapLookForApi(row, userId) });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/unpublish error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/like", requireAuth, async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;

    const look = await getLookVisibleToViewer(lookId, userId);
    if (!look) return res.status(404).json({ error: "Look not found" });

    const existing = await prisma.like.findUnique({
      where: { userId_lookId: { userId, lookId } },
      select: { id: true },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.like.create({
          data: {
            id: `like-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            userId,
            lookId,
          },
        }),
        prisma.look.update({
          where: { id: lookId },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
    }

    const fresh = await prisma.look.findUnique({ where: { id: lookId }, select: { likesCount: true } });
    return res.json({ ok: true, liked: true, likes: fresh?.likesCount || 0 });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/like error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.delete("/api/looks/:id/like", requireAuth, async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;

    const existing = await prisma.like.findUnique({
      where: { userId_lookId: { userId, lookId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.like.delete({ where: { id: existing.id } }),
        prisma.look.update({
          where: { id: lookId },
          data: { likesCount: { decrement: 1 } },
        }),
      ]);
    }

    const fresh = await prisma.look.findUnique({ where: { id: lookId }, select: { likesCount: true } });
    return res.json({ ok: true, liked: false, likes: Math.max(0, fresh?.likesCount || 0) });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/like delete error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/react", requireAuth, async (req, res) => {
  try {
    const reaction = String(req.body?.reaction || "").trim();
    if (reaction !== "like") {
      return res.json({ ok: true, likes: 0, wantTryCount: 0, wouldBuyCount: 0 });
    }

    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;
    const look = await getLookVisibleToViewer(lookId, userId);
    if (!look) return res.status(404).json({ error: "Look not found" });

    const existing = await prisma.like.findUnique({
      where: { userId_lookId: { userId, lookId } },
      select: { id: true },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.like.create({
          data: {
            id: `like-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            userId,
            lookId,
          },
        }),
        prisma.look.update({
          where: { id: lookId },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
    }

    const fresh = await prisma.look.findUnique({ where: { id: lookId }, select: { likesCount: true } });
    return res.json({ ok: true, likes: fresh?.likesCount || 0, wantTryCount: 0, wouldBuyCount: 0 });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/react error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/save", requireAuth, async (_req, res) => {
  return res.json({ ok: true, saves: 0 });
});

app.get("/api/looks/:id/comments", async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const viewerUserId = req.auth?.userId || "";
    const look = await getLookVisibleToViewer(lookId, viewerUserId);

    if (!look) return res.status(404).json({ error: "Look not found" });

    const rows = await prisma.comment.findMany({
      where: { lookId },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    const comments = rows.map((c) => ({
      id: c.id,
      lookId: c.lookId,
      userId: c.userId,
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      authorName: publicAuthorName(c.user),
      authorAvatar: c.user?.avatarUrl || "",
    }));

    return res.json({ comments });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/comments get error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/comments", requireAuth, async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;
    const text = String(req.body?.text || "").trim();

    if (!text) return res.status(400).json({ error: "Comment text is required" });
    if (text.length > 1000) return res.status(400).json({ error: "Comment is too long" });

    const look = await getLookVisibleToViewer(lookId, userId);
    if (!look) return res.status(404).json({ error: "Look not found" });

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          id: `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          userId,
          lookId,
          text,
        },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });

      await tx.look.update({
        where: { id: lookId },
        data: { commentsCount: { increment: 1 } },
      });

      return c;
    });

    return res.json({
      ok: true,
      comment: {
        id: comment.id,
        lookId: comment.lookId,
        userId: comment.userId,
        text: comment.text,
        createdAt: comment.createdAt.toISOString(),
        authorName: publicAuthorName(comment.user),
        authorAvatar: comment.user?.avatarUrl || "",
      },
    });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/comments post error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});



// ---------- CATALOG (Admitad / Sportcourt) ----------

function parseCsvTable(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;

  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || "";

    if (ch === '"') {
      if (q) {
        if (next === '"') {
          cell += '"';
          i++;
          continue;
        }

        const nextIsBoundary = next === ";" || next === "\n" || next === "";
        if (nextIsBoundary) {
          q = false;
          continue;
        }

        // tolerate dirty quotes inside quoted fields
        cell += '"';
        continue;
      } else if (cell === "") {
        q = true;
        continue;
      }
    }

    if (ch === ";" && !q) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === "\n" && !q) {
      row.push(cell.trim());
      cell = "";

      if (row.some((v) => String(v || "").trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((v) => String(v || "").trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function parseCsv(text) {
  const table = parseCsvTable(text);
  if (!table.length) return [];

  const header = table[0].map((h) => String(h || "").trim());

  return table.slice(1).map((cols) => {
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function parseFeedByRecordStart(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const firstNl = normalized.indexOf("\n");
  if (firstNl === -1) return parseCsv(normalized);

  const headerLine = normalized.slice(0, firstNl);
  const body = normalized.slice(firstNl + 1);

  const chunks = body
    .split(/\n(?=[^\n;]+;)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return parseCsv([headerLine, ...chunks].join("\n"));
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


const SAFE_CATALOG_ACTIVE_GROUPS = ["SHOES", "CLOTHING", "BAGS"];

const BLOCK_CATALOG_RESTORE_TITLE_RE =
  /плават|плавки|купаль|бикини|пляж|swim|beach/i;

async function restoreSafeCatalogActiveProducts(merchant) {
  const m = String(merchant || "").trim().toLowerCase();
  if (!m) return { count: 0 };

  const result = await prisma.catalogProduct.updateMany({
    where: {
      merchant: m,
      isActive: false,
      price: { gt: 0 },
      taxonomyGroup: { in: SAFE_CATALOG_ACTIVE_GROUPS },
      NOT: [
        { title: { contains: "плават", mode: "insensitive" } },
        { title: { contains: "плавки", mode: "insensitive" } },
        { title: { contains: "купаль", mode: "insensitive" } },
        { title: { contains: "бикини", mode: "insensitive" } },
        { title: { contains: "пляж", mode: "insensitive" } },
        { title: { contains: "swim", mode: "insensitive" } },
        { title: { contains: "beach", mode: "insensitive" } },
      ],
      AND: [
        { imageUrl: { not: null } },
        { imageUrl: { not: "" } },
      ],
    },
    data: { isActive: true },
  });

  if (result.count > 0) {
    console.log("[toptry] catalog import restored safe active products", {
      merchant: m,
      restored: result.count,
      groups: SAFE_CATALOG_ACTIVE_GROUPS,
      excluded: "swimwear/beach",
    });
  }

  return result;
}


async function deactivateBlockedCatalogProducts(merchant) {
  const m = String(merchant || "").trim().toLowerCase();
  if (!m) return { count: 0 };

  const result = await prisma.catalogProduct.updateMany({
    where: {
      merchant: m,
      isActive: true,
      OR: [
        { title: { contains: "плават", mode: "insensitive" } },
        { title: { contains: "плавки", mode: "insensitive" } },
        { title: { contains: "купаль", mode: "insensitive" } },
        { title: { contains: "бикини", mode: "insensitive" } },
        { title: { contains: "пляж", mode: "insensitive" } },
        { title: { contains: "swim", mode: "insensitive" } },
        { title: { contains: "beach", mode: "insensitive" } },
      ],
    },
    data: { isActive: false },
  });

  if (result.count > 0) {
    console.log("[toptry] catalog import deactivated blocked products", {
      merchant: m,
      deactivated: result.count,
      reason: "swimwear/beach",
    });
  }

  return result;
}



function normalizeCatalogCurrency(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s || s === "RUR") return "RUB";
  return s;
}

function normalizeCatalogSizes(raw) {
  const s = String(raw || "").toUpperCase();

  const letterSizes = Array.from(
    new Set(
      (s.match(/\b(XXL|XL|XS|S|M|L)\b/g) || [])
        .map((v) => String(v).trim().toUpperCase())
    )
  );

  const shoeSizes = Array.from(
    new Set(
      (s.match(/\b(3[5-9]|4[0-6])(?:[.,]5)?\b/g) || [])
        .map((v) => String(v).trim().replace(",", "."))
    )
  );

  return { letterSizes, shoeSizes };
}

function extractExplicitSizeText(row) {
  const parts = [];

  for (const key of ["sizes", "size", "available_sizes"]) {
    const v = row?.[key];
    if (v) parts.push(String(v));
  }

  const param = String(row?.param || "");
  for (const chunk of param.split("|")) {
    const [k, ...rest] = chunk.split(":");
    const key = String(k || "").trim().toLowerCase();
    const value = rest.join(":").trim();

    if (!value) continue;

    if (
      key === "размер" ||
      key === "размеры" ||
      key === "size" ||
      key === "sizes" ||
      key.includes("размер товара")
    ) {
      parts.push(value);
    }
  }

  return parts.join(" ");
}

function buildCatalogSizes(row, category, rawText) {
  const text = extractExplicitSizeText(row);
  const { letterSizes, shoeSizes } = normalizeCatalogSizes(text);
  const c = String(category || "").toUpperCase();

  return {
    sizesTop: ["TOPS", "JACKETS", "DRESS"].includes(c) ? letterSizes : [],
    sizesBottom: ["BOTTOMS", "DRESS"].includes(c) ? letterSizes : [],
    sizesShoes: c === "SHOES" ? shoeSizes : [],
  };
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

  if (/(кроссов|кед|ботин|ботильон|сапог|угг|туфл|балетк|лофер|мокас|босонож|эспадриль|shoe|sneaker|loafer|sandals|сандал|сланц|шл[её]п|домашняя обувь|espadrille)/i.test(s)) {
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


function getCatalogShoeTypePredicates(shoeType) {
  const st = String(shoeType || "").trim().toUpperCase();
  if (!st) return null;

  const taxonomy = {
    SNEAKERS: ["SNEAKERS"],
    SNEAKERS_CASUAL: ["SNEAKERS_CASUAL"],
    BOOTS: ["BOOTS"],
    HEELS: ["HEELS"],
    BALLET: ["BALLET"],
    TALL_BOOTS: ["TALL_BOOTS"],
    LOAFERS: ["LOAFERS"],
    SANDALS: ["SANDALS"],
    SHOES_CLASSIC: ["SHOES_CLASSIC"],
  }[st];

  if (!taxonomy?.length) return null;

  return [
    { category: "SHOES", taxonomySubgroup: { in: taxonomy } },
    // fallback for old / not-yet-enriched rows
    ...(st === "SNEAKERS" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "крос", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "sneaker", mode: "insensitive" } },
    ] : []),
    ...(st === "SNEAKERS_CASUAL" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "кед", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "canvas", mode: "insensitive" } },
    ] : []),
    ...(st === "BOOTS" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "бот", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "boot", mode: "insensitive" } },
    ] : []),
    ...(st === "LOAFERS" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "лофер", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "loafer", mode: "insensitive" } },
    ] : []),
    ...(st === "SANDALS" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "сандал", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "босонож", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "эспадриль", mode: "insensitive" } },
    ] : []),
    ...(st === "SHOES_CLASSIC" ? [
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "туф", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "oxford", mode: "insensitive" } },
      { category: "SHOES", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "дерби", mode: "insensitive" } },
    ] : []),
  ];
}


function getCatalogClothingTypePredicates(clothingType) {
  const ct = String(clothingType || "").trim().toUpperCase();
  if (!ct) return null;

  if (ct === "FEMALE_CLOTHING") return [{ gender: "FEMALE" }];
  if (ct === "MALE_CLOTHING") return [{ gender: "MALE" }];

  const taxonomy = {
    DRESSES: ["DRESSES"],
    TOPS: ["TOPS"],
    BLAZERS: ["BLAZERS"],
    OUTERWEAR: ["OUTERWEAR"],
    SKIRTS: ["SKIRTS"],
    TROUSERS: ["TROUSERS"],
    DENIM: ["DENIM"],
    TSHIRTS: ["TSHIRTS"],
    POLO: ["POLO"],
    HOODIES: ["HOODIES"],
    KNITWEAR: ["KNITWEAR"],
    SHIRTS: ["SHIRTS"],
    SUITS: ["SUITS"],
  }[ct];

  if (!taxonomy?.length) return null;

  const baseCategory =
    ct === "DRESSES" ? "DRESS" :
    ["SKIRTS", "TROUSERS", "DENIM"].includes(ct) ? "BOTTOMS" :
    ["BLAZERS", "OUTERWEAR"].includes(ct) ? "JACKETS" :
    ["TSHIRTS", "POLO", "HOODIES", "KNITWEAR", "SHIRTS", "TOPS"].includes(ct) ? "TOPS" :
    "";

  return [
    { taxonomySubgroup: { in: taxonomy } },
    // fallback for old / not-yet-enriched rows
    ...(ct === "DRESSES" ? [
      { category: "DRESS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }] },
    ] : []),
    ...(ct === "OUTERWEAR" ? [
      { category: "JACKETS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }] },
    ] : []),
    ...(ct === "BLAZERS" ? [
      { category: "JACKETS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "жакет", mode: "insensitive" } },
      { category: "JACKETS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "пиджак", mode: "insensitive" } },
    ] : []),
    ...(ct === "SKIRTS" ? [{ category: "BOTTOMS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "юб", mode: "insensitive" } }] : []),
    ...(ct === "TROUSERS" ? [{ category: "BOTTOMS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "брюк", mode: "insensitive" } }] : []),
    ...(ct === "DENIM" ? [{ OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "джинс", mode: "insensitive" } }] : []),
    ...(ct === "TSHIRTS" ? [{ category: "TOPS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "футбол", mode: "insensitive" } }] : []),
    ...(ct === "POLO" ? [{ category: "TOPS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "поло", mode: "insensitive" } }] : []),
    ...(ct === "HOODIES" ? [{ category: "TOPS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "худи", mode: "insensitive" } }] : []),
    ...(ct === "KNITWEAR" ? [{ category: "TOPS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "свитер", mode: "insensitive" } }] : []),
    ...(ct === "SHIRTS" ? [{ category: "TOPS", OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "рубаш", mode: "insensitive" } }] : []),
    ...(ct === "SUITS" ? [{ OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "костюм", mode: "insensitive" } }] : []),
    ...(baseCategory && ct === "TOPS" ? [
      { category: baseCategory, OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }] },
    ] : []),
  ];
}


function getCatalogDisplayCategoryPredicates(displayCategory) {
  const dc = String(displayCategory || "").trim().toUpperCase();
  if (!dc) return null;

  if (dc === "CLOTHING") {
    return [
      { category: "TOPS" },
      { category: "BOTTOMS" },
      { category: "JACKETS" },
      { category: "DRESS" },
    ];
  }

  if (dc === "TOPS") {
    return [{ category: "TOPS" }];
  }
  if (dc === "BOTTOMS") {
    return [{ category: "BOTTOMS" }];
  }
  if (dc === "OUTERWEAR") {
    return [{ category: "JACKETS" }];
  }
  if (dc === "DRESSES") {
    return [{ category: "DRESS" }];
  }
  if (dc === "SHOES") {
    return [{ category: "SHOES" }];
  }
  if (dc === "ACCESSORIES") {
    return [{ category: "ACCESSORIES" }];
  }
  if (dc === "BAGS") {
    return [
      { title: { contains: "сум", mode: "insensitive" } },
      { title: { contains: "bag", mode: "insensitive" } },
      { title: { contains: "рюкзак", mode: "insensitive" } },
      { title: { contains: "backpack", mode: "insensitive" } },
      { title: { contains: "клатч", mode: "insensitive" } },
      { title: { contains: "clutch", mode: "insensitive" } },
      { title: { contains: "wallet", mode: "insensitive" } },
      { title: { contains: "кошелек", mode: "insensitive" } },
    ];
  }

  return null;
}

function buildCatalogDbWhere({
  merchant,
  gender,
  category,
  displayCategory,
  q,
  discountOnly,
  brand,
  priceMin,
  priceMax,
  clothingType,
  shoeType,
  size,
  sizeTop,
  sizeBottom,
  sizeShoes,
  sizeLoose,
}) {
  const allowedMerchants = ["sportcourt", "sportmaster", "rendezvous", "thecultt", "remington"];

  const and = [{ isActive: true }];

  if (merchant && allowedMerchants.includes(merchant)) {
    and.push({ merchant });
  }
  if (gender) {
    and.push({ gender });
  }
  if (category) {
    and.push({ category });
  }

  const displayPredicates = getCatalogDisplayCategoryPredicates(displayCategory);
  if (displayPredicates?.length) {
    and.push({ OR: displayPredicates });
  }

  const clothingTypePredicates = getCatalogClothingTypePredicates(clothingType);
  if (String(displayCategory || "").trim().toUpperCase() === "CLOTHING" && clothingTypePredicates?.length) {
    and.push({ OR: clothingTypePredicates });
  }

  const shoeTypePredicates = getCatalogShoeTypePredicates(shoeType);
  if (String(displayCategory || "").trim().toUpperCase() === "SHOES" && shoeTypePredicates?.length) {
    and.push({ OR: shoeTypePredicates });
  }

  const brandNeedle = String(brand || "").trim();
  if (brandNeedle) {
    and.push({ brand: { contains: brandNeedle, mode: "insensitive" } });
  }

  const minPrice = Number(priceMin || 0);
  if (Number.isFinite(minPrice) && minPrice > 0) {
    and.push({ price: { gte: minPrice } });
  }

  const maxPrice = Number(priceMax || 0);
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    and.push({ price: { lte: maxPrice } });
  }

  if (discountOnly) {
    and.push({ oldPrice: { not: null } });
  }

  const needle = String(q || "").trim();
  if (needle) {
    and.push({
      OR: [
        { title: { contains: needle, mode: "insensitive" } },
        { brand: { contains: needle, mode: "insensitive" } },
        { category: { contains: needle, mode: "insensitive" } },
      ],
    });
  }

  const normalizeLetterSizeForFilter = (v) => {
    const s = String(v || "").trim().toUpperCase();
    return ["XS", "S", "M", "L", "XL", "XXL"].includes(s) ? s : "";
  };

  const normalizeShoeSizeForFilter = (v) => {
    const s = String(v || "").trim();
    return /^(3[5-9]|4[0-6])$/.test(s) ? s : "";
  };

  const directLetterSize = normalizeLetterSizeForFilter(size);
  const directShoeSize = normalizeShoeSizeForFilter(size);

  const topSize = normalizeLetterSizeForFilter(sizeTop || directLetterSize);
  const bottomSize = normalizeLetterSizeForFilter(sizeBottom || directLetterSize);
  const shoeSize = normalizeShoeSizeForFilter(sizeShoes || directShoeSize);

  const letterOrder = ["XS", "S", "M", "L", "XL", "XXL"];

  const expandLetterSize = (v) => {
    const s = normalizeLetterSizeForFilter(v);
    if (!s) return [];
    if (!sizeLoose) return [s];
    const i = letterOrder.indexOf(s);
    return letterOrder.filter((_, idx) => Math.abs(idx - i) <= 1);
  };

  const expandShoeSize = (v) => {
    const s = normalizeShoeSizeForFilter(v);
    if (!s) return [];
    if (!sizeLoose) return [s];
    const n = Number(s);
    return [n - 1, n, n + 1]
      .filter((x) => x >= 35 && x <= 46)
      .map(String);
  };

  const topSizes = expandLetterSize(topSize);
  const bottomSizes = expandLetterSize(bottomSize);
  const shoeSizes = expandShoeSize(shoeSize);

  const sizeOr = [];

  if (topSizes.length) {
    sizeOr.push({
      AND: [
        { category: { in: ["TOPS", "JACKETS", "DRESS"] } },
        { sizesTop: { hasSome: topSizes } },
      ],
    });
  }

  if (bottomSizes.length) {
    sizeOr.push({
      AND: [
        { category: { in: ["BOTTOMS", "DRESS"] } },
        { sizesBottom: { hasSome: bottomSizes } },
      ],
    });
  }

  if (shoeSizes.length) {
    sizeOr.push({
      AND: [
        { category: "SHOES" },
        { sizesShoes: { hasSome: shoeSizes } },
      ],
    });
  }

  if (sizeOr.length) {
    and.push({ OR: sizeOr });
  }

  return { AND: and };
}

function getCatalogOrderBy(sort) {
  const s = String(sort || "").trim();
  if (s === "price_asc") return [{ price: "asc" }, { updatedAt: "desc" }];
  if (s === "price_desc") return [{ price: "desc" }, { updatedAt: "desc" }];
  if (s === "discount_desc") return [{ oldPrice: "desc" }, { updatedAt: "desc" }];
  return [{ updatedAt: "desc" }];
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

function matchesCatalogRequestFilters(product, { q, displayCategory, discountOnly, brand, priceMin, priceMax }) {
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

  const brandNeedle = String(brand || "").trim().toLowerCase();
  if (brandNeedle) {
    const productBrand = String(product?.brand || "").trim().toLowerCase();
    if (!productBrand || !productBrand.includes(brandNeedle)) {
      return false;
    }
  }

  const minPrice = Number(priceMin || 0);
  if (Number.isFinite(minPrice) && minPrice > 0) {
    const productPrice = Number(product?.price || 0);
    if (!(productPrice >= minPrice)) {
      return false;
    }
  }

  const maxPrice = Number(priceMax || 0);
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    const productPrice = Number(product?.price || 0);
    if (!(productPrice <= maxPrice)) {
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
  "goods.thecultt.com",
  "thecultt.com",
  "www.thecultt.com",
  "remington.fashion",
  "www.remington.fashion",
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



function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean)));
}

function inferCatalogTaxonomy(product) {
  const haystack = [
    product?.title,
    product?.brand,
    product?.category,
    product?.gender,
    JSON.stringify(product?.rawPayload || {}),
  ].filter(Boolean).join(" ").toLowerCase();

  const originalCategory = String(product?.category || "").trim().toUpperCase();
  const inferredCategory = originalCategory === "OTHER"
    ? normalizeCatalogCategory(haystack)
    : originalCategory;

  const category = inferredCategory;

  let taxonomyGroup = "OTHER";
  let taxonomySubgroup = "";

  if (category === "SHOES") {
    taxonomyGroup = "SHOES";
    if (/балетк|ballet/.test(haystack)) taxonomySubgroup = "BALLET";
    else if (/сапог|ботфорт|угг|tall boot|ugg/.test(haystack)) taxonomySubgroup = "TALL_BOOTS";
    else if (/кроссов|sneaker|runner|running|trainer|trail/.test(haystack)) taxonomySubgroup = "SNEAKERS";
    else if (/кед|canvas|plimsoll/.test(haystack)) taxonomySubgroup = "SNEAKERS_CASUAL";
    else if (/лофер|loafer|мокас/.test(haystack)) taxonomySubgroup = "LOAFERS";
    else if (/сандал|босонож|эспадриль|сланц|шл[её]п|sand|espadrille/.test(haystack)) taxonomySubgroup = "SANDALS";
    else if (/туф|oxford|дерби|монк|brogue|formal shoe/.test(haystack)) taxonomySubgroup = "SHOES_CLASSIC";
    else if (/ботин|ботильон|boot|chelsea|chukka/.test(haystack)) taxonomySubgroup = "BOOTS";
  } else if (["TOPS", "BOTTOMS", "JACKETS", "DRESS"].includes(category)) {
    taxonomyGroup = "CLOTHING";
    if (category === "DRESS" || /плать|dress/.test(haystack)) taxonomySubgroup = "DRESSES";
    else if (/жакет|пиджак|blazer/.test(haystack)) taxonomySubgroup = "BLAZERS";
    else if (/поло|polo/.test(haystack)) taxonomySubgroup = "POLO";
    else if (/худи|hoodie|свитшот|sweatshirt|толстов/.test(haystack)) taxonomySubgroup = "HOODIES";
    else if (/свитер|джемпер|кардиган|knit|sweater/.test(haystack)) taxonomySubgroup = "KNITWEAR";
    else if (/рубаш|блуз|shirt|blouse/.test(haystack)) taxonomySubgroup = "SHIRTS";
    else if (/футбол|майк|t-shirt|tee/.test(haystack)) taxonomySubgroup = "TSHIRTS";
    else if (/юбк|skirt/.test(haystack)) taxonomySubgroup = "SKIRTS";
    else if (/джинс|denim|jeans/.test(haystack)) taxonomySubgroup = "DENIM";
    else if (/брюк|штан|trouser|pants/.test(haystack)) taxonomySubgroup = "TROUSERS";
    else if (category === "JACKETS" || /куртк|пальто|пухов|парка|бомбер|coat|jacket/.test(haystack)) taxonomySubgroup = "OUTERWEAR";
    else if (category === "TOPS") taxonomySubgroup = "TOPS";
  } else if (category === "ACCESSORIES") {
    if (/сумк|bag|рюкзак|backpack|клатч|clutch|кошелек|wallet/.test(haystack)) {
      taxonomyGroup = "BAGS";
      taxonomySubgroup = "BAGS";
    } else {
      taxonomyGroup = "ACCESSORIES";
      taxonomySubgroup = "ACCESSORIES";
    }
  }

  const styleTags = [];
  if (/classic|оксфорд|дерби|лофер|пальто|рубаш|пиджак|жакет/.test(haystack)) styleTags.push("classic");
  if (/sport|running|trail|training|трениров|кроссов/.test(haystack)) styleTags.push("sport");
  if (/casual|hoodie|худи|джинс|футбол|sneaker|кед/.test(haystack)) styleTags.push("casual");
  if (/premium|luxury|кожа|leather|шерсть|wool|cashmere|кашемир/.test(haystack)) styleTags.push("premium");

  const occasionTags = [];
  if (/office|офис|classic|дерби|оксфорд|рубаш|пиджак|жакет/.test(haystack)) occasionTags.push("office");
  if (/running|trail|sport|training|трениров/.test(haystack)) occasionTags.push("sport");
  if (/casual|джинс|футбол|худи|sneaker|кед/.test(haystack)) occasionTags.push("casual");
  if (/evening|вечер|premium|luxury/.test(haystack)) occasionTags.push("evening");

  const seasonTags = [];
  if (/winter|зим|пухов|шерсть|wool/.test(haystack)) seasonTags.push("winter");
  if (/summer|летн|сандал|босонож|shorts|шорт/.test(haystack)) seasonTags.push("summer");
  if (/демисез|spring|autumn|fall|осень|весна/.test(haystack)) seasonTags.push("midseason");

  let colorFamily = null;
  if (/black|черн|чёрн/.test(haystack)) colorFamily = "black";
  else if (/white|бел/.test(haystack)) colorFamily = "white";
  else if (/gray|grey|сер/.test(haystack)) colorFamily = "gray";
  else if (/blue|син|голуб/.test(haystack)) colorFamily = "blue";
  else if (/brown|корич|beige|беж/.test(haystack)) colorFamily = "brown";
  else if (/green|зел/.test(haystack)) colorFamily = "green";
  else if (/red|крас|бордов/.test(haystack)) colorFamily = "red";
  else if (/pink|роз/.test(haystack)) colorFamily = "pink";

  const categoryPatch =
    originalCategory === "OTHER" && ["SHOES", "TOPS", "BOTTOMS", "JACKETS", "DRESS", "ACCESSORIES"].includes(category)
      ? { category }
      : {};

  return {
    ...categoryPatch,
    taxonomyGroup,
    taxonomySubgroup,
    taxonomySource: "rules_v2",
    taxonomyEnrichedAt: new Date(),
    styleTags: uniqueStrings(styleTags),
    occasionTags: uniqueStrings(occasionTags),
    seasonTags: uniqueStrings(seasonTags),
    colorFamily,
  };
}


const catalogImportJobs = new Map();

function startCatalogImportJob(merchant) {
  const m = String(merchant || "").trim().toLowerCase();
  const allowed = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt"]);

  if (!allowed.has(m)) {
    return { ok: false, status: 400, error: "Unknown merchant" };
  }

  const existing = catalogImportJobs.get(m);
  if (existing?.running) {
    return {
      ok: true,
      queued: false,
      running: true,
      merchant: m,
      jobId: existing.jobId,
      startedAt: existing.startedAt,
    };
  }

  const jobId = `catalog-import-${m}-${Date.now()}`;
  const startedAt = new Date().toISOString();

  catalogImportJobs.set(m, {
    running: true,
    jobId,
    merchant: m,
    startedAt,
    finishedAt: null,
    status: "running",
    result: null,
    error: null,
  });

  setImmediate(async () => {
    const t0 = Date.now();
    console.log("[toptry] catalog import job started", { jobId, merchant: m });

    try {
      const url = `http://127.0.0.1:${PORT}/api/admin/catalog/import/${m}`;
      const resp = await fetch(url, { method: "POST" });
      const text = await resp.text();

      let result = text;
      try {
        result = JSON.parse(text);
      } catch {}

      catalogImportJobs.set(m, {
        running: false,
        jobId,
        merchant: m,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: resp.ok ? "completed" : "failed",
        result,
        error: resp.ok ? null : result,
      });

      console.log("[toptry] catalog import job finished", {
        jobId,
        merchant: m,
        ok: resp.ok,
        status: resp.status,
        ms: Date.now() - t0,
        result,
      });
    } catch (e) {
      catalogImportJobs.set(m, {
        running: false,
        jobId,
        merchant: m,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "failed",
        result: null,
        error: e?.message || String(e),
      });

      console.error("[toptry] catalog import job failed", {
        jobId,
        merchant: m,
        ms: Date.now() - t0,
        error: e?.stack || e,
      });
    }
  });

  return {
    ok: true,
    queued: true,
    running: true,
    merchant: m,
    jobId,
    startedAt,
  };
}

app.post("/api/admin/catalog/import-async/:merchant", (req, res) => {
  const result = startCatalogImportJob(req.params.merchant);

  if (!result.ok) {
    return res.status(result.status || 400).json(result);
  }

  return res.status(result.queued ? 202 : 200).json(result);
});

app.get("/api/admin/catalog/import-jobs", (_req, res) => {
  return res.json({
    jobs: Array.from(catalogImportJobs.values()),
  });
});



app.post("/api/admin/catalog/enrich-taxonomy", async (req, res) => {
  try {
    const merchant =
      typeof req.query.merchant === "string" && req.query.merchant.trim()
        ? req.query.merchant.trim().toLowerCase()
        : "";

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50000"), 10) || 50000, 1), 100000);

    const force =
      String(req.query.force || "").trim() === "1";

    const includeInactive =
      String(req.query.includeInactive || "").trim() === "1";

    const where = {
      ...(includeInactive ? {} : { isActive: true }),
      ...(merchant ? { merchant } : {}),
      ...(force ? {} : { taxonomyEnrichedAt: null }),
    };

    const items = await prisma.catalogProduct.findMany({
      where,
      select: {
        id: true,
        title: true,
        brand: true,
        category: true,
        gender: true,
        rawPayload: true,
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });

    let updated = 0;
    const byGroup = {};
    const bySubgroup = {};
    const byColor = {};

    for (const item of items) {
      const taxonomy = inferCatalogTaxonomy(item);

      await prisma.catalogProduct.update({
        where: { id: item.id },
        data: taxonomy,
      });

      updated++;
      byGroup[taxonomy.taxonomyGroup || ""] = (byGroup[taxonomy.taxonomyGroup || ""] || 0) + 1;
      bySubgroup[taxonomy.taxonomySubgroup || ""] = (bySubgroup[taxonomy.taxonomySubgroup || ""] || 0) + 1;
      byColor[taxonomy.colorFamily || ""] = (byColor[taxonomy.colorFamily || ""] || 0) + 1;
    }

    return res.json({
      ok: true,
      merchant: merchant || null,
      scanned: items.length,
      updated,
      byGroup,
      bySubgroup,
      byColor,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/enrich-taxonomy error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/catalog/backfill-sizes", async (req, res) => {
  try {
    const merchant =
      typeof req.query.merchant === "string" && req.query.merchant.trim()
        ? req.query.merchant.trim().toLowerCase()
        : "";

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50000"), 10) || 50000, 1), 100000);

    const where = {
      isActive: true,
      ...(merchant ? { merchant } : {}),
    };

    const rows = await prisma.catalogProduct.findMany({
      where,
      select: {
        id: true,
        category: true,
        rawPayload: true,
        title: true,
        brand: true,
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });

    let updated = 0;
    const byCategory = {};

    for (const row of rows) {
      const raw = row.rawPayload || {};
      const rawText = [
        raw.param,
        raw.size,
        raw.sizes,
        raw.available_sizes,
        raw.categoryId,
        raw.market_category,
        raw.typePrefix,
        row.title,
        row.brand,
      ].filter(Boolean).join(" ");

      const sizes = buildCatalogSizes(raw, row.category, rawText);

      await prisma.catalogProduct.update({
        where: { id: row.id },
        data: sizes,
      });

      updated++;
      const c = String(row.category || "OTHER");
      byCategory[c] = (byCategory[c] || 0) + 1;
    }

    return res.json({
      ok: true,
      merchant: merchant || null,
      scanned: rows.length,
      updated,
      byCategory,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/backfill-sizes error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/admin/catalog/taxonomy-stats", async (req, res) => {
  try {
    const merchant =
      typeof req.query.merchant === "string" && req.query.merchant.trim()
        ? req.query.merchant.trim().toLowerCase()
        : "";

    const where = {
      isActive: true,
      ...(merchant ? { merchant } : {}),
    };

    const [groups, subgroups, colors, total, enriched] = await Promise.all([
      prisma.catalogProduct.groupBy({ by: ["taxonomyGroup"], where, _count: { _all: true } }),
      prisma.catalogProduct.groupBy({ by: ["taxonomySubgroup"], where, _count: { _all: true } }),
      prisma.catalogProduct.groupBy({ by: ["colorFamily"], where, _count: { _all: true } }),
      prisma.catalogProduct.count({ where }),
      prisma.catalogProduct.count({ where: { ...where, taxonomyEnrichedAt: { not: null } } }),
    ]);

    return res.json({
      ok: true,
      merchant: merchant || null,
      total,
      enriched,
      groups,
      subgroups,
      colors,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/taxonomy-stats error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


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

      const catalogSizes = buildCatalogSizes(r, category, haystack);

      const data = {
        id: `cat-sportcourt-${externalId}`,
        merchant: "sportcourt",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        ...catalogSizes,
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

    // Do not auto-restore inactive products after import.
    // If a product is absent from the current merchant feed, it must stay inactive;
    // otherwise stale offers keep appearing with outdated prices/sizes.
    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("sportcourt");

    return res.json({
      ok: true,
      merchant: "sportcourt",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/sportcourt error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});



function isSportmasterCatalogItemRelevantAfterAllowList(row, title) {
  const primary = [
    title,
    row?.categoryId,
    row?.typePrefix,
  ].filter(Boolean).join(" ").toLowerCase();

  if (!primary) return false;

  // Hard rejects that should be evaluated on stable product identity fields,
  // not on the long technical param where words may appear in unrelated contexts.
  const hardRejectRe =
    /(для\s+мальчик|для\s+девоч|детск|подростк|baby|kids|junior|плаватель|плавки|купаль|бикини|пляж|swim|beach|aqua|инвентарь|мяч|шлем|клюш|ракет|велосип|самокат|ролик|коньк|лыж|сноуборд|тренаж|гантел|штанг|турник|палат|спальник|бутыл|фляг|фляж|коврик|защит|маск|очки|час|трубк|пробк|напильник|направляющ|перчатки хоккейные)/i;

  if (hardRejectRe.test(primary)) return false;

  return true;
}


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

      if (!isSportmasterCatalogItemRelevantAfterAllowList(r, title)) {
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

      const catalogSizes = buildCatalogSizes(r, category, [rawCategory, haystack].join(" "));

      const data = {
        id: `cat-sportmaster-${externalId}`,
        merchant: "sportmaster",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        ...catalogSizes,
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

    // Do not auto-restore inactive products after import.
    // If a product is absent from the current merchant feed, it must stay inactive;
    // otherwise stale offers keep appearing with outdated prices/sizes.
    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("sportmaster");

    return res.json({
      ok: true,
      merchant: "sportmaster",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/sportmaster error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


function normalizeCatalogAiReviewJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty ai review response");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(jsonText);
  } catch {
    const first = jsonText.indexOf("{");
    const last = jsonText.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(jsonText.slice(first, last + 1));
    }
    throw new Error("failed to parse ai review JSON");
  }
}

function buildCatalogAiReviewPrompt(products) {
  return `Ты проверяешь товары для российского сервиса виртуальной примерочной TopTry.

Задача: для каждого товара определить, пригоден ли он для виртуальной примерки, и предложить нормализованные признаки.

Верни СТРОГО JSON без markdown:
{
  "items": [
    {
      "id": "string",
      "isTryOnRelevant": true,
      "taxonomyGroup": "CLOTHING|SHOES|BAGS|ACCESSORIES|OTHER",
      "taxonomySubgroup": "OUTERWEAR|BLAZERS|KNITWEAR|HOODIES|TSHIRTS|SHIRTS|POLO|TROUSERS|DENIM|SKIRTS|DRESSES|SNEAKERS|BOOTS|LOAFERS|SANDALS|BALLET|SHOES_CLASSIC|BAGS|HEADWEAR|GLOVES|SCARVES|BELTS|SOCKS|ACCESSORIES|null",
      "gender": "male|female|unisex|kids|unknown",
      "colorFamily": "black|white|grey|beige|brown|blue|green|red|pink|purple|yellow|orange|multi|unknown",
      "seasonTags": ["summer|demi|winter|all-season"],
      "occasionTags": ["casual|office|sport|outdoor|evening|travel"],
      "styleTags": ["classic|minimal|streetwear|outdoor|sporty|elegant|basic"],
      "rejectReasons": ["SPORT_EQUIPMENT|BEAUTY_DEVICE|SWIMWEAR|UNDERWEAR|HOME_TEXTILE|BAD_IMAGE|BROKEN_LINK|NON_FASHION_ACCESSORY|TRYON_UNSUPPORTED_ACCESSORY|DUPLICATE|UNKNOWN"],
      "confidence": 0.0,
      "explanation": "short Russian explanation"
    }
  ]
}

Правила:
- Насосы, мячи, коврики, эспандеры, утяжелители, фитболы, спортинвентарь: isTryOnRelevant=false, taxonomyGroup=OTHER.
- Плавки, купальники, шорты плавательные, аквашузы, beach/swim/aqua: isTryOnRelevant=false, rejectReasons include SWIMWEAR.
- Обычная одежда, обувь и сумки: isTryOnRelevant=true.
- Головные уборы: шапка, кепка, панама, бейсболка, балаклава → taxonomyGroup=ACCESSORIES, taxonomySubgroup=HEADWEAR, isTryOnRelevant=true.
- Варежки и перчатки → taxonomyGroup=ACCESSORIES, taxonomySubgroup=GLOVES, isTryOnRelevant=false, rejectReasons include TRYON_UNSUPPORTED_ACCESSORY.
- Шарфы → taxonomyGroup=ACCESSORIES, taxonomySubgroup=SCARVES, isTryOnRelevant=false, rejectReasons include TRYON_UNSUPPORTED_ACCESSORY.
- Ремни → taxonomyGroup=ACCESSORIES, taxonomySubgroup=BELTS, isTryOnRelevant=false, rejectReasons include TRYON_UNSUPPORTED_ACCESSORY.
- Носки → taxonomyGroup=ACCESSORIES, taxonomySubgroup=SOCKS, isTryOnRelevant=false, rejectReasons include TRYON_UNSUPPORTED_ACCESSORY.
- Угги / высокие сапоги / tall boots → taxonomySubgroup=TALL_BOOTS.
- Ботинки / boots / boot → taxonomySubgroup=BOOTS.
- Джемпер-поло / свитер-поло / кардиган-поло / водолазка-поло → taxonomySubgroup=KNITWEAR.
- Футболка-поло / рубашка-поло / классическое поло → taxonomySubgroup=POLO.
- Футболка / t-shirt / tee → taxonomySubgroup=TSHIRTS.
- Рубашка / shirt button-down → taxonomySubgroup=SHIRTS.
- Пиджак / жакет / blazer → taxonomySubgroup=BLAZERS.
- Худи / толстовка / свитшот → taxonomySubgroup=HOODIES.
- Джемпер / свитер / кардиган / водолазка → taxonomySubgroup=KNITWEAR.
- Если существующая taxonomy явно противоречит названию, предложи исправленную taxonomy.
- Не придумывай факты, которых нет в названии/параметрах.
- confidence используй осторожно:
  1.0 — только очевидный спортинвентарь/очевидный неподходящий товар;
  0.90 — товар очевиден по названию и параметрам;
  0.75 — вероятно, но есть конфликт с текущей taxonomy;
  0.60 — мало данных или спорный аксессуар.

Товары:
${JSON.stringify(products, null, 2)}
`;
}


async function callAiGatewayCatalogTextReview(products) {
  if (!AI_GATEWAY_URL) return null;

  const upstream = `${AI_GATEWAY_URL}/internal/ai/catalog-review-text`;
  const headers = AI_GATEWAY_SECRET
    ? { "x-toptry-internal-secret": AI_GATEWAY_SECRET }
    : {};

  const { resp, text } = await proxyJsonPost(upstream, { products }, headers);

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}

  if (!resp.ok) {
    throw new Error(`AI gateway catalog review ${resp.status}: ${(data?.error || text || "").slice(0, 800)}`);
  }

  if (!data?.parsed) {
    throw new Error("AI gateway catalog review returned no parsed result");
  }

  return {
    model: data.model || "ai-gateway",
    parsed: data.parsed,
    rawText: data.rawText || "",
  };
}


async function runGeminiCatalogTextReview(products, { allowGateway = true } = {}) {
  if (allowGateway && AI_GATEWAY_URL) {
    return await callAiGatewayCatalogTextReview(products);
  }

  const model =
    process.env.GEMINI_CATALOG_MODEL ||
    process.env.GEMINI_MODEL_TEXT ||
    "gemini-2.5-flash-lite";

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  const prompt = buildCatalogAiReviewPrompt(products);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const result = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const responseText =
    result?.text ||
    result?.response?.text?.() ||
    result?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";

  return {
    model,
    parsed: normalizeCatalogAiReviewJson(responseText),
    rawText: responseText,
  };
}



const CATALOG_AI_ALLOWED_GROUPS = new Set([
  "CLOTHING",
  "SHOES",
  "BAGS",
  "ACCESSORIES",
  "OTHER",
]);

const CATALOG_AI_ALLOWED_SUBGROUPS = new Set([
  "OUTERWEAR",
  "BLAZERS",
  "KNITWEAR",
  "HOODIES",
  "TSHIRTS",
  "SHIRTS",
  "POLO",
  "TROUSERS",
  "DENIM",
  "SKIRTS",
  "DRESSES",
  "SNEAKERS",
  "BOOTS",
  "TALL_BOOTS",
  "LOAFERS",
  "SANDALS",
  "BALLET",
  "SHOES_CLASSIC",
  "BAGS",
  "HEADWEAR",
  "GLOVES",
  "SCARVES",
  "BELTS",
  "SOCKS",
  "ACCESSORIES",
]);

function normalizeCatalogAiString(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s || s === "NULL" || s === "NONE" || s === "N/A") return null;
  return s;
}

function addCatalogAiRejectReason(item, reason) {
  const reasons = Array.isArray(item.rejectReasons) ? item.rejectReasons.map(String) : [];
  if (!reasons.includes(reason)) reasons.push(reason);
  item.rejectReasons = reasons;
}

function normalizeCatalogAiReviewItem(rawItem, sourceProduct = {}) {
  const item = { ...(rawItem || {}) };
  const title = String(sourceProduct.title || item.title || "").toLowerCase();

  const group = normalizeCatalogAiString(item.taxonomyGroup);
  item.taxonomyGroup = CATALOG_AI_ALLOWED_GROUPS.has(group) ? group : "OTHER";

  const subgroup = normalizeCatalogAiString(item.taxonomySubgroup);
  item.taxonomySubgroup = CATALOG_AI_ALLOWED_SUBGROUPS.has(subgroup) ? subgroup : null;

  item.rejectReasons = Array.isArray(item.rejectReasons) ? item.rejectReasons.map(String) : [];

  const knitPoloRe = /(джемпер|свитер|кардиган|водолазк|knit|sweater|cardigan)[\s\-]+поло|поло[\s\-]+(джемпер|свитер|кардиган|водолазк|knit|sweater|cardigan)/i;
  const classicPoloRe = /(футболк|рубашк|shirt|t-?shirt|tee)[\s\-]+поло|поло[\s\-]+(футболк|рубашк|shirt|t-?shirt|tee)|^поло\b|\bpolo\b/i;

  const outerwearTitleRe = /(верхн[яе][яе]\s+одежд|куртк|пуховик|ветровк|пальто|плащ|жилет|jacket|coat|parka|vest|gilet)/i;
  const blazerTitleRe = /(пиджак|жакет|blazer)/i;

  if (blazerTitleRe.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "BLAZERS";
    item.isTryOnRelevant = true;
  } else if (outerwearTitleRe.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "OUTERWEAR";
    item.isTryOnRelevant = true;
  } else if (knitPoloRe.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "KNITWEAR";
    item.isTryOnRelevant = true;
  } else if (classicPoloRe.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "POLO";
    item.isTryOnRelevant = true;
  } else if (/футболк|t-?shirt|\btee\b/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "TSHIRTS";
    item.isTryOnRelevant = true;
  } else if (/рубашк|button[- ]?down|\bshirt\b/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "SHIRTS";
    item.isTryOnRelevant = true;
  } else if (/худи|толстовк|свитшот|hoodie|sweatshirt/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "HOODIES";
    item.isTryOnRelevant = true;
  } else if (/джемпер|свитер|кардиган|водолазк|knit|sweater|cardigan/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "KNITWEAR";
    item.isTryOnRelevant = true;
  }

  if (/угги|ugg|tall boots|высокие сапоги/i.test(title)) {
    item.taxonomyGroup = "SHOES";
    item.taxonomySubgroup = "TALL_BOOTS";
    item.isTryOnRelevant = true;
  }

  const genericBootsRe = /ботинк|\bboot\b|\bboots\b/i;
  if (genericBootsRe.test(title) && item.taxonomySubgroup !== "TALL_BOOTS") {
    item.taxonomyGroup = "SHOES";
    item.taxonomySubgroup = "BOOTS";
    item.isTryOnRelevant = true;
  }

  if (/шапк|кепк|панам|бейсболк|балаклав|beanie|cap\b|hat\b/i.test(title)) {
    item.taxonomyGroup = "ACCESSORIES";
    item.taxonomySubgroup = "HEADWEAR";
    item.isTryOnRelevant = true;
  }

  if (/варежк|перчатк|glove|gloves|mitten|mittens/i.test(title)) {
    item.taxonomyGroup = "ACCESSORIES";
    item.taxonomySubgroup = "GLOVES";
    item.isTryOnRelevant = false;
    addCatalogAiRejectReason(item, "TRYON_UNSUPPORTED_ACCESSORY");
  }

  if (/шарф|scarf/i.test(title)) {
    item.taxonomyGroup = "ACCESSORIES";
    item.taxonomySubgroup = "SCARVES";
    item.isTryOnRelevant = false;
    addCatalogAiRejectReason(item, "TRYON_UNSUPPORTED_ACCESSORY");
  }

  if (/ремень|ремни|belt/i.test(title)) {
    item.taxonomyGroup = "ACCESSORIES";
    item.taxonomySubgroup = "BELTS";
    item.isTryOnRelevant = false;
    addCatalogAiRejectReason(item, "TRYON_UNSUPPORTED_ACCESSORY");
  }

  if (/носк[иов]?|sock|socks/i.test(title)) {
    item.taxonomyGroup = "ACCESSORIES";
    item.taxonomySubgroup = "SOCKS";
    item.isTryOnRelevant = false;
    addCatalogAiRejectReason(item, "TRYON_UNSUPPORTED_ACCESSORY");
  }

  if (/плавк|купаль|плават|аквашуз|beach|swim|aqua/i.test(title)) {
    item.isTryOnRelevant = false;
    addCatalogAiRejectReason(item, "SWIMWEAR");
  }

  if (typeof item.confidence !== "number") {
    item.confidence = null;
  }

  return item;
}


app.post("/internal/ai/catalog-review-text", async (req, res) => {
  try {
    if (!assertInternalAiRequest(req, res)) return;

    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!products.length) {
      return res.status(400).json({ error: "products[] is required" });
    }

    const safeProducts = products.slice(0, 100);
    const result = await runGeminiCatalogTextReview(safeProducts, { allowGateway: false });

    return res.json({
      model: result.model,
      parsed: result.parsed,
      rawText: result.rawText || "",
    });
  } catch (e) {
    console.error("[toptry] /internal/ai/catalog-review-text error", e);
    return res.status(500).json({
      error: e?.message || "internal catalog AI review failed",
    });
  }
});


app.post("/api/admin/catalog/ai-review/gemini-text", async (req, res) => {
  try {
    const merchant = String(req.query.merchant || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const includeInactive = String(req.query.includeInactive || "") === "1";
    const focus = String(req.query.focus || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim();
    const skipReviewed = String(req.query.skipReviewed || "") === "1";

    const where = {
      ...(merchant ? { merchant } : {}),
      ...(includeInactive ? {} : { isActive: true }),
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      ...(skipReviewed ? { aiReviews: { none: {} } } : {}),
      price: { gt: 0 },
      AND: [
        { imageUrl: { not: null } },
        { imageUrl: { not: "" } },
      ],
      ...(focus === "accessories"
        ? { taxonomyGroup: "ACCESSORIES" }
        : {}),
      ...(focus === "suspicious"
        ? {
            OR: [
              { taxonomyGroup: "OTHER" },
              { taxonomyGroup: null },
              { taxonomySubgroup: null },
              { title: { contains: "насос", mode: "insensitive" } },
              { title: { contains: "коврик", mode: "insensitive" } },
              { title: { contains: "эспандер", mode: "insensitive" } },
              { title: { contains: "плав", mode: "insensitive" } },
              { title: { contains: "swim", mode: "insensitive" } },
              { title: { contains: "beach", mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const rows = await prisma.catalogProduct.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        merchant: true,
        title: true,
        brand: true,
        category: true,
        gender: true,
        price: true,
        oldPrice: true,
        taxonomyGroup: true,
        taxonomySubgroup: true,
        styleTags: true,
        occasionTags: true,
        seasonTags: true,
        colorFamily: true,
        rawPayload: true,
      },
    });

    const products = rows.map((p) => ({
      id: p.id,
      merchant: p.merchant,
      title: p.title,
      brand: p.brand,
      category: p.category,
      gender: p.gender,
      price: p.price,
      oldPrice: p.oldPrice,
      taxonomyGroup: p.taxonomyGroup,
      taxonomySubgroup: p.taxonomySubgroup,
      styleTags: p.styleTags || [],
      occasionTags: p.occasionTags || [],
      seasonTags: p.seasonTags || [],
      colorFamily: p.colorFamily,
      raw: {
        categoryId: p.rawPayload?.categoryId || null,
        typePrefix: p.rawPayload?.typePrefix || null,
        param: String(p.rawPayload?.param || "").slice(0, 1500),
        description: String(p.rawPayload?.description || "").slice(0, 1000),
      },
    }));

    if (!products.length) {
      return res.json({
        ok: true,
        merchant: merchant || null,
        q: q || null,
        skipReviewed,
        limit,
        reviewed: 0,
        saved: 0,
        chunks: 0,
        items: [],
      });
    }

    const inputHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        products,
        modelHint: process.env.GEMINI_CATALOG_MODEL || process.env.GEMINI_MODEL_TEXT || "",
      }))
      .digest("hex");

    const catalogAiReviewChunkSize = Math.max(
      1,
      Math.min(30, Number(req.query.chunkSize || 20))
    );

    const chunks = [];
    for (let i = 0; i < products.length; i += catalogAiReviewChunkSize) {
      chunks.push(products.slice(i, i + catalogAiReviewChunkSize));
    }

    let model = null;
    let rawTextLen = 0;
    const items = [];
    const unmatchedItems = [];

    for (const chunk of chunks) {
      const result = await runGeminiCatalogTextReview(chunk);
      model = model || result.model;
      rawTextLen += String(result.rawText || "").length;

      const rawItems = Array.isArray(result.parsed?.items) ? result.parsed.items : [];
      for (let idx = 0; idx < rawItems.length; idx++) {
        const rawItem = rawItems[idx] || {};
        const rawId = String(rawItem?.id || "").trim();
        const exactSource = rows.find((r) => r.id === rawId);
        const fallbackProduct = chunk[idx] || null;
        const source = exactSource || (fallbackProduct ? rows.find((r) => r.id === fallbackProduct.id) : null);

        if (!exactSource && source) {
          unmatchedItems.push({
            rawId,
            fallbackId: source.id,
            title: source.title,
            chunkIndex: idx,
          });
        }

        const normalized = normalizeCatalogAiReviewItem(
          { ...rawItem, id: source?.id || rawId },
          source || {}
        );

        items.push({
          ...normalized,
          aiReturnedId: rawId || null,
          idMatchedExactly: !!exactSource,
        });
      }
    }

    let saved = 0;
    const skippedItems = [];

    for (const item of items) {
      const productId = String(item.id || "");
      const source = rows.find((r) => r.id === productId);
      if (!source) {
        skippedItems.push({
          id: item.id || null,
          aiReturnedId: item.aiReturnedId || null,
          reason: "source_not_found",
        });
        continue;
      }

      const rawOutput = { ...item };
      delete rawOutput.idMatchedExactly;

      await prisma.catalogProductAIReview.create({
        data: {
          productId,
          merchant: source.merchant,
          model,
          status: "REVIEWED",
          isTryOnRelevantSuggested:
            typeof item.isTryOnRelevant === "boolean" ? item.isTryOnRelevant : null,
          taxonomyGroupSuggested: item.taxonomyGroup || null,
          taxonomySubgroupSuggested:
            item.taxonomySubgroup && item.taxonomySubgroup !== "null"
              ? item.taxonomySubgroup
              : null,
          genderSuggested: item.gender || null,
          colorFamilySuggested: item.colorFamily || null,
          seasonTagsSuggested: Array.isArray(item.seasonTags) ? item.seasonTags.map(String) : [],
          occasionTagsSuggested: Array.isArray(item.occasionTags) ? item.occasionTags.map(String) : [],
          styleTagsSuggested: Array.isArray(item.styleTags) ? item.styleTags.map(String) : [],
          rejectReasons: Array.isArray(item.rejectReasons) ? item.rejectReasons.map(String) : [],
          confidence: typeof item.confidence === "number" ? item.confidence : null,
          explanation: item.explanation ? String(item.explanation).slice(0, 1000) : null,
          inputHash,
          rawInput: products.find((p) => p.id === productId) || {},
          rawOutput,
        },
      });

      saved++;
    }

    return res.json({
      ok: true,
      merchant: merchant || null,
      focus: focus || null,
      q: q || null,
      skipReviewed,
      model,
      limit,
      reviewed: products.length,
      saved,
      chunks: chunks.length,
      chunkSize: catalogAiReviewChunkSize,
      unmatched: unmatchedItems.length,
      skipped: skippedItems.length,
      unmatchedItems,
      skippedItems,
      items,
      rawTextLen,
    });
  } catch (e) {
    console.error("[toptry] catalog ai review error", e);
    return res.status(500).json({
      error: e?.message || "catalog ai review failed",
    });
  }
});



const CATALOG_AI_SAFE_DEACTIVATE_REASONS = [
  "SPORT_EQUIPMENT",
  "NON_FASHION_ACCESSORY",
  "SWIMWEAR",
  "TRYON_UNSUPPORTED_ACCESSORY",
  "BEAUTY_DEVICE",
  "HOME_TEXTILE",
  "UNDERWEAR",
];

const CATALOG_AI_SAFE_DEACTIVATE_TITLE_RULES = [
  {
    code: "TITLE_UNSUPPORTED_ACCESSORY",
    reasons: ["TRYON_UNSUPPORTED_ACCESSORY"],
    titleRe: /(варежк|перчатк|gloves?|mittens?|шарф|scarf|ремень|ремни|belts?|носк[иов]?|socks?)/i,
  },
  {
    code: "TITLE_SWIMWEAR",
    reasons: ["SWIMWEAR"],
    titleRe: /(плавк|купаль|бикини|пляж|пляжн|аквашуз|плавател|swim|beach|aqua)/i,
  },
  {
    code: "TITLE_SPORT_EQUIPMENT",
    reasons: ["SPORT_EQUIPMENT", "NON_FASHION_ACCESSORY"],
    titleRe: /(насос|мяч|коврик|эспандер|утяжелител|фитбол|гантел|штанг|гир[яи]|тренаж[её]р|турник|скакалк|ракетк|клюшк|шлем|защит[аы]|ролик|коньк|лыж|сноуборд|самокат|велосипед|палатк|спальник|бутылк|фляг|pump|ball\b|mat\b|expander|dumbbell|barbell|kettlebell|trainer|helmet|skates?|skis?|snowboard|scooter|bike|bicycle|tent|sleeping bag|bottle)/i,
  },
  {
    code: "TITLE_BEAUTY_OR_CARE",
    reasons: ["BEAUTY_DEVICE", "NON_FASHION_ACCESSORY"],
    titleRe: /(крем|спрей|уход|космет|чист|салфет|пропитк|ложк|щ[её]тк|дезодорант|средств|губк|краск|воск|очистит|растяжит|стельк|шнурк|cream|spray|cleaner|deodorant|insole|laces?)/i,
  },
  {
    code: "TITLE_HOME_TEXTILE",
    reasons: ["HOME_TEXTILE"],
    titleRe: /(полотенц|плед|одеял|простын|подушк|ков[её]р|towel|blanket|sheet|pillow|rug)/i,
  },
  {
    code: "TITLE_UNDERWEAR",
    reasons: ["UNDERWEAR"],
    titleRe: /(трус[ыов]|бюстгальтер|лифчик|бра\b|бель[её]|underwear|briefs?|boxers?|bra\b)/i,
  },
];

function catalogAiSafeDeactivateRuleCodesFor(row) {
  const title = String(row?.title || "");
  const reasons = Array.isArray(row?.rejectReasons)
    ? row.rejectReasons.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  if (!title || !reasons.length) return [];

  return CATALOG_AI_SAFE_DEACTIVATE_TITLE_RULES
    .filter((rule) => {
      if (!rule.titleRe.test(title)) return false;
      return reasons.some((reason) => rule.reasons.includes(reason));
    })
    .map((rule) => rule.code);
}

function isCatalogAiSafeDeactivateCandidate(row) {
  return catalogAiSafeDeactivateRuleCodesFor(row).length > 0;
}

app.post("/api/admin/catalog/ai-review/apply-safe-deactivate", async (req, res) => {
  try {
    const dryRun = String(req.query.dryRun || "1") !== "0";
    const merchant = String(req.query.merchant || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 500)));
    const minConfidence = Math.max(0, Math.min(1, Number(req.query.minConfidence || 0.95)));

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt"]);
    if (merchant && !allowedMerchants.has(merchant)) {
      return res.status(400).json({ error: "Unknown merchant" });
    }

    const params = [
      minConfidence,
      CATALOG_AI_SAFE_DEACTIVATE_REASONS,
      limit,
    ];

    let merchantSql = "";
    if (merchant) {
      params.push(merchant);
      merchantSql = `and p.merchant = $${params.length}`;
    }

    const latestRows = await prisma.$queryRawUnsafe(`
      with latest as (
        select distinct on (r."productId")
          r.id as "reviewId",
          r."productId",
          r."isTryOnRelevantSuggested",
          r."rejectReasons",
          r.confidence,
          r.explanation,
          r."createdAt"
        from "CatalogProductAIReview" r
        order by r."productId", r."createdAt" desc
      )
      select
        p.id,
        p.merchant,
        p.title,
        p.category,
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."isActive",
        latest."reviewId",
        latest."isTryOnRelevantSuggested",
        latest."rejectReasons",
        latest.confidence,
        latest.explanation,
        latest."createdAt"
      from latest
      join "CatalogProduct" p on p.id = latest."productId"
      where p."isActive" = true
        ${merchantSql}
        and latest."isTryOnRelevantSuggested" = false
        and latest.confidence >= $1
        and latest."rejectReasons" && $2::text[]
      order by latest."createdAt" desc
      limit $3
    `, ...params);

    const rawCandidates = Array.isArray(latestRows) ? latestRows : [];
    const candidates = rawCandidates.filter((r) => isCatalogAiSafeDeactivateCandidate(r));
    const ids = candidates.map((r) => String(r.id)).filter(Boolean);

    let updated = 0;

    if (!dryRun && ids.length) {
      const result = await prisma.catalogProduct.updateMany({
        where: {
          id: { in: ids },
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      updated = result.count || 0;

      console.log("[toptry] catalog AI safe deactivate applied", {
        merchant: merchant || null,
        candidates: ids.length,
        updated,
        minConfidence,
        reasons: CATALOG_AI_SAFE_DEACTIVATE_REASONS,
      });
    }

    const byMerchant = {};
    for (const r of candidates) {
      const m = String(r.merchant || "");
      byMerchant[m] = (byMerchant[m] || 0) + 1;
    }

    return res.json({
      ok: true,
      dryRun,
      merchant: merchant || null,
      minConfidence,
      safeReasons: CATALOG_AI_SAFE_DEACTIVATE_REASONS,
      safeDeactivateRules: CATALOG_AI_SAFE_DEACTIVATE_TITLE_RULES.map((rule) => ({
        code: rule.code,
        reasons: rule.reasons,
        titlePattern: String(rule.titleRe),
      })),
      scanned: rawCandidates.length,
      candidates: candidates.length,
      updated,
      byMerchant,
      items: candidates.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        title: r.title,
        category: r.category,
        taxonomyGroup: r.taxonomyGroup,
        taxonomySubgroup: r.taxonomySubgroup,
        isActive: r.isActive,
        isTryOnRelevantSuggested: r.isTryOnRelevantSuggested,
        rejectReasons: r.rejectReasons || [],
        confidence: r.confidence,
        safeRuleCodes: catalogAiSafeDeactivateRuleCodesFor(r),
        explanation: r.explanation,
        reviewCreatedAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[toptry] catalog AI apply safe deactivate error", e);
    return res.status(500).json({
      error: e?.message || "catalog AI apply safe deactivate failed",
    });
  }
});



app.post("/api/admin/catalog/ai-review/apply-taxonomy-dryrun", async (req, res) => {
  try {
    const merchant = String(req.query.merchant || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 500)));
    const minConfidence = Math.max(0, Math.min(1, Number(req.query.minConfidence || 0.75)));
    const includeAccessories = String(req.query.includeAccessories || "") === "1";

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt"]);
    if (merchant && !allowedMerchants.has(merchant)) {
      return res.status(400).json({ error: "Unknown merchant" });
    }

    const allowedGroups = Array.from(CATALOG_AI_ALLOWED_GROUPS).filter((g) => g !== "OTHER");
    const allowedSubgroups = Array.from(CATALOG_AI_ALLOWED_SUBGROUPS);

    const params = [
      minConfidence,
      allowedGroups,
      allowedSubgroups,
      limit,
    ];

    let merchantSql = "";
    if (merchant) {
      params.push(merchant);
      merchantSql = `and p.merchant = $${params.length}`;
    }

    let accessoriesSql = "";
    if (!includeAccessories) {
      accessoriesSql = `and coalesce(latest."taxonomyGroupSuggested", '') <> 'ACCESSORIES'`;
    }

    const rows = await prisma.$queryRawUnsafe(`
      with latest as (
        select distinct on (r."productId")
          r.id as "reviewId",
          r."productId",
          r."isTryOnRelevantSuggested",
          r."taxonomyGroupSuggested",
          r."taxonomySubgroupSuggested",
          r."genderSuggested",
          r."colorFamilySuggested",
          r."seasonTagsSuggested",
          r."occasionTagsSuggested",
          r."styleTagsSuggested",
          r."rejectReasons",
          r.confidence,
          r.explanation,
          r."createdAt"
        from "CatalogProductAIReview" r
        order by r."productId", r."createdAt" desc
      )
      select
        p.id,
        p.merchant,
        p.title,
        p.category,
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."isActive",
        latest."reviewId",
        latest."taxonomyGroupSuggested",
        latest."taxonomySubgroupSuggested",
        latest."genderSuggested",
        latest."colorFamilySuggested",
        latest."seasonTagsSuggested",
        latest."occasionTagsSuggested",
        latest."styleTagsSuggested",
        latest."rejectReasons",
        latest.confidence,
        latest.explanation,
        latest."createdAt"
      from latest
      join "CatalogProduct" p on p.id = latest."productId"
      where p."isActive" = true
        ${merchantSql}
        ${accessoriesSql}
        and latest."isTryOnRelevantSuggested" = true
        and latest.confidence >= $1
        and coalesce(cardinality(latest."rejectReasons"), 0) = 0
        and latest."taxonomyGroupSuggested" = any($2::text[])
        and latest."taxonomySubgroupSuggested" = any($3::text[])
        and (
          coalesce(p."taxonomyGroup", '') <> coalesce(latest."taxonomyGroupSuggested", '')
          or coalesce(p."taxonomySubgroup", '') <> coalesce(latest."taxonomySubgroupSuggested", '')
        )
      order by latest.confidence asc, latest."createdAt" desc
      limit $4
    `, ...params);

    const candidates = Array.isArray(rows) ? rows : [];

    const byMerchant = {};
    const byChange = {};

    for (const r of candidates) {
      const m = String(r.merchant || "");
      byMerchant[m] = (byMerchant[m] || 0) + 1;

      const fromGroup = r.taxonomyGroup || "";
      const fromSubgroup = r.taxonomySubgroup || "";
      const toGroup = r.taxonomyGroupSuggested || "";
      const toSubgroup = r.taxonomySubgroupSuggested || "";
      const key = `${fromGroup}/${fromSubgroup} -> ${toGroup}/${toSubgroup}`;
      byChange[key] = (byChange[key] || 0) + 1;
    }

    return res.json({
      ok: true,
      dryRun: true,
      merchant: merchant || null,
      limit,
      minConfidence,
      includeAccessories,
      candidates: candidates.length,
      byMerchant,
      byChange,
      items: candidates.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        title: r.title,
        category: r.category,
        current: {
          taxonomyGroup: r.taxonomyGroup,
          taxonomySubgroup: r.taxonomySubgroup,
        },
        suggested: {
          taxonomyGroup: r.taxonomyGroupSuggested,
          taxonomySubgroup: r.taxonomySubgroupSuggested,
          gender: r.genderSuggested,
          colorFamily: r.colorFamilySuggested,
          seasonTags: r.seasonTagsSuggested || [],
          occasionTags: r.occasionTagsSuggested || [],
          styleTags: r.styleTagsSuggested || [],
        },
        confidence: r.confidence,
        explanation: r.explanation,
        reviewCreatedAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[toptry] catalog AI apply taxonomy dryrun error", e);
    return res.status(500).json({
      error: e?.message || "catalog AI apply taxonomy dryrun failed",
    });
  }
});





const CATALOG_AI_SAFE_TAXONOMY_RULES = [
  {
    code: "TITLE_BOTTOMS_TO_TROUSERS",
    toGroup: "CLOTHING",
    toSubgroup: "TROUSERS",
    titleRe: /(брюки|шорты|легинс|велосипедк|полукомбинезон|pants|shorts|leggings|bib)/i,
    rejectTitleRe: /(сумк|bag\b|bags\b|рюкзак|backpack)/i,
  },
  {
    code: "TITLE_OUTERWEAR",
    toGroup: "CLOTHING",
    toSubgroup: "OUTERWEAR",
    titleRe: /(верхн[яе][яе]\s+одежд|куртк|пуховик|ветровк|пальто|плащ|жилет|jacket|coat|parka|vest|gilet)/i,
    rejectTitleRe: /(пиджак|жакет|blazer)/i,
  },
  {
    code: "TITLE_BLAZERS",
    toGroup: "CLOTHING",
    toSubgroup: "BLAZERS",
    titleRe: /(пиджак|жакет|blazer)/i,
  },
  {
    code: "TITLE_TSHIRTS",
    toGroup: "CLOTHING",
    toSubgroup: "TSHIRTS",
    titleRe: /(футболк|майк|топ бра|спортивный бра|tank top|t-?shirt|tee\b)/i,
    rejectTitleRe: /(рубашк|блузк|куртк|пуховик|ветровк|пальто|жилет|худи|толстовк|свитшот|джемпер|свитер|кардиган|водолазк)/i,
  },
  {
    code: "TITLE_HOODIES",
    toGroup: "CLOTHING",
    toSubgroup: "HOODIES",
    titleRe: /(худи|толстовк|свитшот|hoodie|sweatshirt)/i,
    rejectTitleRe: /(футболк|майк|t-?shirt|tee\b|джемпер|свитер|кардиган|водолазк)/i,
  },
  {
    code: "TITLE_KNITWEAR",
    toGroup: "CLOTHING",
    toSubgroup: "KNITWEAR",
    titleRe: /(джемпер|свитер|водолазк|кардиган|лонгслив|sweater|cardigan|turtleneck|longsleeve|long sleeve)/i,
    rejectTitleRe: /(юбк|skirt|брюки|шорты|легинс|велосипедк|полукомбинезон|pants|shorts|leggings|bib|куртк|пуховик|ветровк|пальто|жилет|jacket|coat|parka|vest|gilet|худи|толстовк|свитшот|hoodie|sweatshirt|футболк|майк|t-?shirt|tee\b|tank top|топ бра|спортивный бра)/i,
  },
  {
    code: "TITLE_SNEAKERS",
    toGroup: "SHOES",
    toSubgroup: "SNEAKERS",
    titleRe: /(кеды|кроссовк|бутсы|sneakers?|trainers?|cleats?)/i,
    rejectTitleRe: /(ботинк|\bboots?\b|сапог|лофер|туфл|балетк|сандал)/i,
  },
  {
    code: "TITLE_BOOTS",
    toGroup: "SHOES",
    toSubgroup: "BOOTS",
    titleRe: /(ботинк|\bboots?\b)/i,
    rejectTitleRe: /(кеды|кроссовк|бутсы|sneakers?|trainers?|cleats?)/i,
  },
  {
    code: "TITLE_SKIRTS",
    toGroup: "CLOTHING",
    toSubgroup: "SKIRTS",
    titleRe: /(юбк|skirt)/i,
  },
  {
    code: "TITLE_DRESSES",
    toGroup: "CLOTHING",
    toSubgroup: "DRESSES",
    titleRe: /(плать|dress)/i,
  },
  {
    code: "TITLE_DENIM",
    toGroup: "CLOTHING",
    toSubgroup: "DENIM",
    titleRe: /(джинс|denim|jeans)/i,
  },
  {
    code: "TITLE_SHIRTS",
    toGroup: "CLOTHING",
    toSubgroup: "SHIRTS",
    titleRe: /(рубашк|блузк|blouse|button[- ]?down|\bshirt\b)/i,
    rejectTitleRe: /(куртк|пуховик|ветровк|пальто|жилет|футболк|t-?shirt|tee\b|top\b|tank top|майк|худи|толстовк|свитшот)/i,
  },
];

function isCatalogAiSafeRuleMatch(rule, row) {
  const title = String(row?.title || "");
  const currentGroup = String(row?.taxonomyGroup || "");
  const toGroup = String(row?.taxonomyGroupSuggested || "");
  const toSubgroup = String(row?.taxonomySubgroupSuggested || "");

  if (!title || !toGroup || !toSubgroup) return false;

  // First automatic taxonomy pass should not move bags/accessories into clothing/shoes.
  // These cases need separate review because false positives are costly.
  if (currentGroup === "BAGS" || currentGroup === "ACCESSORIES") return false;

  if (rule.toGroup !== toGroup || rule.toSubgroup !== toSubgroup) return false;
  if (!rule.titleRe.test(title)) return false;
  if (rule.rejectTitleRe && rule.rejectTitleRe.test(title)) return false;

  return true;
}

function isCatalogAiTitleSafeTaxonomyCandidate(row) {
  return CATALOG_AI_SAFE_TAXONOMY_RULES.some((rule) => isCatalogAiSafeRuleMatch(rule, row));
}

function catalogAiSafeTaxonomyRuleCodesFor(row) {
  return CATALOG_AI_SAFE_TAXONOMY_RULES
    .filter((rule) => isCatalogAiSafeRuleMatch(rule, row))
    .map((rule) => rule.code);
}


app.post("/api/admin/catalog/ai-review/apply-taxonomy-safe", async (req, res) => {
  try {
    const dryRun = String(req.query.dryRun || "1") !== "0";
    const merchant = String(req.query.merchant || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 500)));
    const minConfidence = Math.max(0, Math.min(1, Number(req.query.minConfidence || 0.9)));

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt"]);
    if (merchant && !allowedMerchants.has(merchant)) {
      return res.status(400).json({ error: "Unknown merchant" });
    }

    const params = [minConfidence, limit];

    let merchantSql = "";
    if (merchant) {
      params.push(merchant);
      merchantSql = `and p.merchant = $${params.length}`;
    }

    const rows = await prisma.$queryRawUnsafe(`
      with latest as (
        select distinct on (r."productId")
          r.id as "reviewId",
          r."productId",
          r."isTryOnRelevantSuggested",
          r."taxonomyGroupSuggested",
          r."taxonomySubgroupSuggested",
          r.confidence,
          r.explanation,
          r."rejectReasons",
          r."createdAt"
        from "CatalogProductAIReview" r
        order by r."productId", r."createdAt" desc
      )
      select
        p.id,
        p.merchant,
        p.title,
        p.category,
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."isActive",
        latest."reviewId",
        latest."taxonomyGroupSuggested",
        latest."taxonomySubgroupSuggested",
        latest.confidence,
        latest.explanation,
        latest."rejectReasons",
        latest."createdAt"
      from latest
      join "CatalogProduct" p on p.id = latest."productId"
      where p."isActive" = true
        ${merchantSql}
        and latest."isTryOnRelevantSuggested" = true
        and latest.confidence >= $1
        and coalesce(cardinality(latest."rejectReasons"), 0) = 0
        and latest."taxonomyGroupSuggested" is not null
        and latest."taxonomySubgroupSuggested" is not null
        and (
          coalesce(p."taxonomyGroup", '') <> coalesce(latest."taxonomyGroupSuggested", '')
          or coalesce(p."taxonomySubgroup", '') <> coalesce(latest."taxonomySubgroupSuggested", '')
        )
      order by latest.confidence asc, latest."createdAt" desc
      limit $2
    `, ...params);

    const rawCandidates = Array.isArray(rows) ? rows : [];

    const candidates = rawCandidates.filter((r) => isCatalogAiTitleSafeTaxonomyCandidate(r));

    const byMerchant = {};
    const byChange = {};

    for (const r of candidates) {
      const m = String(r.merchant || "");
      byMerchant[m] = (byMerchant[m] || 0) + 1;

      const key = `${r.taxonomyGroup || ""}/${r.taxonomySubgroup || ""} -> ${r.taxonomyGroupSuggested || ""}/${r.taxonomySubgroupSuggested || ""}`;
      byChange[key] = (byChange[key] || 0) + 1;
    }

    let updated = 0;

    if (!dryRun && candidates.length) {
      await prisma.$transaction(
        candidates.map((r) =>
          prisma.catalogProduct.update({
            where: { id: String(r.id) },
            data: {
              taxonomyGroup: r.taxonomyGroupSuggested,
              taxonomySubgroup: r.taxonomySubgroupSuggested,
            },
          })
        )
      );
      updated = candidates.length;

      console.log("[toptry] catalog AI safe taxonomy applied", {
        merchant: merchant || null,
        candidates: candidates.length,
        updated,
        minConfidence,
        byMerchant,
        byChange,
      });
    }

    return res.json({
      ok: true,
      dryRun,
      merchant: merchant || null,
      limit,
      minConfidence,
      safeRules: CATALOG_AI_SAFE_TAXONOMY_RULES.map((rule) => ({
        code: rule.code,
        to: { taxonomyGroup: rule.toGroup, taxonomySubgroup: rule.toSubgroup },
        titlePattern: String(rule.titleRe),
      })),
      scanned: rawCandidates.length,
      candidates: candidates.length,
      updated,
      byMerchant,
      byChange,
      items: candidates.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        title: r.title,
        category: r.category,
        current: {
          taxonomyGroup: r.taxonomyGroup,
          taxonomySubgroup: r.taxonomySubgroup,
        },
        suggested: {
          taxonomyGroup: r.taxonomyGroupSuggested,
          taxonomySubgroup: r.taxonomySubgroupSuggested,
        },
        confidence: r.confidence,
        safeRuleCodes: catalogAiSafeTaxonomyRuleCodesFor(r),
        explanation: r.explanation,
        reviewCreatedAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[toptry] catalog AI apply taxonomy safe error", e);
    return res.status(500).json({
      error: e?.message || "catalog AI apply taxonomy safe failed",
    });
  }
});


app.post("/api/admin/catalog/import/remington", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_REMINGTON_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_REMINGTON_FEED_URL is not set" });
    }

    const resp = await fetch(FEED_URL);
    if (!resp.ok) {
      return res.status(502).json({ error: `Feed fetch failed: ${resp.status}` });
    }

    const csv = await resp.text();
    const rows = parseFeedByRecordStart(csv);

    const parsedRows = rows.map((r) => {
      try {
        return parseCsv(r)[0];
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "remington" },
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

      const blockKeywords = [
        "инвентарь", "мяч", "шлем", "клюш", "ракет", "велосип", "самокат",
        "ролик", "коньк", "лыж", "сноуборд", "тренаж", "гантел", "штанг",
        "турник", "палат", "спальник", "бутыл", "фляг", "коврик",
        "защит", "маск", "очки для плав"
      ];

      const isBlocked = blockKeywords.some(k => rawCategory.includes(k));

      if (isBlocked) {
        skipped++;
        continue;
      }

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
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["param"]),
      ].join(" ");

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);

      const remingtonSignals = [
        title,
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["param"]),
      ].join(" ");

      const remingtonSignalsLc = remingtonSignals.toLowerCase();

      const gender =
        /(\b|[|/:;(),\-\s])(мужск|мужской|male|men|man)(\b|[|/:;(),\-\s])/i.test(remingtonSignals)
          ? "MALE"
          : /(\b|[|/:;(),\-\s])(женск|женский|female|women|woman)(\b|[|/:;(),\-\s])/i.test(remingtonSignals)
            ? "FEMALE"
            : normalizeCatalogGender(remingtonSignals);

      const category =
        /(кроссов|ботин|сапог|туф|кед|сланц|шлеп|угг|обув)/i.test(remingtonSignalsLc)
          ? "SHOES"
          : /(жилет|куртк|пухов|парка|ветров|бомбер|верхняя одежда)/i.test(remingtonSignalsLc)
            ? "JACKETS"
            : /(брюк|штаны|шорт|леггин|лосин|джинс)/i.test(remingtonSignalsLc)
              ? "BOTTOMS"
              : /(лонгслив|худи|свитшот|толстов|рубаш|футбол|майк|поло|джемпер|свитер|кардиган|кофта)/i.test(remingtonSignalsLc)
                ? "TOPS"
                : /(шапк|кепк|бейсболк|ремень|рюкзак|сумк|перчат|шарф)/i.test(remingtonSignalsLc)
                  ? "ACCESSORIES"
                  : normalizeCatalogCategory(remingtonSignals);

      const catalogSizes = buildCatalogSizes(r, category, [remingtonSignals, haystack].join(" "));

      const data = {
        id: `cat-remington-${externalId}`,
        merchant: "remington",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        ...catalogSizes,
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
            merchant: "remington",
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

    // Do not auto-restore inactive products after import.
    // If a product is absent from the current merchant feed, it must stay inactive;
    // otherwise stale offers keep appearing with outdated prices/sizes.
    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("remington");

    return res.json({
      ok: true,
      merchant: "remington",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/remington error", e);
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

      const catalogSizes = buildCatalogSizes(r, category, [rawCategory, haystack].join(" "));

      const data = {
        id: `cat-rendezvous-${externalId}`,
        merchant: "rendezvous",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        ...catalogSizes,
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

    // Do not auto-restore inactive products after import.
    // If a product is absent from the current merchant feed, it must stay inactive;
    // otherwise stale offers keep appearing with outdated prices/sizes.
    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("rendezvous");

    return res.json({
      ok: true,
      merchant: "rendezvous",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/rendezvous error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});




function fetchUrlBufferViaNode(url, { headers = {}, timeoutMs = 20000, maxBytes = 12 * 1024 * 1024, maxRedirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;

    const req = client.request(parsed, {
      method: "GET",
      headers,
      timeout: timeoutMs,
    }, (resp) => {
      const status = resp.statusCode || 0;
      const responseHeaders = resp.headers || {};

      if (status >= 300 && status < 400 && responseHeaders.location && maxRedirects > 0) {
        const nextUrl = new URL(responseHeaders.location, parsed).toString();
        resp.resume();
        fetchUrlBufferViaNode(nextUrl, {
          headers,
          timeoutMs,
          maxBytes,
          maxRedirects: maxRedirects - 1,
        }).then(resolve, reject);
        return;
      }

      const chunks = [];
      let total = 0;

      resp.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy(new Error(`upstream image too large: ${total}`));
          return;
        }
        chunks.push(chunk);
      });

      resp.on("end", () => {
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: responseHeaders,
          buffer: Buffer.concat(chunks),
        });
      });

      resp.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy(new Error(`upstream image timeout after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.end();
  });
}

async function fetchCatalogImageBuffer(url, headers) {
  const originalUrl = String(url);
  const candidates = [originalUrl];

  try {
    const u = new URL(originalUrl);

    if (
      (u.hostname === "sportcourt.ru" || u.hostname === "www.sportcourt.ru") &&
      u.pathname.includes("/content/models/large/")
    ) {
      const noSize = new URL(u.toString());
      noSize.pathname = noSize.pathname.replace("/content/models/large/", "/content/models/");

      const small = new URL(u.toString());
      small.pathname = small.pathname.replace("/content/models/large/", "/content/models/small/");

      candidates.push(noSize.toString(), small.toString());
    }
  } catch {}

  let lastError;

  for (const candidateUrl of candidates) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await fetchUrlBufferViaNode(candidateUrl, {
          headers,
          timeoutMs: attempt === 1 ? 15000 : 25000,
          maxBytes: 12 * 1024 * 1024,
        });

        const getHeader = (name) => {
          const v = result?.headers?.[name.toLowerCase()] ?? result?.headers?.[name];
          return Array.isArray(v) ? v.join(", ") : v;
        };

        const ct = String(getHeader("content-type") || "").toLowerCase();

        if (result.ok && ct && !ct.startsWith("image/")) {
          throw new Error(`upstream returned non-image content-type: ${ct}`);
        }

        if (candidateUrl !== originalUrl) {
          console.log("[toptry] catalog image variant OK", {
            original: originalUrl.slice(0, 180),
            variant: candidateUrl.slice(0, 180),
            contentType: ct || null,
            bytes: result?.buffer?.length || 0,
          });
        }

        return result;
      } catch (e) {
        lastError = e;
        console.warn("[toptry] catalog image upstream retry", {
          attempt,
          url: candidateUrl.slice(0, 180),
          error: e?.message || String(e),
        });
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  throw lastError || new Error("catalog image upstream fetch failed");
}

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

    const requestedWidth = Math.min(
      Math.max(parseInt(String(req.query.w || "0"), 10) || 0, 0),
      1600
    );

    const allowedHosts = new Set([
      "sportcourt.ru",
      "www.sportcourt.ru",
      "cdn.sportmaster.ru",
      "www.rendez-vous.ru",
      "goods.thecultt.com",
      "thecultt.com",
      "www.thecultt.com",
      "remington.fashion",
      "www.remington.fashion",
    ]);

    if (!allowedHosts.has(parsed.hostname)) {
      return res.status(403).json({ error: "host is not allowed" });
    }

    const catalogImageCache =
      requestedWidth > 0
        ? await readCatalogImageCache(parsed.toString(), requestedWidth)
        : null;

    if (catalogImageCache?.buffer?.length) {
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      res.setHeader("X-TopTry-Image-Cache", "hit");
      return res.send(catalogImageCache.buffer);
    }

    const upstreamHeaders = {
      "user-agent": "Mozilla/5.0 TopTryCatalogProxy",
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "referer": "https://toptry.ru/",
      "connection": "close",
    };

    const upstream = await fetchCatalogImageBuffer(parsed.toString(), upstreamHeaders);

    if (!upstream.ok) {
      return res.status(upstream.status).send("upstream image fetch failed");
    }

    const getHeader = (name) => {
      const v = upstream.headers?.[name.toLowerCase()] ?? upstream.headers?.[name];
      return Array.isArray(v) ? v.join(", ") : v;
    };

    const upstreamCt = String(getHeader("content-type") || "image/jpeg").toLowerCase();
    const upstreamCc = getHeader("cache-control") || "public, max-age=3600";
    const cacheControl = requestedWidth > 0
      ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
      : upstreamCc;

    const input = upstream.buffer;

    const shouldBypassTransform =
      requestedWidth <= 0 ||
      upstreamCt.includes("svg") ||
      upstreamCt.includes("gif");

    if (shouldBypassTransform) {
      res.setHeader("Content-Type", upstreamCt || "image/jpeg");
      res.setHeader("Cache-Control", cacheControl);
      return res.send(input);
    }

    try {
      const output = await sharp(input, { failOnError: false })
        .rotate()
        .resize({
          width: requestedWidth,
          height: requestedWidth,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 76 })
        .toBuffer();

      if (catalogImageCache && requestedWidth > 0) {
        await writeCatalogImageCache(catalogImageCache, output);
      }

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("X-TopTry-Image-Cache", catalogImageCache ? "miss-store" : "bypass");
      return res.send(output);
    } catch (transformErr) {
      console.warn("[toptry] /api/catalog/image thumbnail fallback:", transformErr?.message || transformErr);
      res.setHeader("Content-Type", upstreamCt || "image/jpeg");
      res.setHeader("Cache-Control", cacheControl);
      return res.send(input);
    }
  } catch (e) {
    console.error("[toptry] /api/catalog/image error", e);

    const rawUrl = String(req.query.url || "").trim();

    // MVP fallback: if backend proxy cannot fetch/transform an allowed upstream image
    // because a merchant CDN resets Node/Docker connections, let the browser load it directly.
    // This prevents empty catalog cards for otherwise valid image URLs.
    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      try {
        const parsed = new URL(rawUrl);
        const allowedHosts = new Set([
          "sportcourt.ru",
          "www.sportcourt.ru",
          "cdn.sportmaster.ru",
          "www.rendez-vous.ru",
          "static.rendez-vous.ru",
          "goods.thecultt.com",
          "thecultt.com",
          "www.thecultt.com",
          "remington.fashion",
          "www.remington.fashion",
        ]);

        if (allowedHosts.has(parsed.hostname)) {
          res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
          return res.redirect(302, parsed.toString());
        }
      } catch {}
    }

    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/catalog/import/thecultt", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_THECULTT_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_THECULTT_FEED_URL is not set" });
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
      where: { merchant: "thecultt" },
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

      const catalogSizes = buildCatalogSizes(r, category, [rawCategory, haystack].join(" "));

      const data = {
        id: `cat-thecultt-${externalId}`,
        merchant: "thecultt",
        externalId,
        title,
        brand: brand || null,
        category,
        gender,
        ...catalogSizes,
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
            merchant: "thecultt",
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

    // Do not auto-restore inactive products after import.
    // If a product is absent from the current merchant feed, it must stay inactive;
    // otherwise stale offers keep appearing with outdated prices/sizes.
    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("thecultt");

    return res.json({
      ok: true,
      merchant: "thecultt",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/thecultt error", e);
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

    const requestedWidth = Math.min(
      Math.max(parseInt(String(req.query.w || "0"), 10) || 0, 0),
      1600
    );

    const allowedHosts = new Set([
      "sportcourt.ru",
      "www.sportcourt.ru",
      "cdn.sportmaster.ru",
      "www.rendez-vous.ru",
    ]);

    if (!allowedHosts.has(parsed.hostname)) {
      return res.status(403).json({ error: "host is not allowed" });
    }

    const catalogImageCache =
      requestedWidth > 0
        ? await readCatalogImageCache(parsed.toString(), requestedWidth)
        : null;

    if (catalogImageCache?.buffer?.length) {
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      res.setHeader("X-TopTry-Image-Cache", "hit");
      return res.send(catalogImageCache.buffer);
    }

    const upstreamHeaders = {
      "user-agent": "Mozilla/5.0 TopTryCatalogProxy",
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "referer": "https://toptry.ru/",
      "connection": "close",
    };

    const upstream = await fetchCatalogImageBuffer(parsed.toString(), upstreamHeaders);

    if (!upstream.ok) {
      return res.status(upstream.status).send("upstream image fetch failed");
    }

    const getHeader = (name) => {
      const v = upstream.headers?.[name.toLowerCase()] ?? upstream.headers?.[name];
      return Array.isArray(v) ? v.join(", ") : v;
    };

    const upstreamCt = String(getHeader("content-type") || "image/jpeg").toLowerCase();
    const upstreamCc = getHeader("cache-control") || "public, max-age=3600";
    const cacheControl = requestedWidth > 0
      ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
      : upstreamCc;

    const input = upstream.buffer;

    const shouldBypassTransform =
      requestedWidth <= 0 ||
      upstreamCt.includes("svg") ||
      upstreamCt.includes("gif");

    if (shouldBypassTransform) {
      res.setHeader("Content-Type", upstreamCt || "image/jpeg");
      res.setHeader("Cache-Control", cacheControl);
      return res.send(input);
    }

    try {
      const output = await sharp(input, { failOnError: false })
        .rotate()
        .resize({
          width: requestedWidth,
          height: requestedWidth,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 76 })
        .toBuffer();

      if (catalogImageCache && requestedWidth > 0) {
        await writeCatalogImageCache(catalogImageCache, output);
      }

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("X-TopTry-Image-Cache", catalogImageCache ? "miss-store" : "bypass");
      return res.send(output);
    } catch (transformErr) {
      console.warn("[toptry] /api/catalog/image thumbnail fallback:", transformErr?.message || transformErr);
      res.setHeader("Content-Type", upstreamCt || "image/jpeg");
      res.setHeader("Cache-Control", cacheControl);
      return res.send(input);
    }
  } catch (e) {
    console.error("[toptry] /api/catalog/image error", e);

    const rawUrl = String(req.query.url || "").trim();

    // MVP fallback: if backend proxy cannot fetch/transform an allowed upstream image
    // because a merchant CDN resets Node/Docker connections, let the browser load it directly.
    // This prevents empty catalog cards for otherwise valid image URLs.
    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      try {
        const parsed = new URL(rawUrl);
        const allowedHosts = new Set([
          "sportcourt.ru",
          "www.sportcourt.ru",
          "cdn.sportmaster.ru",
          "www.rendez-vous.ru",
          "static.rendez-vous.ru",
          "goods.thecultt.com",
          "thecultt.com",
          "www.thecultt.com",
          "remington.fashion",
          "www.remington.fashion",
        ]);

        if (allowedHosts.has(parsed.hostname)) {
          res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
          return res.redirect(302, parsed.toString());
        }
      } catch {}
    }

    return res.status(500).json({ error: e?.message || String(e) });
  }
});



app.get("/api/catalog/brands", async (req, res) => {
  try {
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
    const clothingType =
      typeof req.query.clothingType === "string" && req.query.clothingType.trim()
        ? req.query.clothingType.trim().toUpperCase()
        : "";
    const shoeType =
      typeof req.query.shoeType === "string" && req.query.shoeType.trim()
        ? req.query.shoeType.trim().toUpperCase()
        : "";
    const discountOnly =
      String(req.query.discountOnly || "").trim() === "1";

    const where = buildCatalogDbWhere({
      merchant,
      gender,
      category,
      displayCategory,
      q,
      discountOnly,
      brand: "",
      priceMin: "",
      priceMax: "",
      clothingType,
      shoeType,
      size: "",
      sizeTop: "",
      sizeBottom: "",
      sizeShoes: "",
      sizeLoose: false,
    });

    const rows = await prisma.catalogProduct.findMany({
      where,
      select: { brand: true },
      distinct: ["brand"],
      orderBy: { brand: "asc" },
      take: 500,
    });

    const brands = rows
      .map((r) => String(r.brand || "").trim())
      .filter(Boolean);

    return res.json({ brands });
  } catch (e) {
    console.error("[toptry] /api/catalog/brands error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


function mapCatalogProductForApi(p, sizeOverride = {}) {
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
    merchant: p.merchant,
    title: p.title,
    price,
    oldPrice: oldPrice > price ? oldPrice : undefined,
    discountPercent: discountPercent > 0 ? discountPercent : undefined,
    currency: normalizeCatalogCurrency(p.currency || "RUB"),
    gender: p.gender || "UNISEX",
    category: p.category || "OTHER",
    displayCategory: normalizedDisplayCategory,
    sizes: [
      ...(sizeOverride.sizesTop || p.sizesTop || []),
      ...(sizeOverride.sizesBottom || p.sizesBottom || []),
      ...(sizeOverride.sizesShoes || p.sizesShoes || []),
    ].length
      ? Array.from(new Set([
          ...(sizeOverride.sizesTop || p.sizesTop || []),
          ...(sizeOverride.sizesBottom || p.sizesBottom || []),
          ...(sizeOverride.sizesShoes || p.sizesShoes || []),
        ]))
      : ["ONE"],
    sizesTop: sizeOverride.sizesTop || p.sizesTop || [],
    sizesBottom: sizeOverride.sizesBottom || p.sizesBottom || [],
    sizesShoes: sizeOverride.sizesShoes || p.sizesShoes || [],
    taxonomyGroup: p.taxonomyGroup || null,
    taxonomySubgroup: p.taxonomySubgroup || null,
    styleTags: p.styleTags || [],
    occasionTags: p.occasionTags || [],
    seasonTags: p.seasonTags || [],
    colorFamily: p.colorFamily || null,
    images: p.imageUrl ? [p.imageUrl] : [],
    storeId: p.merchant,
    storeName:
      p.merchant === "sportmaster"
        ? "Спортмастер"
        : p.merchant === "rendezvous"
          ? "Rendez-Vous"
          : p.merchant === "thecultt"
            ? "The Cultt"
            : p.merchant === "remington"
              ? "Remington"
              : "Sportcourt",
    availability: p.isActive,
    isCatalog: true,
    brand: p.brand || undefined,
    productUrl: p.productUrl || undefined,
    affiliateUrl: p.affiliateUrl || undefined,
  };
}


function catalogRawParamValue(rawPayload, key) {
  const param = String(rawPayload?.param || "");
  if (!param) return "";

  const wanted = String(key || "").trim().toLowerCase();

  for (const part of param.split("|")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;

    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();

    if (k === wanted) return v;
  }

  return "";
}

function normalizeCatalogDisplaySizeValue(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.replace(",", ".");
}

function sortCatalogDisplaySizes(values) {
  const order = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

  return Array.from(new Set(values.map(normalizeCatalogDisplaySizeValue).filter(Boolean))).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);

    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;

    const ai = order.indexOf(a.toUpperCase());
    const bi = order.indexOf(b.toUpperCase());

    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;

    return String(a).localeCompare(String(b), "ru");
  });
}

async function getAggregatedRendezvousSizesForProduct(p) {
  if (!p || p.merchant !== "rendezvous") return null;

  const productUrl = String(p.productUrl || "").trim();
  if (!productUrl) return null;

  const siblings = await prisma.catalogProduct.findMany({
    where: {
      merchant: p.merchant,
      productUrl,
    },
    select: {
      category: true,
      taxonomyGroup: true,
      sizesTop: true,
      sizesBottom: true,
      sizesShoes: true,
      rawPayload: true,
    },
  });

  const sizesTop = [];
  const sizesBottom = [];
  const sizesShoes = [];

  for (const row of siblings) {
    const rawSize = normalizeCatalogDisplaySizeValue(
      catalogRawParamValue(row.rawPayload || {}, "Размер")
    );

    for (const size of row.sizesTop || []) sizesTop.push(size);
    for (const size of row.sizesBottom || []) sizesBottom.push(size);
    for (const size of row.sizesShoes || []) sizesShoes.push(size);

    if (rawSize) {
      const category = String(row.category || p.category || "").toUpperCase();
      const taxonomyGroup = String(row.taxonomyGroup || p.taxonomyGroup || "").toUpperCase();

      if (category === "SHOES" || taxonomyGroup === "SHOES") {
        sizesShoes.push(rawSize);
      } else if (category === "BOTTOMS") {
        sizesBottom.push(rawSize);
      } else if (category === "TOPS" || category === "JACKETS" || category === "DRESS") {
        sizesTop.push(rawSize);
      } else {
        sizesTop.push(rawSize);
      }
    }
  }

  const result = {
    sizesTop: sortCatalogDisplaySizes(sizesTop),
    sizesBottom: sortCatalogDisplaySizes(sizesBottom),
    sizesShoes: sortCatalogDisplaySizes(sizesShoes),
  };

  if (!result.sizesTop.length && !result.sizesBottom.length && !result.sizesShoes.length) {
    return null;
  }

  return result;
}


app.get("/api/catalog/products/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Product id is required" });

    const p = await prisma.catalogProduct.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    if (!p) return res.status(404).json({ error: "Product not found" });

    const aggregatedSizes = await getAggregatedRendezvousSizesForProduct(p);

    return res.json({ product: mapCatalogProductForApi(p, aggregatedSizes || {}) });
  } catch (e) {
    console.error("[toptry] /api/catalog/products/:id error", e);
    return res.status(500).json({ error: e?.message || "catalog product failed" });
  }
});


app.get("/api/catalog/products", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "24"), 10) || 24, 1),
      48
    );
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

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
    const clothingType =
      typeof req.query.clothingType === "string" && req.query.clothingType.trim()
        ? req.query.clothingType.trim().toUpperCase()
        : "";
    const shoeType =
      typeof req.query.shoeType === "string" && req.query.shoeType.trim()
        ? req.query.shoeType.trim().toUpperCase()
        : "";
    const discountOnly =
      String(req.query.discountOnly || "").trim() === "1";
    const brand =
      typeof req.query.brand === "string" && req.query.brand.trim()
        ? req.query.brand.trim()
        : "";
    const priceMin =
      typeof req.query.priceMin === "string" && req.query.priceMin.trim()
        ? req.query.priceMin.trim()
        : "";
    const priceMax =
      typeof req.query.priceMax === "string" && req.query.priceMax.trim()
        ? req.query.priceMax.trim()
        : "";
    const sort =
      typeof req.query.sort === "string" && req.query.sort.trim()
        ? req.query.sort.trim()
        : "";

    const rawSize =
      typeof req.query.size === "string" && req.query.size.trim()
        ? req.query.size.trim().toUpperCase()
        : "";

    const sizeLoose =
      String(req.query.sizeLoose || "").trim() === "1";

    let mySizeTop = "";
    let mySizeBottom = "";
    let mySizeShoes = "";

    if (rawSize === "MY") {
      if (!req.auth?.userId) {
        return res.json({
          products: [],
          total: 0,
          limit,
          offset,
          hasMore: false,
          reason: "my_size_requires_auth",
        });
      }

      const me = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { sizeTop: true, sizeBottom: true, sizeShoes: true },
      });

      mySizeTop = me?.sizeTop || "";
      mySizeBottom = me?.sizeBottom || "";
      mySizeShoes = me?.sizeShoes || "";

      if (!mySizeTop && !mySizeBottom && !mySizeShoes) {
        return res.json({
          products: [],
          total: 0,
          limit,
          offset,
          hasMore: false,
          reason: "my_size_not_set",
        });
      }
    }

    let effectiveMySizeTop = mySizeTop;
    let effectiveMySizeBottom = mySizeBottom;
    let effectiveMySizeShoes = mySizeShoes;

    if (rawSize === "MY") {
      const requestedCategory = String(category || displayCategory || "").trim().toUpperCase();

      if (requestedCategory === "SHOES") {
        effectiveMySizeTop = "";
        effectiveMySizeBottom = "";
      } else if (requestedCategory === "BOTTOMS") {
        effectiveMySizeTop = "";
        effectiveMySizeShoes = "";
      } else if (["TOPS", "JACKETS", "OUTERWEAR"].includes(requestedCategory)) {
        effectiveMySizeBottom = "";
        effectiveMySizeShoes = "";
      } else if (["DRESS", "DRESSES"].includes(requestedCategory)) {
        effectiveMySizeShoes = "";
      }
    }

    const where = buildCatalogDbWhere({
      merchant,
      gender,
      category,
      displayCategory,
      q,
      discountOnly,
      brand,
      priceMin,
      priceMax,
      clothingType,
      shoeType,
      size: rawSize === "MY" ? "" : rawSize,
      sizeTop: effectiveMySizeTop,
      sizeBottom: effectiveMySizeBottom,
      sizeShoes: effectiveMySizeShoes,
      sizeLoose,
    });

    const matchesEffectiveMySize = (p) => {
      if (rawSize !== "MY") return true;

      const letterOrder = ["XS", "S", "M", "L", "XL", "XXL"];
      const expandLetter = (v) => {
        const s = String(v || "").trim().toUpperCase();
        if (!letterOrder.includes(s)) return [];
        if (!sizeLoose) return [s];
        const i = letterOrder.indexOf(s);
        return letterOrder.filter((_, idx) => Math.abs(idx - i) <= 1);
      };
      const expandShoe = (v) => {
        const s = String(v || "").trim();
        if (!/^(3[5-9]|4[0-6])$/.test(s)) return [];
        if (!sizeLoose) return [s];
        const n = Number(s);
        return [n - 1, n, n + 1].filter((x) => x >= 35 && x <= 46).map(String);
      };
      const anyOverlap = (a, b) => Array.isArray(a) && a.some((x) => b.includes(String(x)));

      const c = String(p?.category || "").trim().toUpperCase();

      if (c === "SHOES") {
        return anyOverlap(p?.sizesShoes, expandShoe(effectiveMySizeShoes));
      }

      if (c === "BOTTOMS") {
        return anyOverlap(p?.sizesBottom, expandLetter(effectiveMySizeBottom));
      }

      if (["TOPS", "JACKETS"].includes(c)) {
        return anyOverlap(p?.sizesTop, expandLetter(effectiveMySizeTop));
      }

      if (c === "DRESS") {
        const topOk = anyOverlap(p?.sizesTop, expandLetter(effectiveMySizeTop));
        const bottomOk = anyOverlap(p?.sizesBottom, expandLetter(effectiveMySizeBottom));
        return topOk || bottomOk;
      }

      return false;
    };

    const orderBy = getCatalogOrderBy(sort);

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
        merchant: p.merchant,
        title: p.title,
        price,
        oldPrice: oldPrice > price ? oldPrice : undefined,
        discountPercent: discountPercent > 0 ? discountPercent : undefined,
        currency: normalizeCatalogCurrency(p.currency || "RUB"),
        gender: p.gender || "UNISEX",
        category: p.category || "OTHER",
        displayCategory: normalizedDisplayCategory,
        sizes: [
          ...(p.sizesTop || []),
          ...(p.sizesBottom || []),
          ...(p.sizesShoes || []),
        ].length
          ? Array.from(new Set([...(p.sizesTop || []), ...(p.sizesBottom || []), ...(p.sizesShoes || [])]))
          : ["ONE"],
        sizesTop: p.sizesTop || [],
        sizesBottom: p.sizesBottom || [],
        sizesShoes: p.sizesShoes || [],
        taxonomyGroup: p.taxonomyGroup || null,
        taxonomySubgroup: p.taxonomySubgroup || null,
        styleTags: p.styleTags || [],
        occasionTags: p.occasionTags || [],
        seasonTags: p.seasonTags || [],
        colorFamily: p.colorFamily || null,
        images: p.imageUrl ? [p.imageUrl] : [],
        storeId: p.merchant,
        storeName:
          p.merchant === "sportmaster"
            ? "Спортмастер"
            : p.merchant === "rendezvous"
              ? "Rendez-Vous"
              : p.merchant === "thecultt"
                ? "The Cultt"
                : p.merchant === "remington"
                  ? "Remington"
                  : "Sportcourt",
        availability: p.isActive,
        isCatalog: true,
        brand: p.brand || undefined,
        productUrl: p.productUrl || undefined,
        affiliateUrl: p.affiliateUrl || undefined,
      };
    };

    let rows = [];
    let total = 0;

    if (rawSize === "MY") {
      let allRows = await prisma.catalogProduct.findMany({
        where,
        orderBy: sort === "discount_desc" ? [{ updatedAt: "desc" }] : orderBy,
      });

      allRows = allRows.filter(matchesEffectiveMySize);

      if (sort === "discount_desc") {
        allRows.sort((a, b) => {
          const priceA = Number(a.price || 0);
          const oldA = Number(a.oldPrice || 0);
          const discountA = oldA > priceA && priceA > 0 ? (oldA - priceA) / oldA : 0;

          const priceB = Number(b.price || 0);
          const oldB = Number(b.oldPrice || 0);
          const discountB = oldB > priceB && priceB > 0 ? (oldB - priceB) / oldB : 0;

          if (discountB !== discountA) return discountB - discountA;
          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        });
      }

      total = allRows.length;
      rows = allRows.slice(offset, offset + limit);
    } else if (sort === "discount_desc") {
      const allRows = await prisma.catalogProduct.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
      });

      allRows.sort((a, b) => {
        const priceA = Number(a.price || 0);
        const oldA = Number(a.oldPrice || 0);
        const discountA = oldA > priceA && priceA > 0 ? (oldA - priceA) / oldA : 0;

        const priceB = Number(b.price || 0);
        const oldB = Number(b.oldPrice || 0);
        const discountB = oldB > priceB && priceB > 0 ? (oldB - priceB) / oldB : 0;

        if (discountB !== discountA) return discountB - discountA;
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });

      total = allRows.length;
      rows = allRows.slice(offset, offset + limit);
    } else {
      [rows, total] = await Promise.all([
        prisma.catalogProduct.findMany({
          where,
          orderBy,
          skip: offset,
          take: limit,
        }),
        prisma.catalogProduct.count({ where }),
      ]);
    }

    const products = rows.map(mapProduct);

    return res.json({
      products,
      total,
      limit,
      offset,
      hasMore: offset + products.length < total,
    });
  } catch (e) {
    console.error("[toptry] /api/catalog/products error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/looks/public", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      100
    );
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

    const rows = await prisma.look.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    const looks = await Promise.all(
      rows.map(async (r) => {
        const author = await getPublicUserById(r.userId).catch(() => null);
        return {
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
          aiDescription: r.aiDescription || null,
          userDescription: r.userDescription || null,
          authorName: author?.username || author?.name || "toptry",
          authorAvatar: author?.avatarUrl || "",
        };
      })
    );

    return res.json({ looks });
  } catch (err) {
    console.error("[toptry] /api/looks/public error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
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
