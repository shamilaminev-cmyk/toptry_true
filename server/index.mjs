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
      "finn-flare.ru",
      "www.finn-flare.ru",
      "static.finn-flare.ru",
      "cdn.finn-flare.ru",
      "img.finn-flare.ru",
      "media.finn-flare.ru",
      "finnflare.com",
      "www.finnflare.com",
      "cdn.finnflare.com",
      "finn-flare.com",
      "www.finn-flare.com",
      "static.rendez-vous.ru",
      "goods.thecultt.com",
      "thecultt.com",
      "www.thecultt.com",
      "remington.fashion",
      "www.remington.fashion",
      "snowqueen.ru",
      "www.snowqueen.ru",
      "static.snowqueen.ru",
      "cdn.snowqueen.ru",
      "img.snowqueen.ru",
      "media.snowqueen.ru",
      "finn-flare.ru",
      "www.finn-flare.ru",
      "static.finn-flare.ru",
      "cdn.finn-flare.ru",
      "img.finn-flare.ru",
      "media.finn-flare.ru",
      "finnflare.com",
      "www.finnflare.com",
      "cdn.finnflare.com",
      "finn-flare.com",
      "www.finn-flare.com",
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

async function notifySupportRequestTelegram({ request, user }) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_SUPPORT_CHAT_ID || "";

  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: "telegram_not_configured" };
  }

  const text = [
    "Новое обращение TopTry",
    "",
    `Тема: ${request.topic}`,
    `Статус: ${request.status}`,
    `Источник: ${request.source}`,
    user?.phone ? `Телефон: ${user.phone}` : null,
    user?.username ? `Username: ${user.username}` : null,
    request.pageUrl ? `Страница: ${request.pageUrl}` : null,
    request.lookId ? `lookId: ${request.lookId}` : null,
    request.productId ? `productId: ${request.productId}` : null,
    "",
    String(request.message || "").slice(0, 1500),
  ].filter(Boolean).join("\n");

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok || !data?.ok) {
    throw new Error(`telegram send failed: ${resp.status} ${JSON.stringify(data)}`);
  }

  return { ok: true };
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
    const referralCode = normalizeReferralCode(req.body?.referralCode || req.body?.ref || req.query?.referralCode || req.query?.ref);

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

    const isNewUser = !user;

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

    const referralReward = await applyReferralRewardForVerifiedUser({
      userId: user.id,
      phone,
      referralCode,
      isNewUser,
    });

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
        catalogGenderPreference: user.catalogGenderPreference || null,
        isPublic: !!user.isPublic,
        createdAt: user.createdAt,
      },
      needsProfileCompletion: !user.username,
      referralReward,
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
        catalogGenderPreference: true,
        isPublic: true,
        publicSlug: true,
        publicDisplayName: true,
        publicBio: true,
        publicSocialUrl: true,
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
    const { sizeTop, sizeBottom, sizeShoes, catalogGenderPreference, publicSlug, publicDisplayName, publicBio, publicSocialUrl } = req.body || {};

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

    const normalizeCatalogGenderPreference = (v) => {
      const s = String(v || "").trim().toUpperCase();
      if (!s) return null;
      const allowed = new Set(["MALE", "FEMALE", "UNISEX", "ALL"]);
      return allowed.has(s) ? s : null;
    };

    const normalizePublicSlug = (v) => {
      const s = String(v || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);

      if (!s) return null;
      if (s.length < 3) {
        const err = new Error("Короткая ссылка должна быть не короче 3 символов");
        err.statusCode = 400;
        throw err;
      }
      return s;
    };

    const normalizeText = (v, maxLen) => {
      const s = String(v || "").trim();
      if (!s) return null;
      return s.slice(0, maxLen);
    };

    const normalizeUrl = (v) => {
      const raw = String(v || "").trim();
      if (!raw) return null;

      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

      try {
        const url = new URL(withProtocol);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return url.toString().slice(0, 500);
      } catch {
        const err = new Error("Укажите корректную ссылку на соцсеть");
        err.statusCode = 400;
        throw err;
      }
    };

    const nextPublicSlug = normalizePublicSlug(publicSlug);

    const user = await p.user.update({
      where: { id: userId },
      data: {
        sizeTop: normalizeSize(sizeTop),
        sizeBottom: normalizeSize(sizeBottom),
        sizeShoes: normalizeShoeSize(sizeShoes),
        catalogGenderPreference: normalizeCatalogGenderPreference(catalogGenderPreference),
        publicSlug: nextPublicSlug,
        publicDisplayName: normalizeText(publicDisplayName, 80),
        publicBio: normalizeText(publicBio, 280),
        publicSocialUrl: normalizeUrl(publicSocialUrl),
      },
      select: {
        id: true,
        sizeTop: true,
        sizeBottom: true,
        sizeShoes: true,
        catalogGenderPreference: true,
        publicSlug: true,
        publicDisplayName: true,
        publicBio: true,
        publicSocialUrl: true,
      },
    });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("[toptry] /api/profile/update error", err);
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Такая короткая ссылка уже занята" });
    }
    return res.status(err?.statusCode || 500).json({ error: err?.message || "Failed to update profile" });
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


// ---------- USAGE / ENTITLEMENTS ----------
const TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION = "LOOK_GENERATION";

const TOPTRY_PLAN_LIMITS = {
  FREE: { dailyLookLimit: 3, monthlyLookLimit: 20, isAdmin: false },
  TESTER: { dailyLookLimit: 20, monthlyLookLimit: 100, isAdmin: false },
  ADMIN: { dailyLookLimit: 100, monthlyLookLimit: 1000, isAdmin: true },
};

const REFERRAL_INVITER_CREDIT_AMOUNT = Number(process.env.REFERRAL_INVITER_CREDIT_AMOUNT || 3);
const REFERRAL_INVITED_CREDIT_AMOUNT = Number(process.env.REFERRAL_INVITED_CREDIT_AMOUNT || 1);

const TOPTRY_GENERATION_CREDIT_REASONS = new Set([
  "REFERRAL_INVITER",
  "REFERRAL_INVITED",
  "PURCHASE_CONFIRMED",
  "ADMIN",
  "PROMO",
]);

function normalizeToptryPlan(value) {
  const plan = String(value || "FREE").trim().toUpperCase();
  return TOPTRY_PLAN_LIMITS[plan] ? plan : "FREE";
}

function toptryPlanDefaults(planValue) {
  const plan = normalizeToptryPlan(planValue);
  return {
    plan,
    ...(TOPTRY_PLAN_LIMITS[plan] || TOPTRY_PLAN_LIMITS.FREE),
  };
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function ensureUserEntitlement(userId, overrides = {}) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("userId is required for entitlement");

  const existing = await prisma.userEntitlement.findUnique({
    where: { userId: id },
  });

  if (existing) return existing;

  const defaults = toptryPlanDefaults(overrides.plan || "FREE");

  return prisma.userEntitlement.create({
    data: {
      id: `ent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      userId: id,
      plan: defaults.plan,
      isAdmin: Boolean(defaults.isAdmin),
      dailyLookLimit: Number(defaults.dailyLookLimit || 3),
      monthlyLookLimit: Number(defaults.monthlyLookLimit || 20),
      meta: {
        source: "auto_create",
      },
    },
  });
}

async function getLookGenerationUsageSummary(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("userId is required for usage summary");

  const now = new Date();
  const dayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);
  const entitlement = await ensureUserEntitlement(id);
  const credits = await getGenerationCreditsSummary(id);

  const whereBase = {
    userId: id,
    type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION,
    status: "SUCCEEDED",
  };

  const [dailyUsed, monthlyUsed] = await Promise.all([
    prisma.usageEvent.count({
      where: {
        ...whereBase,
        createdAt: { gte: dayStart },
      },
    }),
    prisma.usageEvent.count({
      where: {
        ...whereBase,
        createdAt: { gte: monthStart },
      },
    }),
  ]);

  const dailyLimit = Math.max(0, Number(entitlement.dailyLookLimit || 0));
  const monthlyLimit = Math.max(0, Number(entitlement.monthlyLookLimit || 0));

  return {
    entitlement,
    dailyUsed,
    monthlyUsed,
    dailyLimit,
    monthlyLimit,
    dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
    monthlyRemaining: Math.max(0, monthlyLimit - monthlyUsed),
    generationCredits: credits,
    dayStart,
    monthStart,
  };
}

async function assertCanGenerateLook({ userId, qualityMode, itemCount }) {
  const summary = await getLookGenerationUsageSummary(userId);

  const dailyBlocked = summary.dailyLimit > 0 && summary.dailyUsed >= summary.dailyLimit;
  const monthlyBlocked = summary.monthlyLimit > 0 && summary.monthlyUsed >= summary.monthlyLimit;

  if (!dailyBlocked && !monthlyBlocked) {
    return { ...summary, willUseGenerationCredit: false };
  }

  if (summary.generationCredits?.remaining > 0) {
    return { ...summary, willUseGenerationCredit: true };
  }

  const limitType = dailyBlocked ? "daily" : "monthly";
  const err = new Error(
    dailyBlocked
      ? "Лимит генераций на сегодня исчерпан"
      : "Месячный лимит генераций исчерпан"
  );

  err.statusCode = 429;
  err.code = "LOOK_GENERATION_LIMIT_REACHED";
  err.limitType = limitType;
  err.usage = {
    plan: summary.entitlement.plan,
    isAdmin: !!summary.entitlement.isAdmin,
    dailyUsed: summary.dailyUsed,
    dailyLimit: summary.dailyLimit,
    dailyRemaining: summary.dailyRemaining,
    monthlyUsed: summary.monthlyUsed,
    monthlyLimit: summary.monthlyLimit,
    monthlyRemaining: summary.monthlyRemaining,
    generationCreditsRemaining: summary.generationCredits?.remaining || 0,
  };

  try {
    await prisma.usageEvent.create({
      data: {
        id: `usage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId,
        type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION,
        status: "BLOCKED_LIMIT",
        qualityMode: qualityMode || null,
        itemCount: Number.isFinite(Number(itemCount)) ? Number(itemCount) : null,
        error: err.message,
        meta: {
          code: err.code,
          limitType,
          usage: err.usage,
        },
      },
    });
  } catch (logErr) {
    console.warn("[toptry] usage blocked log failed", logErr?.message || logErr);
  }

  throw err;
}

async function createLookUsageStartedEvent({ userId, qualityMode, itemCount, meta = {} }) {
  const event = await prisma.usageEvent.create({
    data: {
      id: `usage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      userId,
      type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION,
      status: "STARTED",
      qualityMode: qualityMode || null,
      itemCount: Number.isFinite(Number(itemCount)) ? Number(itemCount) : null,
      meta,
    },
    select: { id: true },
  });

  return event.id;
}

async function finishLookUsageEvent(eventId, data = {}) {
  const id = String(eventId || "").trim();
  if (!id) return;

  try {
    await prisma.usageEvent.update({
      where: { id },
      data,
    });
  } catch (e) {
    console.warn("[toptry] usage event update failed", {
      eventId: id,
      message: e?.message || String(e),
    });
  }
}


function normalizeReferralCode(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return s.slice(0, 32);
}

function generateReferralCode(userId) {
  const src = `${String(userId || "")}|${String(process.env.REFERRAL_CODE_SECRET || "toptry")}`;
  return crypto.createHash("sha256").update(src).digest("base64url").slice(0, 8).toLowerCase();
}

async function ensureReferralCodeForUser(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("userId is required for referral code");

  const existing = await prisma.referralCode.findUnique({
    where: { userId: id },
  });

  if (existing?.code) return existing;

  let code = generateReferralCode(id);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.referralCode.create({
        data: {
          id: `refcode-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          userId: id,
          code,
        },
      });
    } catch {
      code = `${generateReferralCode(id)}${attempt + 1}`;
    }
  }

  throw new Error("Failed to create referral code");
}

function normalizeGenerationCreditReason(value) {
  const reason = String(value || "ADMIN").trim().toUpperCase();
  return TOPTRY_GENERATION_CREDIT_REASONS.has(reason) ? reason : "ADMIN";
}

async function getGenerationCreditsSummary(userId) {
  const id = String(userId || "").trim();
  if (!id) return { remaining: 0, grants: [] };

  const now = new Date();

  const grants = await prisma.generationCreditGrant.findMany({
    where: {
      userId: id,
      remaining: { gt: 0 },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: [
      { expiresAt: "asc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      amount: true,
      remaining: true,
      reason: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return {
    remaining: grants.reduce((sum, grant) => sum + Math.max(0, Number(grant.remaining || 0)), 0),
    grants,
  };
}

async function grantGenerationCredits({ userId, amount, reason = "ADMIN", expiresAt = null, meta = {} }) {
  const id = String(userId || "").trim();
  const n = Math.max(0, Math.min(10000, Math.floor(Number(amount || 0))));

  if (!id) throw new Error("userId is required");
  if (!n) throw new Error("amount must be positive");

  return prisma.generationCreditGrant.create({
    data: {
      id: `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      userId: id,
      amount: n,
      remaining: n,
      reason: normalizeGenerationCreditReason(reason),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      meta,
    },
  });
}

async function consumeGenerationCreditForLook({ userId, lookId, usageEventId = "" }) {
  const id = String(userId || "").trim();
  if (!id) return null;

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const grant = await tx.generationCreditGrant.findFirst({
      where: {
        userId: id,
        remaining: { gt: 0 },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: [
        { expiresAt: "asc" },
        { createdAt: "asc" },
      ],
    });

    if (!grant) return null;

    const currentMeta =
      grant.meta && typeof grant.meta === "object" && !Array.isArray(grant.meta)
        ? grant.meta
        : {};

    const updated = await tx.generationCreditGrant.update({
      where: { id: grant.id },
      data: {
        remaining: { decrement: 1 },
        meta: {
          ...currentMeta,
          lastConsumedAt: now.toISOString(),
          lastLookId: lookId || null,
          lastUsageEventId: usageEventId || null,
        },
      },
    });

    return {
      id: updated.id,
      reason: updated.reason,
      remaining: updated.remaining,
    };
  });
}

async function applyReferralRewardForVerifiedUser({ userId, phone, referralCode, isNewUser }) {
  const invitedUserId = String(userId || "").trim();
  const code = normalizeReferralCode(referralCode);

  // Referral bonus only for new phone-verified users.
  // Existing users logging in via someone else's link should not trigger rewards.
  if (!isNewUser || !invitedUserId || !code) return null;

  const referral = await prisma.referralCode.findUnique({
    where: { code },
  });

  if (!referral?.userId) return null;
  if (referral.userId === invitedUserId) return null;

  const existingReward = await prisma.referralReward.findUnique({
    where: { invitedUserId },
  });

  if (existingReward) return null;

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.referralReward.findUnique({
      where: { invitedUserId },
    });

    if (duplicate) return null;

    const inviterGrant = await tx.generationCreditGrant.create({
      data: {
        id: `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId: referral.userId,
        amount: REFERRAL_INVITER_CREDIT_AMOUNT,
        remaining: REFERRAL_INVITER_CREDIT_AMOUNT,
        reason: "REFERRAL_INVITER",
        meta: {
          referralCode: code,
          invitedUserId,
          invitedPhone: phone || null,
        },
      },
    });

    const invitedGrant = await tx.generationCreditGrant.create({
      data: {
        id: `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId: invitedUserId,
        amount: REFERRAL_INVITED_CREDIT_AMOUNT,
        remaining: REFERRAL_INVITED_CREDIT_AMOUNT,
        reason: "REFERRAL_INVITED",
        meta: {
          referralCode: code,
          inviterUserId: referral.userId,
        },
      },
    });

    const reward = await tx.referralReward.create({
      data: {
        id: `refreward-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        inviterUserId: referral.userId,
        invitedUserId,
        referralCode: code,
        status: "REWARDED",
        inviterCreditGrantId: inviterGrant.id,
        invitedCreditGrantId: invitedGrant.id,
        meta: {
          inviterCredits: REFERRAL_INVITER_CREDIT_AMOUNT,
          invitedCredits: REFERRAL_INVITED_CREDIT_AMOUNT,
          invitedPhone: phone || null,
        },
      },
    });

    return {
      ok: true,
      rewardId: reward.id,
      inviterCredits: REFERRAL_INVITER_CREDIT_AMOUNT,
      invitedCredits: REFERRAL_INVITED_CREDIT_AMOUNT,
    };
  });
}


async function requireTopTryAdmin(req, res, next) {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const entitlement = await prisma.userEntitlement.findUnique({
      where: { userId: req.auth.userId },
      select: { isAdmin: true, plan: true },
    });

    if (!entitlement?.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.adminEntitlement = entitlement;
    return next();
  } catch (e) {
    console.error("[toptry] requireTopTryAdmin error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

app.get("/api/usage/me", requireAuth, async (req, res) => {
  try {
    const summary = await getLookGenerationUsageSummary(req.auth.userId);

    return res.json({
      ok: true,
      usage: {
        plan: summary.entitlement.plan,
        isAdmin: !!summary.entitlement.isAdmin,
        dailyUsed: summary.dailyUsed,
        dailyLimit: summary.dailyLimit,
        dailyRemaining: summary.dailyRemaining,
        monthlyUsed: summary.monthlyUsed,
        monthlyLimit: summary.monthlyLimit,
        monthlyRemaining: summary.monthlyRemaining,
        generationCreditsRemaining: summary.generationCredits?.remaining || 0,
        generationCreditGrants: summary.generationCredits?.grants || [],
      },
    });
  } catch (e) {
    console.error("[toptry] /api/usage/me error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.get("/api/referrals/me", requireAuth, async (req, res) => {
  try {
    const referral = await ensureReferralCodeForUser(req.auth.userId);
    const webOrigin = String(process.env.PUBLIC_WEB_ORIGIN || "https://toptry.ru").replace(/\/+$/, "");
    const credits = await getGenerationCreditsSummary(req.auth.userId);

    const [invitedCount, rewards] = await Promise.all([
      prisma.referralReward.count({
        where: {
          inviterUserId: req.auth.userId,
          status: "REWARDED",
        },
      }),
      prisma.referralReward.findMany({
        where: { inviterUserId: req.auth.userId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          invitedUserId: true,
          status: true,
          createdAt: true,
          meta: true,
        },
      }),
    ]);

    return res.json({
      ok: true,
      referral: {
        code: referral.code,
        link: `${webOrigin}/#/auth?ref=${encodeURIComponent(referral.code)}`,
        inviterRewardCredits: REFERRAL_INVITER_CREDIT_AMOUNT,
        invitedRewardCredits: REFERRAL_INVITED_CREDIT_AMOUNT,
        invitedCount,
        creditsRemaining: credits.remaining,
        rewards,
      },
    });
  } catch (e) {
    console.error("[toptry] /api/referrals/me error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.get("/api/admin/dashboard/summary", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = startOfUtcMonth(now);

    const n = (value) => Number(value || 0);

    const [
      usersTotal,
      usersToday,
      users7d,
      usersWithAvatar,
      usersWithSizes,
      usageToday,
      usage7d,
      usageAvgToday,
      activeTotal,
      inactiveTotal,
      catalogByMerchant,
      catalogByMerchantGender,
      catalogByMerchantGroup,
      catalogMissingImage,
      catalogMissingPrice,
      catalogCreatedToday,
      catalogUpdatedToday,
      catalogDeactivatedToday,
      catalogMerchantHealth,
      maleShoesRisk,
      clickoutsToday,
      clickouts7d,
      clickoutsByMerchant7d,
      clickoutsByPlacement7d,
      clickoutFallback7d,
      publicLooks,
      likesTotal,
      commentsTotal,
      looksToday,
      pipelineRuns,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { avatarUrl: { not: null } } }),
      prisma.user.count({
        where: {
          OR: [
            { sizeTop: { not: null } },
            { sizeBottom: { not: null } },
            { sizeShoes: { not: null } },
          ],
        },
      }),

      prisma.usageEvent.groupBy({
        by: ["status"],
        where: { type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION, createdAt: { gte: dayStart } },
        _count: { _all: true },
      }),
      prisma.usageEvent.groupBy({
        by: ["status"],
        where: { type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION, createdAt: { gte: weekStart } },
        _count: { _all: true },
      }),
      prisma.usageEvent.aggregate({
        where: {
          type: TOPTRY_USAGE_EVENT_TYPE_LOOK_GENERATION,
          status: "SUCCEEDED",
          createdAt: { gte: dayStart },
        },
        _avg: { durationMs: true },
      }),

      prisma.catalogProduct.count({ where: { isActive: true } }),
      prisma.catalogProduct.count({ where: { isActive: false } }),
      prisma.catalogProduct.groupBy({
        by: ["merchant"],
        where: { isActive: true },
        _count: { _all: true },
        orderBy: { _count: { merchant: "desc" } },
      }),
      prisma.catalogProduct.groupBy({
        by: ["merchant", "gender"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.catalogProduct.groupBy({
        by: ["merchant", "taxonomyGroup"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.catalogProduct.count({
        where: {
          isActive: true,
          OR: [{ imageUrl: null }, { imageUrl: "" }],
        },
      }),
      prisma.catalogProduct.count({
        where: {
          isActive: true,
          OR: [{ price: null }, { price: { lte: 0 } }],
        },
      }),
      prisma.catalogProduct.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.catalogProduct.count({ where: { isActive: true, updatedAt: { gte: dayStart } } }),
      prisma.catalogProduct.count({ where: { isActive: false, updatedAt: { gte: dayStart } } }),
      prisma.$queryRaw`
        select
          merchant,
          count(*) filter (where "isActive" = true)::int as "activeTotal",
          count(*) filter (where "isActive" = false)::int as "inactiveTotal",
          count(*) filter (where "createdAt" >= ${dayStart})::int as "createdToday",
          count(*) filter (where "isActive" = true and "updatedAt" >= ${dayStart})::int as "activeUpdatedToday",
          count(*) filter (where "isActive" = false and "updatedAt" >= ${dayStart})::int as "inactiveUpdatedToday",
          count(*) filter (where "isActive" = true and gender = 'MALE' and "taxonomyGroup" = 'SHOES')::int as "activeMaleShoes",
          count(*) filter (where "isActive" = false and gender = 'MALE' and "taxonomyGroup" = 'SHOES')::int as "inactiveMaleShoes",
          count(*) filter (where "isActive" = true and gender = 'FEMALE' and "taxonomyGroup" = 'SHOES')::int as "activeFemaleShoes",
          max("updatedAt") as "lastUpdatedAt"
        from "CatalogProduct"
        group by merchant
        order by "activeTotal" desc
      `,
      prisma.catalogProduct.groupBy({
        by: ["merchant"],
        where: {
          isActive: false,
          gender: "MALE",
          taxonomyGroup: "SHOES",
        },
        _count: { _all: true },
      }),

      prisma.clickout.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.clickout.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.$queryRaw`
        select coalesce(meta->>'merchant', '') as merchant, count(*)::int as cnt
        from "Clickout"
        where "createdAt" >= ${weekStart}
        group by 1
        order by cnt desc
        limit 20
      `,
      prisma.$queryRaw`
        select coalesce(meta->>'placement', '') as placement, count(*)::int as cnt
        from "Clickout"
        where "createdAt" >= ${weekStart}
        group by 1
        order by cnt desc
        limit 20
      `,
      prisma.$queryRaw`
        select count(*)::int as cnt
        from "Clickout"
        where "createdAt" >= ${weekStart}
          and coalesce(meta->>'redirectedToFallbackCatalog', '') = 'true'
      `,

      prisma.look.count({ where: { isPublic: true } }),
      prisma.like.count(),
      prisma.comment.count(),
      prisma.look.count({ where: { createdAt: { gte: dayStart } } }),

      prisma.catalogPipelineRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          kind: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          meta: true,
          error: true,
        },
      }).catch(() => []),
    ]);

    const mapGroup = (rows, keys) =>
      (rows || []).map((row) => {
        const item = {};
        for (const key of keys) item[key] = row[key] || "";
        item.count = n(row?._count?._all ?? row?.cnt);
        return item;
      });

    const byMerchant = mapGroup(catalogByMerchant, ["merchant"]);
    const byMerchantGender = mapGroup(catalogByMerchantGender, ["merchant", "gender"]);
    const byMerchantGroup = mapGroup(catalogByMerchantGroup, ["merchant", "taxonomyGroup"]);

    const activeMaleShoesByMerchant = await prisma.catalogProduct.groupBy({
      by: ["merchant"],
      where: {
        isActive: true,
        gender: "MALE",
        taxonomyGroup: "SHOES",
      },
      _count: { _all: true },
    });

    const activeMaleShoesMap = new Map(
      activeMaleShoesByMerchant.map((row) => [row.merchant, n(row._count?._all)])
    );

    const alerts = [];

    for (const row of byMerchant) {
      if (row.count <= 0) {
        alerts.push({
          level: "danger",
          title: `${row.merchant}: нет активных товаров`,
          detail: "Продавец присутствует в каталоге, но active count равен 0.",
        });
      }
    }

    for (const row of maleShoesRisk || []) {
      const merchant = row.merchant || "";
      const inactiveMaleShoes = n(row._count?._all);
      const activeMaleShoes = activeMaleShoesMap.get(merchant) || 0;

      if (inactiveMaleShoes > 0 && activeMaleShoes === 0) {
        alerts.push({
          level: "danger",
          title: `${merchant}: мужская обувь выключена`,
          detail: `active MALE SHOES = 0, inactive MALE SHOES = ${inactiveMaleShoes}.`,
        });
      }
    }

    for (const row of catalogMerchantHealth || []) {
      const merchant = row.merchant || "";
      const activeTotalByMerchant = n(row.activeTotal);
      const inactiveUpdatedToday = n(row.inactiveUpdatedToday);
      const activeMaleShoes = n(row.activeMaleShoes);
      const inactiveMaleShoes = n(row.inactiveMaleShoes);

      if (activeTotalByMerchant > 0 && inactiveUpdatedToday > Math.max(1000, activeTotalByMerchant * 2)) {
        alerts.push({
          level: "warning",
          title: `${merchant}: много деактиваций сегодня`,
          detail: `inactive updated today = ${inactiveUpdatedToday}, active total = ${activeTotalByMerchant}. Проверь импорт/сегмент фида.`,
        });
      }

      if (inactiveMaleShoes > 0 && activeMaleShoes === 0) {
        alerts.push({
          level: "danger",
          title: `${merchant}: мужская обувь выключена`,
          detail: `active MALE SHOES = 0, inactive MALE SHOES = ${inactiveMaleShoes}.`,
        });
      }
    }

    if (catalogMissingImage > 0) {
      alerts.push({
        level: "warning",
        title: "Есть активные товары без изображения",
        detail: `${catalogMissingImage} active products без imageUrl.`,
      });
    }

    if (catalogMissingPrice > 0) {
      alerts.push({
        level: "warning",
        title: "Есть активные товары без цены",
        detail: `${catalogMissingPrice} active products без цены или с price <= 0.`,
      });
    }

    const usageTodayMap = Object.fromEntries((usageToday || []).map((row) => [row.status || "", n(row._count?._all)]));
    const failedToday = usageTodayMap.FAILED || 0;
    const succeededToday = usageTodayMap.SUCCEEDED || 0;
    const totalFinishedToday = failedToday + succeededToday;

    if (totalFinishedToday >= 5 && failedToday / totalFinishedToday > 0.2) {
      alerts.push({
        level: "danger",
        title: "Высокая доля ошибок генерации",
        detail: `FAILED ${failedToday} из ${totalFinishedToday} завершённых генераций сегодня.`,
      });
    }

    const fallbackClicks7d = n((clickoutFallback7d || [])[0]?.cnt);
    if (clickouts7d >= 10 && fallbackClicks7d / clickouts7d > 0.25) {
      alerts.push({
        level: "warning",
        title: "Много fallback-переходов вместо продавца",
        detail: `${fallbackClicks7d} из ${clickouts7d} clickouts за 7 дней ушли в fallback-каталог.`,
      });
    }

    return res.json({
      ok: true,
      generatedAt: now.toISOString(),
      users: {
        total: usersTotal,
        newToday: usersToday,
        new7d: users7d,
        withAvatar: usersWithAvatar,
        withProfileSizes: usersWithSizes,
      },
      usage: {
        today: mapGroup(usageToday, ["status"]),
        sevenDays: mapGroup(usage7d, ["status"]),
        avgDurationMsToday: Math.round(n(usageAvgToday?._avg?.durationMs)),
      },
      catalog: {
        activeTotal,
        inactiveTotal,
        createdToday: catalogCreatedToday,
        activeUpdatedToday: catalogUpdatedToday,
        inactiveUpdatedToday: catalogDeactivatedToday,
        byMerchant,
        byMerchantGender,
        byMerchantGroup,
        merchantHealth: (catalogMerchantHealth || []).map((r) => ({
          merchant: r.merchant || "",
          activeTotal: n(r.activeTotal),
          inactiveTotal: n(r.inactiveTotal),
          createdToday: n(r.createdToday),
          activeUpdatedToday: n(r.activeUpdatedToday),
          inactiveUpdatedToday: n(r.inactiveUpdatedToday),
          activeMaleShoes: n(r.activeMaleShoes),
          inactiveMaleShoes: n(r.inactiveMaleShoes),
          activeFemaleShoes: n(r.activeFemaleShoes),
          lastUpdatedAt: r.lastUpdatedAt?.toISOString?.() || r.lastUpdatedAt || null,
        })),
        missingImage: catalogMissingImage,
        missingPrice: catalogMissingPrice,
      },
      clickouts: {
        today: clickoutsToday,
        sevenDays: clickouts7d,
        fallbackSevenDays: fallbackClicks7d,
        byMerchantSevenDays: (clickoutsByMerchant7d || []).map((r) => ({ merchant: r.merchant || "unknown", count: n(r.cnt) })),
        byPlacementSevenDays: (clickoutsByPlacement7d || []).map((r) => ({ placement: r.placement || "unknown", count: n(r.cnt) })),
      },
      social: {
        publicLooks,
        likesTotal,
        commentsTotal,
        looksToday,
      },
      pipeline: {
        recentRuns: (pipelineRuns || []).map((r) => ({
          ...r,
          startedAt: r.startedAt?.toISOString?.() || r.startedAt,
          finishedAt: r.finishedAt?.toISOString?.() || r.finishedAt,
        })),
      },
      alerts,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/dashboard/summary error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/support/request", requireAuth, async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const topic = String(req.body?.topic || "").trim();
    const message = String(req.body?.message || "").trim();
    const source = String(req.body?.source || "profile").trim() || "profile";

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    if (!message || message.length < 3) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.length > 4000) {
      return res.status(400).json({ error: "Message is too long" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, username: true, email: true },
    });

    const request = await prisma.supportRequest.create({
      data: {
        id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId,
        topic,
        message,
        source,
        pageUrl: req.body?.pageUrl ? String(req.body.pageUrl).slice(0, 1000) : null,
        lookId: req.body?.lookId ? String(req.body.lookId).slice(0, 200) : null,
        productId: req.body?.productId ? String(req.body.productId).slice(0, 200) : null,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 1000),
        context: {
          clientContext: req.body?.context || null,
          ip:
            req.headers["x-forwarded-for"] ||
            req.socket?.remoteAddress ||
            null,
        },
      },
    });

    notifySupportRequestTelegram({ request, user }).catch((e) => {
      console.error("[toptry] support telegram notification error", e);
    });

    return res.json({
      ok: true,
      request: {
        id: request.id,
        topic: request.topic,
        status: request.status,
        createdAt: request.createdAt,
      },
    });
  } catch (e) {
    console.error("[toptry] /api/support/request error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/admin/support/requests", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
      : 50;

    const status = String(req.query.status || "").trim();

    const requests = await prisma.supportRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      requests: requests.map((r) => ({
        id: r.id,
        topic: r.topic,
        message: r.message,
        status: r.status,
        source: r.source,
        pageUrl: r.pageUrl,
        lookId: r.lookId,
        productId: r.productId,
        userAgent: r.userAgent,
        context: r.context,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
      })),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/support/requests error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.patch("/api/admin/support/requests/:id", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const status = String(req.body?.status || "").trim();

    const allowed = new Set(["OPEN", "IN_PROGRESS", "CLOSED", "SPAM"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const request = await prisma.supportRequest.update({
      where: { id },
      data: { status },
    });

    return res.json({
      ok: true,
      request: {
        id: request.id,
        status: request.status,
        updatedAt: request.updatedAt,
      },
    });
  } catch (e) {
    console.error("[toptry] /api/admin/support/requests/:id error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.post("/api/admin/users/credits-by-phone", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone || req.query.phone);
    if (!phone) {
      return res.status(400).json({ error: "Valid phone is required" });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, phone: true, username: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found for phone" });
    }

    const amountRaw = Number(req.body?.amount ?? req.query.amount ?? 0);
    const amount = Number.isFinite(amountRaw)
      ? Math.max(0, Math.min(10000, Math.floor(amountRaw)))
      : 0;

    if (!amount) {
      return res.status(400).json({ error: "Positive amount is required" });
    }

    const reason = normalizeGenerationCreditReason(req.body?.reason || req.query.reason || "ADMIN");
    const expiresAt = req.body?.expiresAt || req.query.expiresAt || null;
    const comment = String(req.body?.comment || req.query.comment || "").trim();

    const grant = await grantGenerationCredits({
      userId: user.id,
      amount,
      reason,
      expiresAt,
      meta: {
        source: "admin_credits_by_phone",
        phone,
        comment: comment || null,
      },
    });

    const credits = await getGenerationCreditsSummary(user.id);

    return res.json({
      ok: true,
      user,
      grant,
      generationCreditsRemaining: credits.remaining,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/users/credits-by-phone error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/users/entitlement-by-phone", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone || req.query.phone);
    if (!phone) {
      return res.status(400).json({ error: "Valid phone is required" });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, phone: true, username: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found for phone" });
    }

    const plan = normalizeToptryPlan(req.body?.plan || req.query.plan || "FREE");
    const defaults = toptryPlanDefaults(plan);

    const dailyLookLimitRaw = Number(req.body?.dailyLookLimit ?? req.query.dailyLookLimit ?? defaults.dailyLookLimit);
    const monthlyLookLimitRaw = Number(req.body?.monthlyLookLimit ?? req.query.monthlyLookLimit ?? defaults.monthlyLookLimit);

    const dailyLookLimit = Number.isFinite(dailyLookLimitRaw)
      ? Math.max(0, Math.min(10000, Math.floor(dailyLookLimitRaw)))
      : defaults.dailyLookLimit;

    const monthlyLookLimit = Number.isFinite(monthlyLookLimitRaw)
      ? Math.max(0, Math.min(100000, Math.floor(monthlyLookLimitRaw)))
      : defaults.monthlyLookLimit;

    const isAdmin =
      req.body?.isAdmin !== undefined || req.query.isAdmin !== undefined
        ? String(req.body?.isAdmin ?? req.query.isAdmin).trim() === "1" ||
          String(req.body?.isAdmin ?? req.query.isAdmin).trim().toLowerCase() === "true"
        : Boolean(defaults.isAdmin);

    const entitlement = await prisma.userEntitlement.upsert({
      where: { userId: user.id },
      create: {
        id: `ent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId: user.id,
        plan,
        isAdmin,
        dailyLookLimit,
        monthlyLookLimit,
        meta: {
          source: "admin_entitlement_by_phone",
          phone,
        },
      },
      update: {
        plan,
        isAdmin,
        dailyLookLimit,
        monthlyLookLimit,
        meta: {
          source: "admin_entitlement_by_phone",
          phone,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    return res.json({
      ok: true,
      user,
      entitlement,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/users/entitlement-by-phone error", e);
    return res.status(500).json({ error: e?.message || String(e) });
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
  let usageEventId = "";
  let usageStartedAt = Date.now();
  let usageContext = {
    qualityMode: null,
    itemCount: null,
  };

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

    usageContext = {
      qualityMode,
      itemCount: Array.isArray(itemImageUrls) ? itemImageUrls.length : null,
    };

    if (!selfieDataUrl || !Array.isArray(itemImageUrls) || itemImageUrls.length === 0) {
      return res
        .status(400)
        .json({ error: "selfieDataUrl and itemImageUrls[] are required" });
    }
    if (itemImageUrls.length > 5) {
      return res.status(400).json({ error: "Maximum 5 items per try-on in MVP" });
    }

    const usageSummary = await assertCanGenerateLook({
      userId: req.auth.userId,
      qualityMode,
      itemCount: itemImageUrls.length,
    });

    usageStartedAt = Date.now();
    usageEventId = await createLookUsageStartedEvent({
      userId: req.auth.userId,
      qualityMode,
      itemCount: itemImageUrls.length,
      meta: {
        aspectRatio: aspectRatio || null,
        source: "api_looks_create",
        plan: usageSummary.entitlement.plan,
        dailyUsedBefore: usageSummary.dailyUsed,
        dailyLimit: usageSummary.dailyLimit,
        monthlyUsedBefore: usageSummary.monthlyUsed,
        monthlyLimit: usageSummary.monthlyLimit,
      },
    });

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

    const consumedCredit = usageSummary?.willUseGenerationCredit
      ? await consumeGenerationCreditForLook({
          userId,
          lookId: id,
          usageEventId,
        })
      : null;

    await finishLookUsageEvent(usageEventId, {
      status: "SUCCEEDED",
      lookId: id,
      durationMs: Date.now() - usageStartedAt,
      meta: {
        resultImageKey,
        itemIds,
        source: "api_looks_create",
        credit: consumedCredit,
      },
    });

    return res.json({ look });
  } catch (e) {
    if (usageEventId) {
      await finishLookUsageEvent(usageEventId, {
        status: "FAILED",
        durationMs: Date.now() - usageStartedAt,
        error: String(e?.message || e).slice(0, 1000),
        meta: {
          source: "api_looks_create",
          code: e?.code || null,
          qualityMode: usageContext.qualityMode,
          itemCount: usageContext.itemCount,
        },
      });
    }

    console.error("[toptry] /api/looks/create error", e?.stack || e);

    if (e?.statusCode === 429 || e?.code === "LOOK_GENERATION_LIMIT_REACHED") {
      return res.status(429).json({
        error: e.message || "Лимит генераций исчерпан",
        code: e.code || "LOOK_GENERATION_LIMIT_REACHED",
        limitType: e.limitType || null,
        usage: e.usage || null,
      });
    }

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
  return user?.publicDisplayName || user?.username || "Автор";
}

async function mapLookForApi(row, viewerUserId = "") {
  const author = row?.user || (row?.userId
    ? await prisma.user.findUnique({
        where: { id: row.userId },
        select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true },
      }).catch(() => null)
    : null);

  let viewerLiked = false;
  let viewerSaved = false;

  if (viewerUserId && row?.id) {
    const [like, saved] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_lookId: { userId: viewerUserId, lookId: row.id } },
        select: { id: true },
      }).catch(() => null),
      prisma.savedLook.findUnique({
        where: { userId_lookId: { userId: viewerUserId, lookId: row.id } },
        select: { id: true },
      }).catch(() => null),
    ]);

    viewerLiked = !!like;
    viewerSaved = !!saved;
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
    saves: row.savesCount || 0,
    comments: row.commentsCount || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : row.createdAt.toISOString(),
    priceBuyNowRUB: row.priceBuyNowRUB || 0,
    buyLinks: row.buyLinks || [],
    aiDescription: row.aiDescription || null,
    userDescription: row.userDescription || null,
    authorName: publicAuthorName(author),
    authorAvatar: author?.avatarUrl || "",
    authorSlug: author?.publicSlug || author?.id || "",
    viewerLiked,
    viewerSaved,
  };
}

async function getLookVisibleToViewer(lookId, viewerUserId = "") {
  const row = await prisma.look.findUnique({
    where: { id: lookId },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
    },
  });

  if (!row) return null;
  if (row.isPublic || (viewerUserId && row.userId === viewerUserId)) return row;
  return null;
}



app.get("/api/profile/published-looks", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    const looks = await prisma.look.findMany({
      where: {
        userId,
        isPublic: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: {
        id: true,
        title: true,
        resultImageKey: true,
        sourceItems: true,
        likesCount: true,
        savesCount: true,
        commentsCount: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    return res.json({
      ok: true,
      looks: looks.map((look) => ({
        id: look.id,
        title: look.title || "Образ TopTry",
        resultImageUrl: look.resultImageKey ? `/media/${look.resultImageKey}` : '',
        sourceItemsCount: Array.isArray(look.sourceItems) ? look.sourceItems.length : 0,
        likes: look.likesCount || 0,
        saves: look.savesCount || 0,
        comments: look.commentsCount || 0,
        updatedAt: look.updatedAt.toISOString(),
        createdAt: look.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[toptry] /api/profile/published-looks error", err);
    return res.status(500).json({ error: err?.message || "Failed to load published looks" });
  }
});

app.get("/api/profile/look-collections", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    const collections = await prisma.lookCollection.findMany({
      where: { userId },
      orderBy: [
        { sortOrder: "asc" },
        { createdAt: "asc" },
      ],
      include: {
        items: {
          orderBy: [
            { sortOrder: "asc" },
            { createdAt: "asc" },
          ],
          include: {
            look: {
              select: {
                id: true,
                title: true,
                isPublic: true,
                resultImageKey: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      ok: true,
      collections: collections.map((collection) => ({
        id: collection.id,
        title: collection.title,
        description: collection.description || "",
        coverLookId: collection.coverLookId || "",
        isPublic: collection.isPublic,
        sortOrder: collection.sortOrder || 0,
        looksCount: (collection.items || []).filter((item) => item.look?.isPublic).length,
        looks: (collection.items || [])
          .filter((item) => item.look?.isPublic)
          .map((item) => ({
            id: item.look.id,
            title: item.look.title,
            resultImageUrl: item.look.resultImageKey ? `/media/${item.look.resultImageKey}` : '',
            updatedAt: item.look.updatedAt.toISOString(),
          })),
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[toptry] /api/profile/look-collections error", err);
    return res.status(500).json({ error: err?.message || "Failed to load collections" });
  }
});

app.post("/api/profile/look-collections", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const title = String(req.body?.title || "").trim().slice(0, 80);
    const description = String(req.body?.description || "").trim().slice(0, 220);

    if (!title) {
      return res.status(400).json({ error: "Название подборки обязательно" });
    }

    const existingCount = await prisma.lookCollection.count({ where: { userId } });
    if (existingCount >= 20) {
      return res.status(400).json({ error: "Пока можно создать до 20 подборок" });
    }

    const collection = await prisma.lookCollection.create({
      data: {
        id: `lc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId,
        title,
        description: description || null,
        isPublic: true,
        sortOrder: existingCount,
      },
    });

    return res.json({
      ok: true,
      collection: {
        id: collection.id,
        title: collection.title,
        description: collection.description || "",
        coverLookId: collection.coverLookId || "",
        isPublic: collection.isPublic,
        sortOrder: collection.sortOrder || 0,
        looksCount: 0,
        looks: [],
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[toptry] POST /api/profile/look-collections error", err);
    return res.status(500).json({ error: err?.message || "Failed to create collection" });
  }
});

app.post("/api/profile/look-collections/:id/items", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const collectionId = String(req.params.id || "");
    const lookId = String(req.body?.lookId || "");

    if (!collectionId || !lookId) {
      return res.status(400).json({ error: "collectionId and lookId are required" });
    }

    const [collection, look] = await Promise.all([
      prisma.lookCollection.findFirst({
        where: { id: collectionId, userId },
      }),
      prisma.look.findFirst({
        where: { id: lookId, userId },
        select: { id: true, isPublic: true },
      }),
    ]);

    if (!collection) {
      return res.status(404).json({ error: "Подборка не найдена" });
    }

    if (!look) {
      return res.status(404).json({ error: "Образ не найден" });
    }

    if (!look.isPublic) {
      return res.status(400).json({ error: "В подборку можно добавить только опубликованный образ" });
    }

    const currentCount = await prisma.lookCollectionItem.count({
      where: { collectionId },
    });

    const item = await prisma.lookCollectionItem.upsert({
      where: {
        collectionId_lookId: {
          collectionId,
          lookId,
        },
      },
      update: {},
      create: {
        id: `lci-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        collectionId,
        lookId,
        sortOrder: currentCount,
      },
    });

    return res.json({ ok: true, item });
  } catch (err) {
    console.error("[toptry] POST /api/profile/look-collections/:id/items error", err);
    return res.status(500).json({ error: err?.message || "Failed to add look to collection" });
  }
});

app.delete("/api/profile/look-collections/:id/items/:lookId", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const collectionId = String(req.params.id || "");
    const lookId = String(req.params.lookId || "");

    const collection = await prisma.lookCollection.findFirst({
      where: { id: collectionId, userId },
      select: { id: true },
    });

    if (!collection) {
      return res.status(404).json({ error: "Подборка не найдена" });
    }

    await prisma.lookCollectionItem.deleteMany({
      where: { collectionId, lookId },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[toptry] DELETE /api/profile/look-collections/:id/items/:lookId error", err);
    return res.status(500).json({ error: err?.message || "Failed to remove look from collection" });
  }
});


const CREATOR_EVENT_TYPES = new Set([
  "CREATOR_PROFILE_VIEW",
  "CREATOR_COLLECTION_OPEN",
  "CREATOR_LOOK_TRYON_STARTED",
  "CREATOR_CLICKOUT",
  "CREATOR_FOLLOW",
  "CREATOR_UNFOLLOW",
]);

function normalizeCreatorEventString(value, maxLen = 500) {
  const s = String(value || "").trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeCreatorEventMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

app.post("/api/creator/events", async (req, res) => {
  try {
    const type = normalizeCreatorEventString(req.body?.type, 80);
    const creatorSlug = normalizeCreatorEventString(req.body?.creatorSlug || req.body?.slug, 120);
    const collectionId = normalizeCreatorEventString(req.body?.collectionId, 120);
    const lookId = normalizeCreatorEventString(req.body?.lookId, 120);
    const source = normalizeCreatorEventString(req.body?.source, 120) || "creator_storefront";
    const pageUrl = normalizeCreatorEventString(req.body?.pageUrl, 1000);
    const meta = normalizeCreatorEventMeta(req.body?.meta);

    if (!type || !CREATOR_EVENT_TYPES.has(type)) {
      return res.status(400).json({ error: "Unsupported creator event type" });
    }

    if (!creatorSlug) {
      return res.status(400).json({ error: "creatorSlug is required" });
    }

    const creator = await prisma.user.findFirst({
      where: {
        OR: [
          { publicSlug: creatorSlug },
          { id: creatorSlug },
        ],
      },
      select: {
        id: true,
        publicSlug: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ error: "Creator not found" });
    }

    if (collectionId) {
      const collection = await prisma.lookCollection.findFirst({
        where: {
          id: collectionId,
          userId: creator.id,
          isPublic: true,
        },
        select: { id: true },
      });

      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }
    }

    if (lookId) {
      const look = await prisma.look.findFirst({
        where: {
          id: lookId,
          userId: creator.id,
          isPublic: true,
        },
        select: { id: true },
      });

      if (!look) {
        return res.status(404).json({ error: "Look not found" });
      }
    }

    const event = await prisma.creatorEvent.create({
      data: {
        id: `ce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        creatorUserId: creator.id,
        actorUserId: req.auth?.userId || null,
        type,
        creatorSlug: creator.publicSlug || creatorSlug,
        collectionId,
        lookId,
        source,
        pageUrl,
        userAgent: normalizeCreatorEventString(req.get("user-agent"), 1000),
        meta,
      },
      select: {
        id: true,
        type: true,
        creatorUserId: true,
        actorUserId: true,
        createdAt: true,
      },
    });

    return res.json({
      ok: true,
      event: {
        ...event,
        createdAt: event.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[toptry] POST /api/creator/events error", err);
    return res.status(500).json({ error: err?.message || "Failed to record creator event" });
  }
});


app.get("/api/profile/creator-analytics", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const days = Math.max(1, Math.min(90, Number(req.query.days || 7) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.creatorEvent.findMany({
      where: {
        creatorUserId: userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });

    const totals = {
      all: events.length,
      profileViews: 0,
      collectionOpens: 0,
      tryonStarts: 0,
      clickouts: 0,
    };

    const byCollection = new Map();
    const byLook = new Map();

    for (const event of events) {
      if (event.type === "CREATOR_PROFILE_VIEW") totals.profileViews += 1;
      if (event.type === "CREATOR_COLLECTION_OPEN") totals.collectionOpens += 1;
      if (event.type === "CREATOR_LOOK_TRYON_STARTED") totals.tryonStarts += 1;
      if (event.type === "CREATOR_CLICKOUT") totals.clickouts += 1;

      if (event.collectionId) {
        const row = byCollection.get(event.collectionId) || {
          collectionId: event.collectionId,
          total: 0,
          opens: 0,
          tryonStarts: 0,
          lastEventAt: null,
        };

        row.total += 1;
        if (event.type === "CREATOR_COLLECTION_OPEN") row.opens += 1;
        if (event.type === "CREATOR_LOOK_TRYON_STARTED") row.tryonStarts += 1;
        if (!row.lastEventAt || event.createdAt > row.lastEventAt) row.lastEventAt = event.createdAt;

        byCollection.set(event.collectionId, row);
      }

      if (event.lookId) {
        const row = byLook.get(event.lookId) || {
          lookId: event.lookId,
          total: 0,
          tryonStarts: 0,
          clickouts: 0,
          lastEventAt: null,
        };

        row.total += 1;
        if (event.type === "CREATOR_LOOK_TRYON_STARTED") row.tryonStarts += 1;
        if (event.type === "CREATOR_CLICKOUT") row.clickouts += 1;
        if (!row.lastEventAt || event.createdAt > row.lastEventAt) row.lastEventAt = event.createdAt;

        byLook.set(event.lookId, row);
      }
    }

    const collectionIds = Array.from(byCollection.keys());
    const lookIds = Array.from(byLook.keys());

    const [collections, looks] = await Promise.all([
      collectionIds.length
        ? prisma.lookCollection.findMany({
            where: {
              id: { in: collectionIds },
              userId,
            },
            select: {
              id: true,
              title: true,
              description: true,
            },
          })
        : [],
      lookIds.length
        ? prisma.look.findMany({
            where: {
              id: { in: lookIds },
              userId,
            },
            select: {
              id: true,
              title: true,
              resultImageKey: true,
              isPublic: true,
            },
          })
        : [],
    ]);

    const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
    const lookById = new Map(looks.map((look) => [look.id, look]));

    const popularCollections = Array.from(byCollection.values())
      .map((row) => {
        const collection = collectionById.get(row.collectionId);
        return {
          ...row,
          title: collection?.title || row.collectionId,
          description: collection?.description || "",
          lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    const popularLooks = Array.from(byLook.values())
      .map((row) => {
        const look = lookById.get(row.lookId);
        return {
          ...row,
          title: look?.title || row.lookId,
          resultImageUrl: look?.resultImageKey ? `/media/${look.resultImageKey}` : "",
          isPublic: !!look?.isPublic,
          lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    return res.json({
      ok: true,
      days,
      since: since.toISOString(),
      totals,
      popularCollections,
      popularLooks,
      recent: events.slice(0, 30).map((event) => ({
        id: event.id,
        type: event.type,
        creatorSlug: event.creatorSlug,
        collectionId: event.collectionId,
        lookId: event.lookId,
        actorUserId: event.actorUserId,
        source: event.source,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[toptry] /api/profile/creator-analytics error", err);
    return res.status(500).json({ error: err?.message || "Failed to load creator analytics" });
  }
});

app.get("/api/admin/creator/events/summary", requireAuth, requireTopTryAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30) || 30));
    const limit = Math.max(50, Math.min(5000, Number(req.query.limit || 2000) || 2000));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.creatorEvent.findMany({
      where: {
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const creatorIds = Array.from(new Set(events.map((event) => event.creatorUserId).filter(Boolean)));
    const creators = creatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: {
            id: true,
            phone: true,
            username: true,
            publicSlug: true,
            publicDisplayName: true,
            avatarUrl: true,
          },
        })
      : [];

    const creatorById = new Map(creators.map((creator) => [creator.id, creator]));

    const totals = {
      all: events.length,
      profileViews: 0,
      collectionOpens: 0,
      tryonStarts: 0,
      clickouts: 0,
    };

    const byCreator = new Map();

    for (const event of events) {
      if (event.type === "CREATOR_PROFILE_VIEW") totals.profileViews += 1;
      if (event.type === "CREATOR_COLLECTION_OPEN") totals.collectionOpens += 1;
      if (event.type === "CREATOR_LOOK_TRYON_STARTED") totals.tryonStarts += 1;
      if (event.type === "CREATOR_CLICKOUT") totals.clickouts += 1;

      const row = byCreator.get(event.creatorUserId) || {
        creatorUserId: event.creatorUserId,
        total: 0,
        profileViews: 0,
        collectionOpens: 0,
        tryonStarts: 0,
        clickouts: 0,
        lastEventAt: null,
      };

      row.total += 1;
      if (event.type === "CREATOR_PROFILE_VIEW") row.profileViews += 1;
      if (event.type === "CREATOR_COLLECTION_OPEN") row.collectionOpens += 1;
      if (event.type === "CREATOR_LOOK_TRYON_STARTED") row.tryonStarts += 1;
      if (event.type === "CREATOR_CLICKOUT") row.clickouts += 1;
      if (!row.lastEventAt || event.createdAt > row.lastEventAt) row.lastEventAt = event.createdAt;

      byCreator.set(event.creatorUserId, row);
    }

    const creatorRows = Array.from(byCreator.values())
      .map((row) => {
        const creator = creatorById.get(row.creatorUserId);
        return {
          ...row,
          lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
          publicSlug: creator?.publicSlug || "",
          publicDisplayName: creator?.publicDisplayName || "",
          username: creator?.username || "",
          phone: creator?.phone || "",
        };
      })
      .sort((a, b) => b.total - a.total);

    return res.json({
      ok: true,
      days,
      since: since.toISOString(),
      totals,
      creators: creatorRows,
      recent: events.slice(0, 50).map((event) => ({
        id: event.id,
        type: event.type,
        creatorUserId: event.creatorUserId,
        actorUserId: event.actorUserId,
        creatorSlug: event.creatorSlug,
        collectionId: event.collectionId,
        lookId: event.lookId,
        source: event.source,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[toptry] /api/admin/creator/events/summary error", err);
    return res.status(500).json({ error: err?.message || "Failed to load creator event summary" });
  }
});

app.get("/api/users/public/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "Slug is required" });

    const viewerUserId = req.auth?.userId || "";

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { publicSlug: slug },
          { id: slug },
        ],
      },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        publicSlug: true,
        publicDisplayName: true,
        publicBio: true,
        publicSocialUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [collections, looks, followersCount, viewerFollow] = await Promise.all([
      prisma.lookCollection.findMany({
        where: {
          userId: user.id,
          isPublic: true,
        },
        orderBy: [
          { sortOrder: "asc" },
          { createdAt: "asc" },
        ],
        include: {
          items: {
            orderBy: [
              { sortOrder: "asc" },
              { createdAt: "asc" },
            ],
            include: {
              look: {
                include: {
                  user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
                },
              },
            },
          },
        },
      }).catch(() => []),

      prisma.look.findMany({
        where: {
          userId: user.id,
          isPublic: true,
        },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 60,
      }),

      prisma.follow.count({
        where: { followingId: user.id },
      }).catch(() => 0),

      viewerUserId && viewerUserId !== user.id
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerUserId,
                followingId: user.id,
              },
            },
            select: { id: true },
          }).catch(() => null)
        : null,
    ]);

    const mappedLooks = await Promise.all(looks.map((row) => mapLookForApi(row, viewerUserId)));

    const mappedCollections = await Promise.all((collections || []).map(async (collection) => {
      const collectionLooks = await Promise.all(
        (collection.items || [])
          .map((item) => item.look)
          .filter((look) => look?.isPublic)
          .map((look) => mapLookForApi(look, viewerUserId))
      );

      return {
        id: collection.id,
        title: collection.title,
        description: collection.description || "",
        coverLookId: collection.coverLookId || "",
        sortOrder: collection.sortOrder || 0,
        looks: collectionLooks,
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
      };
    }));

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username || "",
        avatarUrl: user.avatarUrl || "",
        publicSlug: user.publicSlug || user.id,
        publicDisplayName: user.publicDisplayName || "",
        publicBio: user.publicBio || "",
        publicSocialUrl: user.publicSocialUrl || "",
        followersCount: Number(followersCount || 0),
        viewerFollowing: Boolean(viewerFollow),
        viewerIsOwner: Boolean(viewerUserId && viewerUserId === user.id),
        createdAt: user.createdAt.toISOString(),
      },
      collections: mappedCollections,
      looks: mappedLooks,
    });
  } catch (err) {
    console.error("[toptry] /api/users/public/:slug error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});


async function findPublicCreatorBySlug(slug) {
  const s = String(slug || "").trim();
  if (!s) return null;

  return prisma.user.findFirst({
    where: {
      OR: [
        { publicSlug: s },
        { id: s },
      ],
    },
    select: {
      id: true,
      publicSlug: true,
      publicDisplayName: true,
      username: true,
      avatarUrl: true,
    },
  });
}

app.post("/api/users/public/:slug/follow", requireAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const followerId = req.auth.userId;

    const creator = await findPublicCreatorBySlug(slug);
    if (!creator) return res.status(404).json({ error: "Creator not found" });

    if (creator.id === followerId) {
      return res.status(400).json({ error: "Нельзя подписаться на самого себя" });
    }

    await prisma.follow.upsert({
      where: {
        followerId_followingId: {
          followerId,
          followingId: creator.id,
        },
      },
      update: {},
      create: {
        id: `follow-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        followerId,
        followingId: creator.id,
      },
    });

    const followersCount = await prisma.follow.count({
      where: { followingId: creator.id },
    });

    prisma.creatorEvent.create({
      data: {
        id: `ce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        creatorUserId: creator.id,
        actorUserId: followerId,
        type: "CREATOR_FOLLOW",
        creatorSlug: creator.publicSlug || creator.id,
        source: "creator_storefront",
        pageUrl: normalizeCreatorEventString(req.get("referer"), 1000),
        userAgent: normalizeCreatorEventString(req.get("user-agent"), 1000),
        meta: {
          slug,
        },
      },
    }).catch((e) => {
      console.warn("[toptry] creator follow event failed", e?.message || String(e));
    });

    return res.json({
      ok: true,
      following: true,
      followersCount,
      creator: {
        id: creator.id,
        publicSlug: creator.publicSlug || creator.id,
        publicDisplayName: creator.publicDisplayName || "",
        username: creator.username || "",
      },
    });
  } catch (err) {
    console.error("[toptry] POST /api/users/public/:slug/follow error", err);
    return res.status(500).json({ error: err?.message || "Failed to follow creator" });
  }
});

app.delete("/api/users/public/:slug/follow", requireAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const followerId = req.auth.userId;

    const creator = await findPublicCreatorBySlug(slug);
    if (!creator) return res.status(404).json({ error: "Creator not found" });

    if (creator.id !== followerId) {
      await prisma.follow.deleteMany({
        where: {
          followerId,
          followingId: creator.id,
        },
      });

      prisma.creatorEvent.create({
        data: {
          id: `ce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          creatorUserId: creator.id,
          actorUserId: followerId,
          type: "CREATOR_UNFOLLOW",
          creatorSlug: creator.publicSlug || creator.id,
          source: "creator_storefront",
          pageUrl: normalizeCreatorEventString(req.get("referer"), 1000),
          userAgent: normalizeCreatorEventString(req.get("user-agent"), 1000),
          meta: {
            slug,
          },
        },
      }).catch((e) => {
        console.warn("[toptry] creator unfollow event failed", e?.message || String(e));
      });
    }

    const followersCount = await prisma.follow.count({
      where: { followingId: creator.id },
    });

    return res.json({
      ok: true,
      following: false,
      followersCount,
    });
  } catch (err) {
    console.error("[toptry] DELETE /api/users/public/:slug/follow error", err);
    return res.status(500).json({ error: err?.message || "Failed to unfollow creator" });
  }
});

app.get("/api/looks/following", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const creatorIds = follows.map((row) => row.followingId).filter(Boolean);

    if (!creatorIds.length) {
      return res.json({
        looks: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
      });
    }

    const [rows, total] = await Promise.all([
      prisma.look.findMany({
        where: {
          isPublic: true,
          userId: { in: creatorIds },
        },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.look.count({
        where: {
          isPublic: true,
          userId: { in: creatorIds },
        },
      }),
    ]);

    const looks = await Promise.all(rows.map((row) => mapLookForApi(row, userId)));

    return res.json({
      looks,
      total,
      limit,
      offset,
      hasMore: offset + looks.length < total,
    });
  } catch (err) {
    console.error("[toptry] /api/looks/following error", err);
    return res.status(500).json({ error: err?.message || "Failed to load following feed" });
  }
});


app.get("/api/looks/public", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "24"), 10) || 24, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const viewerUserId = req.auth?.userId || "";

    const [rows, total] = await Promise.all([
      prisma.look.findMany({
        where: { isPublic: true },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
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
        user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
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


app.get("/api/looks/saved", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

    const [rows, total] = await Promise.all([
      prisma.savedLook.findMany({
        where: { userId },
        include: {
          look: {
            include: {
              user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.savedLook.count({ where: { userId } }),
    ]);

    const visibleRows = rows
      .map((r) => r.look)
      .filter((look) => look && (look.isPublic || look.userId === userId));

    const looks = await Promise.all(visibleRows.map((look) => mapLookForApi(look, userId)));

    return res.json({
      looks,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    console.error("[toptry] /api/looks/saved error", err);
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
        user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
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
        user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
      },
    });

    return res.json({ ok: true, look: await mapLookForApi(row, userId) });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/unpublish error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});


app.delete("/api/looks/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const userId = req.auth.userId;

    const existing = await prisma.look.findFirst({
      where: { id, userId },
      select: { id: true, userId: true, resultImageKey: true },
    });

    if (!existing) return res.status(404).json({ error: "Look not found" });

    await prisma.$transaction([
      prisma.comment.deleteMany({ where: { lookId: id } }),
      prisma.like.deleteMany({ where: { lookId: id } }),
      prisma.savedLook.deleteMany({ where: { lookId: id } }),
      prisma.look.delete({ where: { id } }),
    ]);

    // Keep UsageEvent and media files for analytics/debugging in MVP.
    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[toptry] /api/looks/:id delete error", err);
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
    const reaction = String(req.body?.reaction || "like").trim();
    if (reaction !== "like") {
      return res.status(400).json({ error: "Unsupported reaction" });
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

    const fresh = await prisma.look.findUnique({
      where: { id: lookId },
      select: { likesCount: true },
    });

    return res.json({ ok: true, liked: true, likes: fresh?.likesCount || 0 });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/react error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.post("/api/looks/:id/save", requireAuth, async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;

    const look = await getLookVisibleToViewer(lookId, userId);
    if (!look) return res.status(404).json({ error: "Look not found" });

    const existing = await prisma.savedLook.findUnique({
      where: { userId_lookId: { userId, lookId } },
      select: { id: true },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.savedLook.create({
          data: {
            id: `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            userId,
            lookId,
          },
        }),
        prisma.look.update({
          where: { id: lookId },
          data: { savesCount: { increment: 1 } },
        }),
      ]);
    }

    const fresh = await prisma.look.findUnique({
      where: { id: lookId },
      select: { savesCount: true },
    });

    return res.json({ ok: true, saved: true, saves: fresh?.savesCount || 0 });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/save error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

app.delete("/api/looks/:id/save", requireAuth, async (req, res) => {
  try {
    const lookId = String(req.params.id || "");
    const userId = req.auth.userId;

    const existing = await prisma.savedLook.findUnique({
      where: { userId_lookId: { userId, lookId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.savedLook.delete({ where: { id: existing.id } }),
        prisma.look.update({
          where: { id: lookId },
          data: { savesCount: { decrement: 1 } },
        }),
      ]);
    }

    const fresh = await prisma.look.findUnique({
      where: { id: lookId },
      select: { savesCount: true },
    });

    return res.json({ ok: true, saved: false, saves: Math.max(0, fresh?.savesCount || 0) });
  } catch (err) {
    console.error("[toptry] /api/looks/:id/save delete error", err);
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
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
        user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
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
          user: { select: { id: true, username: true, avatarUrl: true, publicSlug: true, publicDisplayName: true } },
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


// ---------- CPA / OUTBOUND CLICK TRACKING ----------

function normalizeClickoutPlacement(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "unknown";
  return s.replace(/[^a-z0-9_\-:.]/g, "").slice(0, 80) || "unknown";
}

function normalizeClickoutOptionalString(value, maxLen = 500) {
  const s = String(value || "").trim();
  return s ? s.slice(0, maxLen) : null;
}

app.get("/api/out/product/:productId", async (req, res) => {
  try {
    const requestedId = String(req.params.productId || "").trim();
    if (!requestedId) return res.status(400).send("Product id is required");

    const webOrigin = String(process.env.PUBLIC_WEB_ORIGIN || "https://toptry.ru").replace(/\/+$/, "");

    const buildCatalogFallbackUrl = (source = {}) => {
      const q = [
        source?.title,
        source?.brand,
        source?.merchant,
        source?.storeName,
      ]
        .filter(Boolean)
        .map(String)
        .join(" ")
        .trim();

      const params = new URLSearchParams();
      if (q) params.set("q", q.slice(0, 120));
      params.set("unavailable", "1");

      return `${webOrigin}/#/catalog?${params.toString()}`;
    };

    let resolvedKind = "catalog_product";
    let product = await prisma.catalogProduct.findFirst({
      where: { id: requestedId, isActive: true },
      select: {
        id: true,
        merchant: true,
        title: true,
        brand: true,
        affiliateUrl: true,
        productUrl: true,
        isActive: true,
      },
    });

    // Old generated looks may store wardrobe ids for catalog items:
    // w-cat-cat-rendezvous-dedupe-... -> cat-rendezvous-dedupe-...
    const possibleCatalogId = requestedId.startsWith("w-cat-")
      ? requestedId.slice("w-cat-".length)
      : "";

    if (!product && possibleCatalogId) {
      product = await prisma.catalogProduct.findFirst({
        where: { id: possibleCatalogId, isActive: true },
        select: {
          id: true,
          merchant: true,
          title: true,
          brand: true,
          affiliateUrl: true,
          productUrl: true,
          isActive: true,
        },
      });

      if (product) {
        resolvedKind = "catalog_product_from_wardrobe_id";
      }
    }

    // Keep a non-active catalog row only as metadata / last-link fallback.
    // It should not block fallback to look snapshot.
    let inactiveProduct = null;
    if (!product) {
      const inactiveIds = [requestedId, possibleCatalogId].filter(Boolean);
      if (inactiveIds.length) {
        inactiveProduct = await prisma.catalogProduct.findFirst({
          where: { id: { in: inactiveIds } },
          select: {
            id: true,
            merchant: true,
            title: true,
            brand: true,
            affiliateUrl: true,
            productUrl: true,
            isActive: true,
          },
        });
      }
    }

    let wardrobeItem = null;

    if (!product) {
      wardrobeItem = await prisma.wardrobeItem.findFirst({
        where: {
          id: requestedId,
          sourceType: "catalog",
        },
        select: {
          id: true,
          title: true,
          brand: true,
          storeId: true,
          storeName: true,
          affiliateUrl: true,
          productUrl: true,
        },
      });

      if (wardrobeItem) {
        resolvedKind = "wardrobe_catalog_item";
      }
    }

    const placement = normalizeClickoutPlacement(req.query.placement);
    const lookId = normalizeClickoutOptionalString(req.query.lookId, 120);
    const itemIndexRaw = String(req.query.itemIndex ?? "").trim();
    const itemIndex = /^\d+$/.test(itemIndexRaw) ? Number(itemIndexRaw) : null;

    let snapshotItem = null;

    if (!product && lookId) {
      const look = await prisma.look.findUnique({
        where: { id: lookId },
        select: {
          id: true,
          userId: true,
          isPublic: true,
          sourceItems: true,
        },
      });

      const canUseLookSnapshot =
        !!look &&
        (look.isPublic || (req.auth?.userId && look.userId === req.auth.userId));

      if (canUseLookSnapshot) {
        const items = Array.isArray(look.sourceItems) ? look.sourceItems : [];

        if (itemIndex !== null && itemIndex >= 0 && itemIndex < items.length) {
          snapshotItem = items[itemIndex] || null;
        }

        if (!snapshotItem) {
          snapshotItem = items.find((item) => {
            const id = String(item?.id || "").trim();
            return id && (id === requestedId || id === possibleCatalogId);
          }) || null;
        }

        if (snapshotItem) {
          resolvedKind = "look_source_item_snapshot";
        }
      }
    }

    const sourceForLink =
      product ||
      snapshotItem ||
      wardrobeItem ||
      inactiveProduct ||
      null;

    let targetUrl = String(sourceForLink?.affiliateUrl || sourceForLink?.productUrl || "").trim();

    // If there is no saved seller link anymore, do not show a raw server error.
    // Send the user back to TopTry catalog with a search for similar active items.
    let redirectedToFallbackCatalog = false;
    if (!targetUrl) {
      targetUrl = buildCatalogFallbackUrl(sourceForLink || inactiveProduct || snapshotItem || wardrobeItem || product || {});
      redirectedToFallbackCatalog = true;
      if (!sourceForLink && !inactiveProduct && !snapshotItem && !wardrobeItem && !product) {
        resolvedKind = "fallback_catalog_no_source";
      } else {
        resolvedKind = `${resolvedKind}_fallback_catalog`;
      }
    }

    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        targetUrl = buildCatalogFallbackUrl(sourceForLink || {});
        redirectedToFallbackCatalog = true;
        resolvedKind = `${resolvedKind}_invalid_url_fallback_catalog`;
      }
    } catch {
      targetUrl = buildCatalogFallbackUrl(sourceForLink || {});
      redirectedToFallbackCatalog = true;
      resolvedKind = `${resolvedKind}_invalid_url_fallback_catalog`;
    }

    const resolvedId =
      product?.id ||
      snapshotItem?.id ||
      wardrobeItem?.id ||
      inactiveProduct?.id ||
      requestedId;

    const merchant =
      product?.merchant ||
      snapshotItem?.merchant ||
      snapshotItem?.storeId ||
      wardrobeItem?.storeId ||
      wardrobeItem?.storeName ||
      inactiveProduct?.merchant ||
      null;

    const creatorClickoutLook = lookId
      ? await prisma.look.findUnique({
          where: { id: lookId },
          select: {
            id: true,
            userId: true,
            isPublic: true,
            user: {
              select: {
                id: true,
                publicSlug: true,
              },
            },
          },
        }).catch(() => null)
      : null;

    try {
      await prisma.clickout.create({
        data: {
          id: `clickout-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          userId: req.auth?.userId || null,
          productId: product?.id || wardrobeItem?.id || inactiveProduct?.id || snapshotItem?.id || requestedId,
          meta: {
            merchant,
            productTitle:
              product?.title ||
              snapshotItem?.title ||
              wardrobeItem?.title ||
              inactiveProduct?.title ||
              null,
            placement,
            lookId,
            itemIndex,
            requestedId,
            resolvedId,
            resolvedKind,
            redirectedToFallbackCatalog,
            targetUrl,
            referer: normalizeClickoutOptionalString(req.get("referer"), 1000),
            userAgent: normalizeClickoutOptionalString(req.get("user-agent"), 1000),
            ip: normalizeClickoutOptionalString(req.ip, 120),
          },
        },
      });
    } catch (e) {
      console.warn("[toptry] clickout log failed", {
        requestedId,
        resolvedId,
        resolvedKind,
        placement,
        message: e?.message || String(e),
      });
    }

    if (creatorClickoutLook?.isPublic && creatorClickoutLook?.userId) {
      try {
        await prisma.creatorEvent.create({
          data: {
            id: `ce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            creatorUserId: creatorClickoutLook.userId,
            actorUserId: req.auth?.userId || null,
            type: "CREATOR_CLICKOUT",
            creatorSlug: creatorClickoutLook.user?.publicSlug || creatorClickoutLook.userId,
            collectionId: null,
            lookId: creatorClickoutLook.id,
            source: placement || "clickout",
            pageUrl: normalizeClickoutOptionalString(req.get("referer"), 1000),
            userAgent: normalizeClickoutOptionalString(req.get("user-agent"), 1000),
            meta: {
              merchant,
              productTitle:
                product?.title ||
                snapshotItem?.title ||
                wardrobeItem?.title ||
                inactiveProduct?.title ||
                null,
              placement,
              itemIndex,
              requestedId,
              resolvedId,
              resolvedKind,
              redirectedToFallbackCatalog,
              targetUrl,
              actorIsCreator: req.auth?.userId ? req.auth.userId === creatorClickoutLook.userId : false,
            },
          },
        });
      } catch (e) {
        console.warn("[toptry] creator clickout event failed", {
          lookId,
          requestedId,
          placement,
          message: e?.message || String(e),
        });
      }
    }

    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, targetUrl);
  } catch (e) {
    console.error("[toptry] /api/out/product/:productId error", e);
    return res.redirect(302, "https://toptry.ru/#/catalog?unavailable=1");
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


const DISABLED_CATALOG_MERCHANTS = new Set(["snowqueen"]);

function isCatalogMerchantDisabled(merchant) {
  return DISABLED_CATALOG_MERCHANTS.has(String(merchant || "").trim().toLowerCase());
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

function normalizeCatalogSizeToken(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(",", ".")
    .replace(/^2XL$/, "XXL")
    .replace(/^3XL$/, "XXL")
    .replace(/^ONE\s*SIZE$/, "ONE")
    .replace(/^ONESIZE$/, "ONE");

  if (!s) return "";
  if (["XXL", "XL", "XS", "S", "M", "L", "ONE"].includes(s)) return s;
  return "";
}

function normalizeRussianClothingNumberToLetter(n) {
  const x = Number(String(n || "").replace(",", "."));
  if (!Number.isFinite(x)) return "";

  // Conservative RU clothing size mapping into TopTry profile sizes.
  if (x <= 42) return "XS";
  if (x <= 44) return "S";
  if (x <= 46) return "M";
  if (x <= 48) return "L";
  if (x <= 50) return "XL";
  if (x <= 56) return "XXL";
  return "";
}

function normalizeCatalogSizes(raw, category = "") {
  const s = String(raw || "").toUpperCase();
  const c = String(category || "").toUpperCase();

  const letterSizes = new Set();

  for (const m of s.matchAll(/\b(XXL|XL|XS|S|M|L|2XL|3XL|ONE\s*SIZE|ONESIZE)\b/g)) {
    const v = normalizeCatalogSizeToken(m[1]);
    if (v) letterSizes.add(v);
  }

  // Clothing numeric sizes and ranges, e.g. 42-44, 46-48, 48-50.
  // Apply only to clothing categories, not shoes.
  if (["TOPS", "BOTTOMS", "JACKETS", "DRESS"].includes(c)) {
    for (const m of s.matchAll(/\b(3[8-9]|4[0-9]|5[0-6])(?:\s*[-–]\s*(3[8-9]|4[0-9]|5[0-6]))?\b/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      const mid = Math.round((a + b) / 2);
      const v = normalizeRussianClothingNumberToLetter(mid);
      if (v) letterSizes.add(v);
    }
  }

  const shoeSizes = Array.from(
    new Set(
      (s.match(/\b(3[5-9]|4[0-6])(?:[.,]5)?\b/g) || [])
        .map((v) => String(v).trim().replace(",", "."))
    )
  );

  return {
    letterSizes: Array.from(letterSizes),
    shoeSizes,
  };
}

function isSizeLikeParamValue(value) {
  const v = String(value || "").trim();
  if (!v) return false;

  // Avoid swallowing long marketing/description chunks.
  if (v.length > 80) return false;

  return /(^|[\s,;/])((XXL|XL|XS|S|M|L|2XL|3XL|ONE\s*SIZE|ONESIZE)|((3[8-9]|4[0-9]|5[0-6])\s*[-–]\s*(3[8-9]|4[0-9]|5[0-6]))|(3[5-9]|4[0-6])([.,]5)?)([\s,;/]|$)/i.test(v);
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
      key === "sizes"
    ) {
      parts.push(value);
      continue;
    }

    // Remington feed puts actual product size into "Характеристики:S", "Характеристики:2XL".
    // Accept only short size-like values.
    if (key === "характеристики" && isSizeLikeParamValue(value)) {
      parts.push(value);
      continue;
    }

    // Do NOT generally use "Размер товара на модели" as available size.
    // It describes the sample worn by the model, not stock availability.
  }

  return parts.join(" ");
}

function buildCatalogSizes(row, category, rawText) {
  const text = extractExplicitSizeText(row);
  const { letterSizes, shoeSizes } = normalizeCatalogSizes(text, category);
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

function getCatalogRowGenderSignal(row, title = "", brand = "") {
  // Use pickFirst instead of direct row.field access: CSV headers may contain BOM,
  // spaces, case differences, or alternative source names.
  return [
    pickFirst(row, ["categoryId", "category_id", "category", "category_name", "google_product_category"]),
    pickFirst(row, ["market_category", "marketCategory"]),
    pickFirst(row, ["typePrefix", "type_prefix"]),
    pickFirst(row, ["param", "params", "parameters"]),
    pickFirst(row, ["gender", "sex", "Пол"]),
    pickFirst(row, ["url", "product_url", "link", "deeplink", "affiliate_url"]),
    title,
    brand,
  ].filter(Boolean).join(" ");
}

function detectCatalogFeedGenderCoverage(rows) {
  let male = 0;
  let female = 0;
  let unisex = 0;

  const maleSegmentRe =
    /пол\s*:\s*мужск|мужская\s+обув|мужская\s+одежд|мужские\s+|мужской\s+|\/male\/|%2fmale%2f|\bmale\b|\bmen\b|\bman\b/i;
  const femaleSegmentRe =
    /пол\s*:\s*женск|женская\s+обув|женская\s+одежд|женские\s+|женский\s+|\/female\/|%2ffemale%2f|\bfemale\b|\bwomen\b|\bwoman\b/i;

  for (const row of Array.isArray(rows) ? rows : []) {
    const title = pickFirst(row, ["name", "title", "product_name", "model"]);
    const brand = pickFirst(row, ["brand", "vendor", "manufacturer"]);
    const signal = getCatalogRowGenderSignal(row, title, brand).toLowerCase();

    const hasMale = maleSegmentRe.test(signal);
    const hasFemale = femaleSegmentRe.test(signal);

    if (hasMale && !hasFemale) male++;
    else if (hasFemale && !hasMale) female++;
    else unisex++;
  }

  const total = male + female + unisex;
  const hasMale = male > 0;
  const hasFemale = female > 0;

  let segment = "mixed_or_unknown";
  if (hasFemale && !hasMale) segment = "female_only";
  else if (hasMale && !hasFemale) segment = "male_only";
  else if (hasMale && hasFemale) segment = "mixed";

  return { total, male, female, unisex, hasMale, hasFemale, segment };
}

async function deactivateCatalogProductsForFeedCoverage(merchant, coverage) {
  const m = String(merchant || "").trim().toLowerCase();
  if (!m) return { count: 0, mode: "none" };

  const segment = String(coverage?.segment || "");

  if (segment === "female_only") {
    const result = await prisma.catalogProduct.updateMany({
      where: { merchant: m, gender: "FEMALE" },
      data: { isActive: false },
    });
    return { count: result.count || 0, mode: "female_only" };
  }

  if (segment === "male_only") {
    const result = await prisma.catalogProduct.updateMany({
      where: { merchant: m, gender: "MALE" },
      data: { isActive: false },
    });
    return { count: result.count || 0, mode: "male_only" };
  }

  const result = await prisma.catalogProduct.updateMany({
    where: { merchant: m },
    data: { isActive: false },
  });
  return { count: result.count || 0, mode: "full_merchant" };
}

function normalizeCatalogCategory(raw) {
  const s = String(raw || "").toLowerCase();

  if (isCatalogNonFashionAccessoryText(s)) {
    return "OTHER";
  }

  // "Куртка-рубашка" / overshirt is outerwear, even if it contains "рубашка".
  if (/(куртк|jacket).{0,20}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,20}(куртк|jacket)/i.test(s)) {
    return "JACKETS";
  }

  // "Джинсовая рубашка" is a shirt made of denim, not bottoms/jeans.
  if (/(джинсов|denim).{0,40}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,40}(джинсов|denim)/i.test(s)) {
    return "TOPS";
  }

  if (/(кроссов|кед|ботин|ботильон|сапог|угг|туфл|балетк|лофер|мокас|босонож|эспадриль|shoe|sneaker|loafer|sandals|сандал|сланц|шл[её]п|домашняя обувь|espadrille)/i.test(s)) {
    return "SHOES";
  }

  // Clothing must win before accessory words.
  // Examples we must NOT classify as accessories:
  // "Блузка с шарфом", "Дубленка ... с ремнем", raw params mentioning ремень/шарф.
  if (/(дублен|шуб|куртк|пальто|плащ|пиджак|жакет|бомбер|парка|ветров|пухов|coat|jacket|blazer|жилет|vest)/i.test(s)) {
    return "JACKETS";
  }

  if (/(плать|сарафан|комбинезон|jumpsuit|dress)/i.test(s)) {
    return "DRESS";
  }

  if (/(брюк|джинс|trouser|pants|shorts|юбк|skirt|legging|леггин|плавки|шорты)/i.test(s)) {
    return "BOTTOMS";
  }

  if (/(футбол|майк|поло|рубаш|сорочк|блуз|лонгслив|топ|худи|свитш|свитер|джемпер|кардиган|cardigan|толстовк|олимпийк|водолазк|shirt|t-shirt|tee|hoodie|sweat|bra|бюстгаль|лиф|бикини)/i.test(s)) {
    return "TOPS";
  }

  if (/(шапк|кепк|бейсболк|панам|балаклав|картуз|cap|beanie|hat|bag|сумк|belt|ремень|очки|\bочк(и|ов|ам|ами|ах)?\b|watch|час|варежк|перчат|шарф|палантин|платок|косынк|рюкзак|кошелек|wallet|gloves|scarf|socks|носк|гольфы)/i.test(s)) {
    return "ACCESSORIES";
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

  if (/(дублен|шуб|куртк|пальто|плащ|пиджак|жакет|бомбер|парка|ветров|пухов|coat|jacket|blazer|жилет|vest)/i.test(s)) {
    return "OUTERWEAR";
  }

  if (/(плать|сарафан|комбинезон|jumpsuit|dress)/i.test(s)) {
    return "DRESSES";
  }

  if (/(брюк|джинс|trouser|pants|shorts|юбк|skirt|legging|леггин|шорты)/i.test(s)) {
    return "BOTTOMS";
  }

  if (/(футбол|майк|поло|рубаш|сорочк|блуз|лонгслив|топ|худи|свитш|свитер|джемпер|кардиган|cardigan|толстовк|олимпийк|водолазк|shirt|t-shirt|tee|hoodie|sweat)/i.test(s)) {
    return "TOPS";
  }

  if (/(шапк|кепк|бейсболк|панам|балаклав|картуз|cap|beanie|hat|belt|ремень|очки|\bочк(и|ов|ам|ами|ах)?\b|watch|час|варежк|перчат|шарф|палантин|платок|косынк|gloves|scarf|socks|носк|гольфы)/i.test(s)) {
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

  const taxonomyGroups = {
    DRESSES: ["DRESSES"],

    TOPS: [
      "TOPS",
      "TSHIRTS",
      "POLO",
      "SHIRTS",
      "FORMAL_SHIRTS",
      "CASUAL_SHIRTS",
      "OVERSHIRTS",
      "LINEN_SHIRTS",
      "DENIM_SHIRTS",
      "HOODIES",
      "KNITWEAR",
      "SWEATERS",
      "CARDIGANS",
      "TURTLENECKS",
    ],
    TSHIRTS: ["TSHIRTS"],
    POLO: ["POLO"],
    SHIRTS: ["SHIRTS", "FORMAL_SHIRTS", "CASUAL_SHIRTS", "LINEN_SHIRTS", "DENIM_SHIRTS"],
    FORMAL_SHIRTS: ["FORMAL_SHIRTS"],
    CASUAL_SHIRTS: ["CASUAL_SHIRTS"],
    OVERSHIRTS: ["OVERSHIRTS"],
    LINEN_SHIRTS: ["LINEN_SHIRTS"],
    DENIM_SHIRTS: ["DENIM_SHIRTS"],
    HOODIES: ["HOODIES"],
    KNITWEAR: ["KNITWEAR", "SWEATERS", "CARDIGANS", "TURTLENECKS"],
    SWEATERS: ["SWEATERS"],
    CARDIGANS: ["CARDIGANS"],
    TURTLENECKS: ["TURTLENECKS"],

    BOTTOMS: [
      "TROUSERS",
      "CARGO_PANTS",
      "CHINOS",
      "FORMAL_TROUSERS",
      "JOGGERS",
      "SHORTS",
      "LEGGINGS",
      "DENIM",
      "SKIRTS",
    ],
    TROUSERS: ["TROUSERS", "CARGO_PANTS", "CHINOS", "FORMAL_TROUSERS", "JOGGERS", "SHORTS", "LEGGINGS"],
    CARGO_PANTS: ["CARGO_PANTS"],
    CHINOS: ["CHINOS"],
    FORMAL_TROUSERS: ["FORMAL_TROUSERS"],
    JOGGERS: ["JOGGERS"],
    SHORTS: ["SHORTS"],
    LEGGINGS: ["LEGGINGS"],
    DENIM: ["DENIM"],
    SKIRTS: ["SKIRTS"],

    OUTERWEAR: [
      "OUTERWEAR",
      "BLAZERS",
      "COATS",
      "PUFFER_JACKETS",
      "BOMBERS",
      "PARKAS",
      "TRENCHES",
      "LEATHER_JACKETS",
      "DENIM_JACKETS",
      "VESTS",
      "OVERSHIRTS",
    ],
    BLAZERS: ["BLAZERS"],
    COATS: ["COATS"],
    PUFFER_JACKETS: ["PUFFER_JACKETS"],
    BOMBERS: ["BOMBERS"],
    PARKAS: ["PARKAS"],
    TRENCHES: ["TRENCHES"],
    LEATHER_JACKETS: ["LEATHER_JACKETS"],
    DENIM_JACKETS: ["DENIM_JACKETS"],
    VESTS: ["VESTS"],

    SUITS: ["SUITS"],
  };

  const taxonomy = taxonomyGroups[ct];
  if (!taxonomy?.length) return null;

  const fallbackEmptyTaxonomy = {
    OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }],
  };

  const titleContains = (category, needle) => ({
    category,
    OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }],
    title: { contains: needle, mode: "insensitive" },
  });

  return [
    { taxonomySubgroup: { in: taxonomy } },

    ...(ct === "DRESSES" ? [{ category: "DRESS", ...fallbackEmptyTaxonomy }] : []),
    ...(ct === "TOPS" ? [{ category: "TOPS", ...fallbackEmptyTaxonomy }] : []),
    ...(ct === "BOTTOMS" ? [{ category: "BOTTOMS", ...fallbackEmptyTaxonomy }] : []),
    ...(ct === "OUTERWEAR" ? [{ category: "JACKETS", ...fallbackEmptyTaxonomy }] : []),

    ...(ct === "BOTTOMS" ? [
      titleContains("BOTTOMS", "брюк"),
      titleContains("BOTTOMS", "джинс"),
      titleContains("BOTTOMS", "юб"),
      titleContains("BOTTOMS", "шорт"),
      titleContains("BOTTOMS", "карго"),
      titleContains("BOTTOMS", "cargo"),
    ] : []),

    ...(ct === "TROUSERS" ? [titleContains("BOTTOMS", "брюк")] : []),
    ...(ct === "CARGO_PANTS" ? [titleContains("BOTTOMS", "карго"), titleContains("BOTTOMS", "cargo")] : []),
    ...(ct === "CHINOS" ? [titleContains("BOTTOMS", "чинос"), titleContains("BOTTOMS", "chino")] : []),
    ...(ct === "FORMAL_TROUSERS" ? [titleContains("BOTTOMS", "классическ"), titleContains("BOTTOMS", "костюмн"), titleContains("BOTTOMS", "formal")] : []),
    ...(ct === "JOGGERS" ? [titleContains("BOTTOMS", "джоггер"), titleContains("BOTTOMS", "jogger")] : []),
    ...(ct === "SHORTS" ? [titleContains("BOTTOMS", "шорт"), titleContains("BOTTOMS", "shorts")] : []),
    ...(ct === "LEGGINGS" ? [titleContains("BOTTOMS", "леггин"), titleContains("BOTTOMS", "лосин"), titleContains("BOTTOMS", "legging")] : []),
    ...(ct === "DENIM" ? [titleContains("BOTTOMS", "джинс"), titleContains("BOTTOMS", "denim"), titleContains("BOTTOMS", "jeans")] : []),
    ...(ct === "SKIRTS" ? [titleContains("BOTTOMS", "юб"), titleContains("BOTTOMS", "skirt")] : []),

    ...(ct === "BLAZERS" ? [titleContains("JACKETS", "жакет"), titleContains("JACKETS", "пиджак"), titleContains("JACKETS", "blazer")] : []),
    ...(ct === "COATS" ? [titleContains("JACKETS", "пальто"), titleContains("JACKETS", "coat")] : []),
    ...(ct === "PUFFER_JACKETS" ? [titleContains("JACKETS", "пухов"), titleContains("JACKETS", "puffer"), titleContains("JACKETS", "down jacket")] : []),
    ...(ct === "BOMBERS" ? [titleContains("JACKETS", "бомбер"), titleContains("JACKETS", "bomber")] : []),
    ...(ct === "PARKAS" ? [titleContains("JACKETS", "парка"), titleContains("JACKETS", "parka")] : []),
    ...(ct === "TRENCHES" ? [titleContains("JACKETS", "тренч"), titleContains("JACKETS", "плащ"), titleContains("JACKETS", "trench")] : []),
    ...(ct === "LEATHER_JACKETS" ? [titleContains("JACKETS", "кожан"), titleContains("JACKETS", "leather")] : []),
    ...(ct === "DENIM_JACKETS" ? [titleContains("JACKETS", "джинсов"), titleContains("JACKETS", "denim")] : []),
    ...(ct === "VESTS" ? [titleContains("JACKETS", "жилет"), titleContains("JACKETS", "vest"), titleContains("JACKETS", "gilet")] : []),
    ...(ct === "OVERSHIRTS" ? [
      titleContains("TOPS", "куртка-рубаш"),
      titleContains("TOPS", "рубашка-курт"),
      titleContains("TOPS", "overshirt"),
      titleContains("JACKETS", "куртка-рубаш"),
      titleContains("JACKETS", "рубашка-курт"),
      titleContains("JACKETS", "overshirt"),
    ] : []),

    ...(ct === "TSHIRTS" ? [titleContains("TOPS", "футбол")] : []),
    ...(ct === "POLO" ? [titleContains("TOPS", "поло")] : []),
    ...(ct === "HOODIES" ? [titleContains("TOPS", "худи"), titleContains("TOPS", "свитшот"), titleContains("TOPS", "толстов")] : []),
    ...(ct === "KNITWEAR" ? [titleContains("TOPS", "свитер"), titleContains("TOPS", "джемпер"), titleContains("TOPS", "кардиган"), titleContains("TOPS", "водолаз")] : []),
    ...(ct === "SWEATERS" ? [titleContains("TOPS", "свитер"), titleContains("TOPS", "джемпер"), titleContains("TOPS", "sweater")] : []),
    ...(ct === "CARDIGANS" ? [titleContains("TOPS", "кардиган"), titleContains("TOPS", "cardigan")] : []),
    ...(ct === "TURTLENECKS" ? [titleContains("TOPS", "водолаз"), titleContains("TOPS", "turtleneck")] : []),
    ...(ct === "SHIRTS" ? [titleContains("TOPS", "рубаш"), titleContains("TOPS", "сороч"), titleContains("TOPS", "блуз")] : []),
    ...(ct === "FORMAL_SHIRTS" ? [titleContains("TOPS", "классическ"), titleContains("TOPS", "сороч"), titleContains("TOPS", "formal shirt")] : []),
    ...(ct === "CASUAL_SHIRTS" ? [titleContains("TOPS", "casual"), titleContains("TOPS", "повседнев")] : []),
    ...(ct === "LINEN_SHIRTS" ? [titleContains("TOPS", "льнян"), titleContains("TOPS", "linen")] : []),
    ...(ct === "DENIM_SHIRTS" ? [titleContains("TOPS", "джинсов"), titleContains("TOPS", "denim")] : []),

    ...(ct === "SUITS" ? [
      { OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "костюм", mode: "insensitive" } },
      { OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }], title: { contains: "suit", mode: "insensitive" } },
    ] : []),
  ];
}



function getCatalogDisplayCategoryPredicates(displayCategory) {
  const dc = String(displayCategory || "").trim().toUpperCase();
  if (!dc) return null;

  // Important:
  // top-level catalog filters must use current taxonomyGroup, not legacy category.
  // Legacy category=ACCESSORIES can contain bags, which breaks displayCategory=ACCESSORIES.
  if (dc === "CLOTHING") {
    return [{ taxonomyGroup: "CLOTHING" }];
  }

  if (dc === "SHOES") {
    return [{ taxonomyGroup: "SHOES" }];
  }

  if (dc === "BAGS") {
    return [{ taxonomyGroup: "BAGS" }];
  }

  if (dc === "ACCESSORIES") {
    return [{ taxonomyGroup: "ACCESSORIES" }];
  }

  return [{ taxonomyGroup: dc }];
}



function isCatalogNonFashionAccessoryText(value) {
  const text = String(value || "").toLowerCase();

  // Not useful for TopTry fashion/VTON catalog.
  return /зонт|umbrella|шнурк|shoelace|стельк|insole|средств[оа]\s+для\s+обув|уход\s+за\s+обув|губк[аи]\s+для\s+обув|щ[её]тк[аи]\s+для\s+обув|крем\s+для\s+обув|пропитк[аи]|дезодорант\s+для\s+обув|ложк[аи]\s+для\s+обув|аксессуар[ы]?\s+для\s+обув|shoe\s+care|shoe\s+accessor/.test(text);
}

function inferCatalogBagSubgroupFromText(value) {
  const text = String(value || "").toLowerCase();

  if (!text) return "BAGS_OTHER";

  if (/кошел|wallet|портмоне|кардхолдер|cardholder|визитниц|ключниц|косметич|органайзер|обложк/.test(text)) {
    return "BAGS_WALLET_ACCESSORY";
  }

  if (/рюкзак|backpack/.test(text)) {
    return "BAGS_BACKPACK";
  }

  if (/поясн|на\s+пояс|belt\s*bag|waist|бананка/.test(text)) {
    return "BAGS_BELT";
  }

  if (/клатч|clutch|вечерн/.test(text)) {
    return "BAGS_CLUTCH";
  }

  if (/дорож|travel|weekender|duffel|duffle|саквояж|чемодан|\b\d{2,3}\s*л\b/.test(text)) {
    return "BAGS_TRAVEL";
  }

  if (
    /кросс[\s-]?боди|cross[\s-]?body|crossbody/.test(text) ||
    /\bcrossb\b/.test(text) ||
    /[_\-\s](ew|ns|ml|jm)[_\-\s]*cross\b/.test(text) ||
    /\bcross[_\-\s]*(ew|ns|ml|jm)\b/.test(text) ||
    /[_-]cross\b/.test(text) ||
    /\bcross[_-]/.test(text)
  ) {
    return "BAGS_CROSSBODY";
  }

  if (/тоут|tote/.test(text)) {
    return "BAGS_TOTE";
  }

  if (/шоппер|shopper/.test(text)) {
    return "BAGS_SHOPPER";
  }

  // Небольшие сумки: важно проверять до общих shoulder-правил.
  if (
    /миниатюрн|мини[\s-]?сум|mini\s*bag|superamini|micro\s*bag|small\s*bag|сумка[\s-]?кисет|кисет|небольшого размера|компактн/.test(text)
  ) {
    return "BAGS_MINI";
  }

  // Shoulder / hobo / baguette / crescent / half-moon.
  // Сюда же попадают многие Snowqueen-сумки с явным плечевым или регулируемым ремнём.
  if (
    /через\s+плеч|на\s+плеч|плечев(ым|ой|ого)?\s+рем|длинн(ым|ый|ого)?\s+плечев(ым|ой|ого)?\s+рем|съемн(ым|ый|ого)?\s+регулируем(ым|ый|ого)?\s+рем|съ[её]мн(ым|ый|ого)?\s+ремешк|регулируем(ым|ый|ого)?\s+ремешк|узк(им|ий|ого)?\s+ремешк|hobo|хобо|багет|baguette|полумесяц|crescent|half[\s-]?moon|demi[\s-]?lune/.test(text)
  ) {
    return "BAGS_SHOULDER";
  }

  // Вместительные сумки с длинными/удлиненными ручками чаще ближе к shopper.
  if (
    /вместительн/.test(text) &&
    /(удлин[её]нн|длинн|двумя|две|прочн).{0,40}ручк/.test(text)
  ) {
    return "BAGS_SHOPPER";
  }

  // Сумки с двумя ручками / базовые классические вместительные формы — скорее tote, но только если есть явный признак ручек.
  if (
    /(двумя|две|удлин[её]нн|длинн|изящн).{0,40}ручк/.test(text) ||
    /top\s*handle|handle\s*bag/.test(text)
  ) {
    return "BAGS_TOTE";
  }

  // Портфель и сумка для ноутбука — не travel в строгом смысле, но для текущей таксономии ближе всего к отдельному функциональному типу.
  if (/портфель|для\s+ноутбук|ноутбук|laptop|briefcase|document\s*bag/.test(text)) {
    return "BAGS_TRAVEL";
  }

  return "BAGS_OTHER";
}


function getCatalogBagTypePredicates(bagType) {
  const bt = String(bagType || "").trim().toUpperCase();
  if (!bt) return null;

  const taxonomyGroups = {
    BAGS: [
      "BAGS_SHOULDER",
      "BAGS_CROSSBODY",
      "BAGS_TOTE",
      "BAGS_SHOPPER",
      "BAGS_BACKPACK",
      "BAGS_CLUTCH",
      "BAGS_BELT",
      "BAGS_MINI",
      "BAGS_TRAVEL",
      "BAGS_WALLET_ACCESSORY",
      "BAGS_OTHER",
      "BAGS",
    ],
    BAGS_SHOULDER: ["BAGS_SHOULDER"],
    BAGS_CROSSBODY: ["BAGS_CROSSBODY"],
    BAGS_TOTE: ["BAGS_TOTE"],
    BAGS_SHOPPER: ["BAGS_SHOPPER"],
    BAGS_BACKPACK: ["BAGS_BACKPACK"],
    BAGS_CLUTCH: ["BAGS_CLUTCH"],
    BAGS_BELT: ["BAGS_BELT"],
    BAGS_MINI: ["BAGS_MINI"],
    BAGS_TRAVEL: ["BAGS_TRAVEL"],
    BAGS_WALLET_ACCESSORY: ["BAGS_WALLET_ACCESSORY"],
    BAGS_OTHER: ["BAGS_OTHER", "BAGS"],
  };

  const taxonomy = taxonomyGroups[bt];
  if (!taxonomy?.length) return null;

  const emptyTaxonomy = { OR: [{ taxonomySubgroup: null }, { taxonomySubgroup: "" }, { taxonomySubgroup: "BAGS" }] };
  const titleContains = (needle) => ({
    taxonomyGroup: "BAGS",
    ...emptyTaxonomy,
    title: { contains: needle, mode: "insensitive" },
  });

  return [
    { taxonomyGroup: "BAGS", taxonomySubgroup: { in: taxonomy } },

    ...(bt === "BAGS_SHOULDER" ? [
      titleContains("через плеч"),
      titleContains("на плеч"),
      titleContains("shoulder"),
      titleContains("хобо"),
      titleContains("hobo"),
      titleContains("багет"),
      titleContains("baguette"),
    ] : []),

    ...(bt === "BAGS_CROSSBODY" ? [
      titleContains("кросс-боди"),
      titleContains("кросс боди"),
      titleContains("crossbody"),
      titleContains("cross body"),
      titleContains("crossb"),
      titleContains("_cross"),
      titleContains("-cross"),
    ] : []),

    ...(bt === "BAGS_TOTE" ? [
      titleContains("тоут"),
      titleContains("tote"),
    ] : []),

    ...(bt === "BAGS_SHOPPER" ? [
      titleContains("шоппер"),
      titleContains("shopper"),
    ] : []),

    ...(bt === "BAGS_BACKPACK" ? [
      titleContains("рюкзак"),
      titleContains("backpack"),
    ] : []),

    ...(bt === "BAGS_CLUTCH" ? [
      titleContains("клатч"),
      titleContains("clutch"),
      titleContains("вечер"),
      titleContains("evening"),
    ] : []),

    ...(bt === "BAGS_BELT" ? [
      titleContains("поясн"),
      titleContains("на пояс"),
      titleContains("belt bag"),
      titleContains("waist"),
      titleContains("бананка"),
    ] : []),

    ...(bt === "BAGS_MINI" ? [
      titleContains("мини"),
      titleContains("mini"),
      titleContains("small bag"),
    ] : []),

    ...(bt === "BAGS_TRAVEL" ? [
      titleContains("дорож"),
      titleContains("travel"),
      titleContains("weekender"),
      titleContains("duffel"),
      titleContains("саквояж"),
      titleContains("чемодан"),
    ] : []),

    ...(bt === "BAGS_WALLET_ACCESSORY" ? [
      titleContains("кошел"),
      titleContains("портмоне"),
      titleContains("wallet"),
      titleContains("кардхолдер"),
      titleContains("cardholder"),
      titleContains("визитниц"),
      titleContains("ключниц"),
      titleContains("косметич"),
      titleContains("органайзер"),
      titleContains("обложк"),
    ] : []),
  ];
}


function getCatalogAccessoryTypePredicates(accessoryType) {
  const at = String(accessoryType || "").trim().toUpperCase();
  if (!at) return null;

  const taxonomy = {
    HEADWEAR: ["HEADWEAR"],
    SCARVES: ["SCARVES"],
    GLOVES: ["GLOVES"],
    BELTS: ["BELTS"],
    SOCKS: ["SOCKS"],
    ACCESSORIES: ["ACCESSORIES"],
  }[at];

  if (!taxonomy?.length) return null;

  return [
    { taxonomyGroup: "ACCESSORIES", taxonomySubgroup: { in: taxonomy } },
  ];
}

function buildCatalogDbWhere({
  merchant,
  gender,
  category,
  displayCategory,
  q,
  discountOnly,
  brand,
  colorFamily,
  priceMin,
  priceMax,
  clothingType,
  shoeType,
  bagType,
  accessoryType,
  size,
  sizeTop,
  sizeBottom,
  sizeShoes,
  sizeLoose,
}) {
  const allowedMerchants = ["sportcourt", "sportmaster", "rendezvous", "thecultt", "remington", "finnflare", "snowqueen"];

  const and = [{ isActive: true }];

  if (merchant && allowedMerchants.includes(merchant)) {
    and.push({ merchant });
  }

  const genderNeedleForCatalog = String(gender || "").trim().toUpperCase();
  const displayCategoryNeedleForGender = String(displayCategory || "").trim().toUpperCase();

  if (genderNeedleForCatalog) {
    if (["BAGS", "ACCESSORIES"].includes(displayCategoryNeedleForGender)) {
      and.push({ gender: { in: [genderNeedleForCatalog, "UNISEX"] } });
    } else {
      and.push({ gender: genderNeedleForCatalog });
    }
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

  const bagTypePredicates = getCatalogBagTypePredicates(bagType);
  if (String(displayCategory || "").trim().toUpperCase() === "BAGS" && bagTypePredicates?.length) {
    and.push({ OR: bagTypePredicates });
  }

  const accessoryTypePredicates = getCatalogAccessoryTypePredicates(accessoryType);
  if (String(displayCategory || "").trim().toUpperCase() === "ACCESSORIES" && accessoryTypePredicates?.length) {
    and.push({ OR: accessoryTypePredicates });
  }

  const brandNeedle = String(brand || "").trim();
  if (brandNeedle) {
    and.push({ brand: { contains: brandNeedle, mode: "insensitive" } });
  }

  const normalizedColorFamily =
    typeof normalizeCatalogColorFamily === "function"
      ? normalizeCatalogColorFamily(colorFamily)
      : String(colorFamily || "").trim().toLowerCase();
  if (normalizedColorFamily) {
    and.push({ colorFamily: normalizedColorFamily });
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
  const brand = normalizeCatalogBrandForDedupe(
    pickFirst(row, ["brand", "vendor", "manufacturer"])
  );

  // Price must NOT be part of product identity.
  // Otherwise every price change creates a new product id and price tracking misses drops.
  return [imageUrl, brand].join("|");
}

function buildCatalogExternalId(row) {
  const dedupeKey = buildCatalogDedupeKey(row);
  return "dedupe-" + crypto.createHash("md5").update(dedupeKey).digest("hex");
}

function buildCatalogImportSkippedSample(row) {
  return {
    title: pickFirst(row, ["name", "title", "product_name", "model"]),
    brand: pickFirst(row, ["brand", "vendor", "manufacturer"]),
    categoryId: row?.categoryId || "",
    market_category: row?.market_category || "",
    typePrefix: row?.typePrefix || "",
    price: pickFirst(row, ["price", "current_price", "price_value"]),
    oldprice: pickFirst(row, ["oldprice", "old_price", "price_old"]),
    picture: pickFirst(row, ["image", "imageurl", "picture", "img"]).slice(0, 160),
    url: pickFirst(row, ["url", "product_url", "link"]).slice(0, 220),
    param: String(row?.param || "").slice(0, 320),
  };
}

function createCatalogImportDiagnostics(sampleLimit = 8) {
  const byReason = {};
  const samples = {};

  return {
    byReason,
    samples,
    skip(reason, row) {
      const key = String(reason || "unknown");
      byReason[key] = (byReason[key] || 0) + 1;

      if (!samples[key]) samples[key] = [];
      if (samples[key].length < sampleLimit) {
        samples[key].push(buildCatalogImportSkippedSample(row || {}));
      }
    },
  };
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
  "snowqueen.ru",
  "www.snowqueen.ru",
  "static.snowqueen.ru",
  "cdn.snowqueen.ru",
  "img.snowqueen.ru",
  "media.snowqueen.ru",
  "finn-flare.ru",
  "www.finn-flare.ru",
  "static.finn-flare.ru",
  "cdn.finn-flare.ru",
  "img.finn-flare.ru",
  "media.finn-flare.ru",
  "finnflare.com",
  "www.finnflare.com",
  "cdn.finnflare.com",
  "finn-flare.com",
  "www.finn-flare.com",
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
  const raw = product?.rawPayload || {};

  // Critical: category/subgroup must be inferred from source identity fields only.
  // Do not use product.category here: it may be stale/wrong from older imports.
  // Do not use brand here: e.g. "DC Shoes" makes T-shirts look like shoes.
  // Do not use full rawPayload/param here: it contains related products and articles.
  const sourceText = [
    product?.title,
    raw?.categoryId,
    raw?.market_category,
    raw?.typePrefix,
  ].filter(Boolean).join(" ").toLowerCase();

  const noisyText = [
    sourceText,
    product?.brand,
    product?.gender,
    JSON.stringify(raw || {}),
  ].filter(Boolean).join(" ").toLowerCase();

  const originalCategory = String(product?.category || "").trim().toUpperCase();

  let sourceCategory = normalizeCatalogCategory(sourceText);

  // Shoe-adjacent accessories should not become SHOES.
  // Keep this guard narrow: marketplace paths like
  // "Одежда, обувь и аксессуары/Обувь/..." are normal shoe categories,
  // not shoe accessories.
  const explicitShoeAccessoryRe =
    /(украшен(?:ие|ия)?\s+для\s+обув|jibbitz|шнурк|стельк|средств.*уход|значк|аксессуар\s+для\s+обув)/i;

  const explicitNonTryOnAccessoryRe =
    /(носк|гольфы)/i;

  const hasSourceShoePath =
    /(^|[\\/])обувь([\\/]|$)/i.test(sourceText) ||
    /женская\s+обувь|мужская\s+обувь/i.test(sourceText);

  if (explicitShoeAccessoryRe.test(sourceText) || explicitNonTryOnAccessoryRe.test(sourceText)) {
    sourceCategory = "ACCESSORIES";
  } else if (hasSourceShoePath) {
    sourceCategory = "SHOES";
  }

  const category =
    sourceCategory && sourceCategory !== "OTHER"
      ? sourceCategory
      : originalCategory && originalCategory !== "OTHER"
        ? originalCategory
        : "OTHER";

  let taxonomyGroup = "OTHER";
  let taxonomySubgroup = "";
  let styleTags = [];
  let occasionTags = [];
  let seasonTags = [];
  const colorSourceText = [
    product?.title,
    product?.brand,
    raw?.color,
    raw?.colour,
    raw?.Цвет,
    raw?.цвет,
    raw?.categoryId,
    raw?.market_category,
    raw?.typePrefix,
    raw?.model,
    raw?.param,
    raw?.description,
  ].filter(Boolean).join(" ");

  let colorFamily =
    typeof inferCatalogColorFamilyFromText === "function"
      ? inferCatalogColorFamilyFromText(colorSourceText)
      : (() => {
          const text = String(colorSourceText || "").toLowerCase();

          if (/(мульти|разноцвет|многоцвет|принт|узор|полоск|клетк|леопард|камуфляж|multi|multicolor|print|pattern|striped|check|plaid|leopard|camo)/i.test(text)) return "multi";
          if (/(черн|ч[её]рн|black|nero|noir)/i.test(text)) return "black";
          if (/(бел|молочн|айвори|ivory|white|bianco|off[\s-]?white)/i.test(text)) return "white";
          if (/(сер|графит|антрацит|silver|grey|gray|grigio|graphite|anthracite)/i.test(text)) return "gray";
          if (/(беж|кремов|песочн|beige|cream|sand|taupe|nude)/i.test(text)) return "beige";
          if (/(коричн|шоколад|коньяк|табач|camel|brown|cognac|chocolate|marrone)/i.test(text)) return "brown";
          if (/(син|голуб|navy|blue|azure|denim|indigo)/i.test(text)) return "blue";
          if (/(зел[её]н|хаки|олив|green|khaki|olive|verde)/i.test(text)) return "green";
          if (/(красн|бордов|винн|бургунд|red|burgundy|wine|rosso)/i.test(text)) return "red";
          if (/(розов|фукси|pink|fuchsia|rose)/i.test(text)) return "pink";
          if (/(фиолет|сирен|лилов|purple|violet|lavender|lilla)/i.test(text)) return "purple";
          if (/(желт|ж[её]лт|горчич|золот|gold|yellow|mustard|oro)/i.test(text)) return "yellow";
          if (/(оранж|orange|arancio)/i.test(text)) return "orange";

          return "";
        })();

  if (isCatalogNonFashionAccessoryText(`${sourceText} ${noisyText}`)) {
    return {
      taxonomyGroup: "OTHER",
      taxonomySubgroup: "",
      taxonomySource: "rules_v4_source_category_first",
      taxonomyEnrichedAt: new Date(),
      styleTags: [],
      occasionTags: [],
      seasonTags: [],
      colorFamily,
    };
  }

  if (category === "SHOES") {
    taxonomyGroup = "SHOES";

    if (/балетк|ballet/.test(sourceText)) taxonomySubgroup = "BALLET";
    else if (/угг|ботфорт|высок.*сапог|tall boot|ugg/.test(sourceText)) taxonomySubgroup = "TALL_BOOTS";
    else if (/кроссов|sneaker|runner|running|trainer|trail/.test(sourceText)) taxonomySubgroup = "SNEAKERS";
    else if (/кед|слипон|slip[-\s]?on|canvas|plimsoll/.test(sourceText)) taxonomySubgroup = "SNEAKERS_CASUAL";
    else if (/лофер|loafer|мокас/.test(sourceText)) taxonomySubgroup = "LOAFERS";
    else if (/домашн.*обув|тапоч|сандал|босонож|сабо|эспадриль|сланц|шл[её]п|sand|espadrille/.test(sourceText)) taxonomySubgroup = "SANDALS";
    else if (/туф|oxford|дерби|монк|brogue|formal shoe/.test(sourceText)) taxonomySubgroup = "SHOES_CLASSIC";
    else if (/ботин|ботильон|boot|chelsea|chukka|сапог/.test(sourceText)) taxonomySubgroup = "BOOTS";
  } else if (["TOPS", "BOTTOMS", "JACKETS", "DRESS"].includes(category)) {
    taxonomyGroup = "CLOTHING";

    if (category === "DRESS") {
      taxonomySubgroup = "DRESSES";
    } else if (category === "JACKETS") {
      if (/(куртк|jacket).{0,24}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,24}(куртк|jacket)|overshirt/.test(sourceText)) taxonomySubgroup = "OVERSHIRTS";
      else if (/(жакет|пиджак|blazer)/.test(sourceText)) taxonomySubgroup = "BLAZERS";
      else if (/пальто|coat/.test(sourceText)) taxonomySubgroup = "COATS";
      else if (/пухов|дутик|down jacket|puffer/.test(sourceText)) taxonomySubgroup = "PUFFER_JACKETS";
      else if (/бомбер|bomber/.test(sourceText)) taxonomySubgroup = "BOMBERS";
      else if (/парка|parka/.test(sourceText)) taxonomySubgroup = "PARKAS";
      else if (/тренч|плащ|trench/.test(sourceText)) taxonomySubgroup = "TRENCHES";
      else if (/кожан|leather/.test(sourceText)) taxonomySubgroup = "LEATHER_JACKETS";
      else if (/джинсов|denim/.test(sourceText)) taxonomySubgroup = "DENIM_JACKETS";
      else if (/жилет|vest|gilet/.test(sourceText)) taxonomySubgroup = "VESTS";
      else taxonomySubgroup = "OUTERWEAR";
    } else if (category === "BOTTOMS") {
      if (/(джинсов|denim).{0,40}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,40}(джинсов|denim)/.test(sourceText)) taxonomySubgroup = "DENIM_SHIRTS";
      else if (/юбк|skirt/.test(sourceText)) taxonomySubgroup = "SKIRTS";
      else if (/джинс|denim|jeans/.test(sourceText)) taxonomySubgroup = "DENIM";
      else if (/карго|cargo/.test(sourceText)) taxonomySubgroup = "CARGO_PANTS";
      else if (/чинос|chino/.test(sourceText)) taxonomySubgroup = "CHINOS";
      else if (/джоггер|jogger|треники|спортивн.*брюк/.test(sourceText)) taxonomySubgroup = "JOGGERS";
      else if (/шорт|shorts/.test(sourceText)) taxonomySubgroup = "SHORTS";
      else if (/леггин|лосин|legging/.test(sourceText)) taxonomySubgroup = "LEGGINGS";
      else if (/классическ.*брюк|костюмн.*брюк|formal trouser|suit pants|dress pants|slacks/.test(sourceText)) taxonomySubgroup = "FORMAL_TROUSERS";
      else taxonomySubgroup = "TROUSERS";
    } else if (category === "TOPS") {
      const knitPoloRe = /(джемпер|свитер|кардиган|водолазк|knit|sweater|cardigan)[\s\-]+поло|поло[\s\-]+(джемпер|свитер|кардиган|водолазк|knit|sweater|cardigan)/i;

      if (/(куртк|jacket).{0,20}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,20}(куртк|jacket)|overshirt/i.test(sourceText)) taxonomySubgroup = "OVERSHIRTS";
      else if (knitPoloRe.test(sourceText)) taxonomySubgroup = "KNITWEAR";
      else if (/худи|hoodie|свитшот|sweatshirt|толстов/.test(sourceText)) taxonomySubgroup = "HOODIES";
      else if (/кардиган|cardigan/.test(sourceText)) taxonomySubgroup = "CARDIGANS";
      else if (/водолазк|turtleneck/.test(sourceText)) taxonomySubgroup = "TURTLENECKS";
      else if (/свитер|джемпер|knit|sweater/.test(sourceText)) taxonomySubgroup = "SWEATERS";
      else if (/футболк|\bt-?shirt\b|\btee\b/.test(sourceText)) taxonomySubgroup = "TSHIRTS";
      else if (/(джинсов|denim).{0,40}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,40}(джинсов|denim)/.test(sourceText)) taxonomySubgroup = "DENIM_SHIRTS";
      else if (/(льнян|linen).{0,40}(рубаш|сорочк|shirt)|(рубаш|сорочк|shirt).{0,40}(льнян|linen)/.test(sourceText)) taxonomySubgroup = "LINEN_SHIRTS";
      else if (/классическ.*(рубаш|сорочк)|formal shirt|dress shirt/.test(sourceText)) taxonomySubgroup = "FORMAL_SHIRTS";
      else if (/casual.*shirt|повседнев.*рубаш/.test(sourceText)) taxonomySubgroup = "CASUAL_SHIRTS";
      else if (/рубаш|сорочк|блуз|лонгслив|shirt|blouse|longsleeve|long sleeve/.test(sourceText)) taxonomySubgroup = "SHIRTS";
      else if (/футбол|майк|t-?shirt|tee/.test(sourceText)) taxonomySubgroup = "TSHIRTS";
      else if (/поло|polo/.test(sourceText)) taxonomySubgroup = "POLO";
      else taxonomySubgroup = "TOPS";
    }
  } else if (category === "ACCESSORIES") {
    if (/(сумк|клатч|тоут|шоппер|рюкзак|портфель|портмоне|кардхолдер|кошелек|wallet|bag|backpack|clutch|tote|shopper|briefcase)/.test(sourceText)) {
      taxonomyGroup = "BAGS";
      const bagSourceText = `${sourceText} ${noisyText}`;
      taxonomySubgroup = inferCatalogBagSubgroupFromText(bagSourceText);
    } else {
      taxonomyGroup = "ACCESSORIES";

      if (/(шапк|кепк|бейсболк|панам|балаклав|картуз|косынк|cap|beanie|hat)/.test(sourceText)) {
        taxonomySubgroup = "HEADWEAR";
      } else if (/(палантин|шарф|платок|scarf|stole|shawl)/.test(sourceText)) {
        taxonomySubgroup = "SCARVES";
      } else if (/(варежк|перчат|glove|mittens?)/.test(sourceText)) {
        taxonomySubgroup = "GLOVES";
      } else if (/(ремень|пояс|belt)/.test(sourceText)) {
        taxonomySubgroup = "BELTS";
      } else if (/(носк|гольфы|socks?)/.test(sourceText)) {
        taxonomySubgroup = "SOCKS";
      } else {
        taxonomySubgroup = "ACCESSORIES";
      }
    }
  }

  const canPatchCategory = ["SHOES", "TOPS", "BOTTOMS", "JACKETS", "DRESS", "ACCESSORIES"].includes(category);
  const categoryPatch =
    canPatchCategory && category && category !== originalCategory
      ? { category }
      : {};

  return {
    ...categoryPatch,
    taxonomyGroup,
    taxonomySubgroup,
    taxonomySource: "rules_v4_source_category_first",
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
  const allowed = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt", "finnflare", "snowqueen"]);

  if (!allowed.has(m)) {
    return { ok: false, status: 400, error: "Unknown merchant" };
  }

  if (isCatalogMerchantDisabled(m)) {
    return {
      ok: false,
      status: 410,
      error: `Merchant ${m} feed is disabled`,
    };
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
    const importDiag = createCatalogImportDiagnostics();

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
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      const hasUsableImage = await isUsableCatalogImageUrl(imageUrl);
      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
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
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }


      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        importDiag.skip("duplicate", r);
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
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/sportcourt error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});




function catalogStableIdentityText(row, title, brand = "") {
  return [
    title,
    brand,
    row?.categoryId,
    row?.market_category,
    row?.typePrefix,
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasAnyCatalogKeyword(text, keywords) {
  const s = String(text || "").toLowerCase();
  return keywords.some((k) => s.includes(k));
}

function isTheCulttOrRendezvousRelevantAfterAllowList(row, title, brand = "") {
  const stable = catalogStableIdentityText(row, title, brand);

  if (!stable) return false;

  const hardReject = [
    "крем", "спрей", "уход", "стельк", "шнурк", "космет", "чист",
    "салфет", "пропитк", "ложк", "щетк", "дезодорант", "средств",
  ];

  // Important: do not reject luxury bags named "Baby" or brand-size "Baby".
  // Use hard reject only on stable product identity fields, not long param.
  return !hasAnyCatalogKeyword(stable, hardReject);
}

function isRemingtonRelevantAfterAllowList(row, title, brand = "") {
  const stable = catalogStableIdentityText(row, title, brand);

  if (!stable) return false;

  const hardReject = [
    "инвентарь", "мяч", "шлем", "клюш", "ракет", "велосип", "самокат",
    "ролик", "коньк", "лыж", "сноуборд", "тренаж", "гантел", "штанг",
    "турник", "палат", "спальник", "бутыл", "фляг", "коврик",
    "защит", "маск", "очки для плав"
  ];

  return !hasAnyCatalogKeyword(stable, hardReject);
}


function isSportmasterCatalogItemRelevantAfterAllowList(row, title) {
  const primary = [
    title,
    row?.categoryId,
    row?.typePrefix,
  ].filter(Boolean).join(" ").toLowerCase();

  if (!primary) return false;

  const isOuterwear =
    /(курт|пуховик|пальто|ветровк|жилет)/i.test(primary) ||
    String(row?.categoryId || "").trim().toLowerCase() === "куртки";

  const alwaysRejectRe =
    /(для\s+мальчик|для\s+девоч|детск|подростк|baby|kids|junior|плаватель|плавки|купаль|бикини|пляж|swim|beach|aqua|инвентарь|мяч|шлем|клюш|ракет|велосип|самокат|ролик|коньк|тренаж|гантел|штанг|турник|палат|спальник|бутыл|фляг|фляж|коврик|защит|маск|очки|час|трубк|пробк|напильник|направляющ|перчатки хоккейные)/i;

  if (alwaysRejectRe.test(primary)) return false;

  // Ski/snowboard words should not reject jackets and other outerwear:
  // "Куртка для беговых лыж", "Куртка сноубордическая" are valid try-on items.
  // But ski/snowboard boots and equipment are still not useful for TopTry.
  if (!isOuterwear && /(лыж|сноуборд)/i.test(primary)) return false;

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
    const importDiag = createCatalogImportDiagnostics();

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
      const stableCategory = catalogStableIdentityText(r, title, brand);
      const isBlocked = blockKeywords.some(k => stableCategory.includes(k));

      if (!isAllowed) {
        importDiag.skip("notAllowed", r);
        skipped++;
        continue;
      }

      if (isBlocked) {
        importDiag.skip("blocked", r);
        skipped++;
        continue;
      }

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      const hasUsableImage =
        String(imageUrl).includes("cdn.sportmaster.ru/")
          ? true
          : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
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
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        importDiag.skip("duplicate", r);
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
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
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
      "taxonomySubgroup": "OUTERWEAR|COATS|PUFFER_JACKETS|BOMBERS|PARKAS|TRENCHES|LEATHER_JACKETS|DENIM_JACKETS|VESTS|BLAZERS|KNITWEAR|SWEATERS|CARDIGANS|TURTLENECKS|HOODIES|TSHIRTS|SHIRTS|FORMAL_SHIRTS|CASUAL_SHIRTS|OVERSHIRTS|LINEN_SHIRTS|DENIM_SHIRTS|POLO|TROUSERS|CARGO_PANTS|CHINOS|FORMAL_TROUSERS|JOGGERS|SHORTS|LEGGINGS|DENIM|SKIRTS|DRESSES|SNEAKERS|BOOTS|TALL_BOOTS|LOAFERS|SANDALS|BALLET|SHOES_CLASSIC|BAGS|BAGS_SHOULDER|BAGS_CROSSBODY|BAGS_TOTE|BAGS_SHOPPER|BAGS_BACKPACK|BAGS_CLUTCH|BAGS_BELT|BAGS_MINI|BAGS_TRAVEL|BAGS_WALLET_ACCESSORY|BAGS_OTHER|HEADWEAR|GLOVES|SCARVES|BELTS|SOCKS|ACCESSORIES|null",
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
- Сумки: taxonomyGroup=BAGS. Используй taxonomySubgroup:
  BAGS_SHOULDER — сумка через плечо / shoulder / hobo / baguette / сумка-полумесяц / плечевой или регулируемый ремень.
  BAGS_CROSSBODY — кросс-боди / crossbody / model names with Cross, Crossb, EW Cross, NS Cross.
  BAGS_TOTE — тоут / tote.
  BAGS_SHOPPER — шоппер / shopper / вместительная сумка с длинными или удлиненными ручками.
  BAGS_BACKPACK — рюкзак / backpack.
  BAGS_CLUTCH — клатч / вечерняя сумка / clutch.
  BAGS_BELT — поясная сумка / belt bag / waist bag / бананка.
  BAGS_MINI — мини-сумка / mini bag / компактная / небольшого размера / кисет.
  BAGS_TRAVEL — дорожная сумка / travel / weekender / duffel / duffle / саквояж / чемодан / сумка для ноутбука / портфель.
  BAGS_WALLET_ACCESSORY — кошелёк / портмоне / кардхолдер / косметичка / органайзер / обложка.
  BAGS_OTHER — сумка есть, но тип неясен.
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
- Карго / cargo pants → taxonomySubgroup=CARGO_PANTS.
- Чиносы / chinos → taxonomySubgroup=CHINOS.
- Классические брюки / костюмные брюки / formal trousers → taxonomySubgroup=FORMAL_TROUSERS.
- Джоггеры / joggers → taxonomySubgroup=JOGGERS.
- Шорты / shorts → taxonomySubgroup=SHORTS.
- Легинсы / leggings → taxonomySubgroup=LEGGINGS.
- Пальто / coat → taxonomySubgroup=COATS.
- Пуховик / puffer / down jacket → taxonomySubgroup=PUFFER_JACKETS.
- Бомбер / bomber → taxonomySubgroup=BOMBERS.
- Парка / parka → taxonomySubgroup=PARKAS.
- Тренч / плащ / trench → taxonomySubgroup=TRENCHES.
- Кожаная куртка / leather jacket → taxonomySubgroup=LEATHER_JACKETS.
- Джинсовая куртка / denim jacket → taxonomySubgroup=DENIM_JACKETS.
- Жилет / vest / gilet → taxonomySubgroup=VESTS.
- Кардиган → taxonomySubgroup=CARDIGANS.
- Водолазка → taxonomySubgroup=TURTLENECKS.
- Куртка-рубашка / overshirt → taxonomySubgroup=OVERSHIRTS.
- Льняная рубашка → taxonomySubgroup=LINEN_SHIRTS.
- Джинсовая рубашка → taxonomySubgroup=DENIM_SHIRTS.
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
  "BAGS_SHOULDER",
  "BAGS_CROSSBODY",
  "BAGS_TOTE",
  "BAGS_SHOPPER",
  "BAGS_BACKPACK",
  "BAGS_CLUTCH",
  "BAGS_BELT",
  "BAGS_MINI",
  "BAGS_TRAVEL",
  "BAGS_WALLET_ACCESSORY",
  "BAGS_OTHER",
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
  } else if (/платье[-\s]+футболк|платья[-\s]+футболк|dress[-\s]+t-?shirt/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "DRESSES";
    item.isTryOnRelevant = true;
  } else if (/(куртк|jacket).{0,20}(рубашк|сорочк|shirt)|(рубашк|сорочк|shirt).{0,20}(куртк|jacket)/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "OUTERWEAR";
    item.isTryOnRelevant = true;
  } else if (/футболк|t-?shirt|\btee\b/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "TSHIRTS";
    item.isTryOnRelevant = true;
  } else if (/рубашк|сорочк|button[- ]?down|\bshirt\b/i.test(title)) {
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


  if (/карго|cargo/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "CARGO_PANTS";
    item.isTryOnRelevant = true;
  } else if (/чинос|chino/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "CHINOS";
    item.isTryOnRelevant = true;
  } else if (/классическ.*брюк|костюмн.*брюк|formal trouser|suit pants|dress pants|slacks/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "FORMAL_TROUSERS";
    item.isTryOnRelevant = true;
  } else if (/джоггер|jogger/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "JOGGERS";
    item.isTryOnRelevant = true;
  } else if (/шорт|shorts/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "SHORTS";
    item.isTryOnRelevant = true;
  } else if (/леггин|лосин|legging/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "LEGGINGS";
    item.isTryOnRelevant = true;
  }

  if (/пальто|coat/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "COATS";
    item.isTryOnRelevant = true;
  } else if (/пухов|дутик|puffer|down jacket/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "PUFFER_JACKETS";
    item.isTryOnRelevant = true;
  } else if (/бомбер|bomber/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "BOMBERS";
    item.isTryOnRelevant = true;
  } else if (/парка|parka/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "PARKAS";
    item.isTryOnRelevant = true;
  } else if (/тренч|плащ|trench/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "TRENCHES";
    item.isTryOnRelevant = true;
  } else if (/кожан|leather/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "LEATHER_JACKETS";
    item.isTryOnRelevant = true;
  } else if (/джинсов.*куртк|denim jacket/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "DENIM_JACKETS";
    item.isTryOnRelevant = true;
  } else if (/жилет|vest|gilet/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "VESTS";
    item.isTryOnRelevant = true;
  }

  if (/(куртк|jacket).{0,20}(рубашк|сорочк|shirt)|(рубашк|сорочк|shirt).{0,20}(куртк|jacket)|overshirt/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "OVERSHIRTS";
    item.isTryOnRelevant = true;
  } else if (/(льнян|linen).{0,40}(рубашк|сорочк|shirt)|(рубашк|сорочк|shirt).{0,40}(льнян|linen)/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "LINEN_SHIRTS";
    item.isTryOnRelevant = true;
  } else if (/(джинсов|denim).{0,40}(рубашк|сорочк|shirt)|(рубашк|сорочк|shirt).{0,40}(джинсов|denim)/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "DENIM_SHIRTS";
    item.isTryOnRelevant = true;
  } else if (/классическ.*(рубашк|сорочк)|formal shirt|dress shirt/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "FORMAL_SHIRTS";
    item.isTryOnRelevant = true;
  } else if (/кардиган|cardigan/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "CARDIGANS";
    item.isTryOnRelevant = true;
  } else if (/водолазк|turtleneck/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "TURTLENECKS";
    item.isTryOnRelevant = true;
  } else if (/свитер|джемпер|sweater/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "SWEATERS";
    item.isTryOnRelevant = true;
  }


  // Priority correction: "куртка-рубашка" / overshirt is a meaningful garment type.
  // It should not be hidden inside DENIM_JACKETS or generic OUTERWEAR.
  if (/(куртк|jacket).{0,24}(рубашк|сорочк|shirt)|(рубашк|сорочк|shirt).{0,24}(куртк|jacket)|overshirt/i.test(title)) {
    item.taxonomyGroup = "CLOTHING";
    item.taxonomySubgroup = "OVERSHIRTS";
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

  if (/сумк|\bbag\b|рюкзак|backpack|клатч|clutch|кошел|wallet|портмоне|кардхолдер|cardholder|шоппер|shopper|тоут|tote/i.test(title)) {
    item.taxonomyGroup = "BAGS";

    const bagSourceText = [
      title,
      sourceProduct?.title,
      sourceProduct?.description,
      sourceProduct?.category,
      sourceProduct?.rawPayload?.categoryId,
      sourceProduct?.rawPayload?.typePrefix,
      sourceProduct?.rawPayload?.model,
      sourceProduct?.rawPayload?.param,
      sourceProduct?.rawPayload?.description,
    ].filter(Boolean).join(" ");

    item.taxonomySubgroup = inferCatalogBagSubgroupFromText(bagSourceText);

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



app.post("/api/admin/catalog/apply-ai-colors", async (req, res) => {
  try {
    const merchant = String(req.query.merchant || "").trim().toLowerCase();
    const dryRun = String(req.query.dryRun || "1") !== "0";
    const force = String(req.query.force || "0") === "1";
    const limit = Math.max(1, Math.min(200000, Number(req.query.limit || 80000)));
    const minConfidenceRaw = Number(req.query.minConfidence ?? 0);
    const minConfidence = Number.isFinite(minConfidenceRaw) ? minConfidenceRaw : 0;

    const reviewWhere = {
      ...(merchant ? { merchant } : {}),
      colorFamilySuggested: { not: null },
      ...(minConfidence > 0 ? { confidence: { gte: minConfidence } } : {}),
    };

    const reviews = await prisma.catalogProductAIReview.findMany({
      where: reviewWhere,
      select: {
        productId: true,
        merchant: true,
        colorFamilySuggested: true,
        confidence: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const latestByProduct = new Map();

    for (const r of reviews) {
      if (!r.productId || latestByProduct.has(r.productId)) continue;

      const normalized = normalizeCatalogColorFamily(r.colorFamilySuggested);
      if (!normalized) continue;

      latestByProduct.set(r.productId, {
        productId: r.productId,
        merchant: r.merchant,
        colorFamily: normalized,
        rawColorFamily: r.colorFamilySuggested,
        confidence: r.confidence,
        createdAt: r.createdAt,
      });
    }

    const productIds = Array.from(latestByProduct.keys());

    if (!productIds.length) {
      return res.json({
        ok: true,
        dryRun,
        force,
        merchant: merchant || null,
        scannedReviews: reviews.length,
        candidates: 0,
        updatesPlanned: 0,
        updated: 0,
        byColor: {},
        samples: [],
      });
    }

    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const products = [];
    for (const idsChunk of chunkArray(productIds, 5000)) {
      const chunkProducts = await prisma.catalogProduct.findMany({
        where: {
          id: { in: idsChunk },
          isActive: true,
          ...(merchant ? { merchant } : {}),
        },
        select: {
          id: true,
          merchant: true,
          title: true,
          colorFamily: true,
        },
      });
      products.push(...chunkProducts);
    }

    const updates = [];

    for (const p of products) {
      const candidate = latestByProduct.get(p.id);
      if (!candidate?.colorFamily) continue;

      const current = normalizeCatalogColorFamily(p.colorFamily);
      if (!force && current) continue;
      if (current === candidate.colorFamily) continue;

      updates.push({
        id: p.id,
        merchant: p.merchant,
        title: p.title,
        currentColorFamily: p.colorFamily || null,
        colorFamily: candidate.colorFamily,
        rawColorFamily: candidate.rawColorFamily,
        confidence: candidate.confidence,
      });
    }

    const byColor = {};
    for (const u of updates) {
      byColor[u.colorFamily] = (byColor[u.colorFamily] || 0) + 1;
    }

    let updated = 0;

    if (!dryRun && updates.length) {
      const idsByColor = {};
      for (const u of updates) {
        if (!idsByColor[u.colorFamily]) idsByColor[u.colorFamily] = [];
        idsByColor[u.colorFamily].push(u.id);
      }

      for (const [color, ids] of Object.entries(idsByColor)) {
        for (const idsChunk of chunkArray(ids, 5000)) {
          const result = await prisma.catalogProduct.updateMany({
            where: { id: { in: idsChunk } },
            data: { colorFamily: color },
          });
          updated += result.count || 0;
        }
      }
    }

    return res.json({
      ok: true,
      dryRun,
      force,
      merchant: merchant || null,
      minConfidence,
      scannedReviews: reviews.length,
      candidates: latestByProduct.size,
      activeProductsMatched: products.length,
      updatesPlanned: updates.length,
      updated,
      byColor,
      samples: updates.slice(0, 20),
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/apply-ai-colors error", e);
    return res.status(500).json({ error: e?.message || String(e) });
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

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt", "finnflare"]);
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

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt", "finnflare"]);
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
    titleRe: /(?<!платье[-\s])(?<!платья[-\s])(футболк|майк|топ бра|спортивный бра|tank top|t-?shirt|tee\b)/i,
    rejectTitleRe: /(плать|сарафан|комбинезон|dress|jumpsuit|рубашк|блузк|куртк|пуховик|ветровк|пальто|жилет|худи|толстовк|свитшот|джемпер|свитер|кардиган|водолазк)/i,
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
    titleRe: /(плать|сарафан|комбинезон|jumpsuit|dress)/i,
  },
  {
    code: "TITLE_DENIM",
    toGroup: "CLOTHING",
    toSubgroup: "DENIM",
    titleRe: /(джинс|denim|jeans)/i,
    rejectTitleRe: /(рубашк|сорочк|shirt|blouse)/i,
  },
  {
    code: "TITLE_SHIRTS",
    toGroup: "CLOTHING",
    toSubgroup: "SHIRTS",
    titleRe: /(?<!платье[-\s])(?<!платья[-\s])(рубашк|сорочк|блузк|blouse|button[- ]?down|\bshirt\b)/i,
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

    const allowedMerchants = new Set(["sportcourt", "sportmaster", "remington", "rendezvous", "thecultt", "finnflare"]);
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
    const importDiag = createCatalogImportDiagnostics();

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

      if (!isRemingtonRelevantAfterAllowList(r, title, brand)) {
        importDiag.skip("blocked", r);
        skipped++;
        continue;
      }

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      const hasUsableImage = await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
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
        importDiag.skip("duplicate", r);
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
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
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
    const importDiag = createCatalogImportDiagnostics();

    const feedGenderCoverage = detectCatalogFeedGenderCoverage(rows);
    const preDeactivated = await deactivateCatalogProductsForFeedCoverage("rendezvous", feedGenderCoverage);

    console.log("[toptry] rendezvous import gender coverage", {
      coverage: feedGenderCoverage,
      deactivation: preDeactivated,
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
      const isBlocked = !isTheCulttOrRendezvousRelevantAfterAllowList(r, title, brand);

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      if (!isAllowed) {
        importDiag.skip("notAllowed", r);
        skipped++;
        continue;
      }

      if (isBlocked) {
        importDiag.skip("blocked", r);
        skipped++;
        continue;
      }

      const hasUsableImage =
        String(imageUrl).includes("www.rendez-vous.ru/")
          ? true
          : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
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

      if (!isTheCulttOrRendezvousRelevantAfterAllowList(r, title, brand)) {
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        importDiag.skip("duplicate", r);
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
      preDeactivated: preDeactivated.count || 0,
      preDeactivateMode: preDeactivated.mode || null,
      feedGenderCoverage,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/rendezvous error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});




function isFinnFlareCatalogItemRelevantAfterAllowList(row, title, brand = "") {
  const stable = catalogStableIdentityText(row, title, brand);

  if (!stable) return false;

  const allowRe =
    /(футболк|майк|лонгслив|рубаш|блуз|поло|топ\b|худи|толстовк|свитшот|джемпер|свитер|кардиган|водолазк|плать|сарафан|юбк|брюк|джинс|шорт|куртк|пальто|пуховик|ветровк|плащ|жилет|костюм|комбинезон|блейзер|жакет|пиджак|сумк|рюкзак|t-?shirt|tee\b|shirt|blouse|polo|hoodie|sweatshirt|sweater|cardigan|dress|skirt|pants|trousers|jeans|shorts|jacket|coat|vest|blazer|bag|backpack)/i;

  if (!allowRe.test(stable)) return false;

  const hardRejectRe =
    /(нижн[её]е\s+бель[её]|термобель[её]|бель[её]|трус[ыов]?|бюстгальтер|лифчик|бра\b|носк[иов]?|гольф[ыов]?|колготк|купаль|плавк|бикини|пляж|swim|beach|underwear|briefs?|boxers?|bra\b|socks?|tights?|украшен|бижут|серьг|браслет|колье|очки|ремень|перчат|шарф|платок|шапк|панам|кепк|бейсболк)/i;

  return !hardRejectRe.test(stable);
}

function isFinnFlareCatalogImageUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return [
      "finn-flare.ru",
      "www.finn-flare.ru",
      "static.finn-flare.ru",
      "cdn.finn-flare.ru",
      "img.finn-flare.ru",
      "media.finn-flare.ru",
      "finnflare.com",
      "www.finnflare.com",
      "cdn.finnflare.com",
      "finn-flare.com",
      "www.finn-flare.com",
    ].includes(host) || host.includes("finn-flare") || host.includes("finnflare");
  } catch {
    return false;
  }
}

function mergeCatalogSizeArrays(a = {}, b = {}) {
  return {
    sizesTop: sortCatalogDisplaySizes([...(a.sizesTop || []), ...(b.sizesTop || [])]),
    sizesBottom: sortCatalogDisplaySizes([...(a.sizesBottom || []), ...(b.sizesBottom || [])]),
    sizesShoes: sortCatalogDisplaySizes([...(a.sizesShoes || []), ...(b.sizesShoes || [])]),
  };
}


app.post("/api/admin/catalog/import/snowqueen", async (_req, res) => {
  return res.status(410).json({
    error: "snowqueen feed is disabled",
    reason: "Remote images are protected by Variti and are not reliable for server-side catalog processing",
  });

  try {
    const FEED_URL = process.env.ADMITAD_SNOWQUEEN_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_SNOWQUEEN_FEED_URL is not set" });
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
    const importDiag = createCatalogImportDiagnostics();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "snowqueen" },
      data: { isActive: false },
    });

    for (const r of rows) {
      const title = pickFirst(r, ["name", "title", "product_name", "model"]);
      const brand = pickFirst(r, ["brand", "vendor", "manufacturer"]) || "Снежная Королева";
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

      if (!title || !imageUrl || !affiliateUrl || price === null || price <= 0) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      if (!isTryOnRelevantCatalogItem(rawCategory)) {
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        importDiag.skip("duplicate", r);
        skipped++;
        continue;
      }
      seen.add(externalId);

      const genderSignal = getCatalogRowGenderSignal(r, title, brand);
      const gender = normalizeCatalogGender(genderSignal);
      const category = normalizeCatalogCategory(rawCategory);
      const catalogSizes = buildCatalogSizes(r, category, rawCategory);
      const taxonomy = inferCatalogTaxonomy({
        title,
        brand,
        category,
        gender,
        rawPayload: r,
      });

      const data = {
        id: `cat-snowqueen-${externalId}`,
        merchant: "snowqueen",
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
        rawPayload: { ...r, source: "admitad_snowqueen" },
        ...taxonomy,
      };

      const existing = await prisma.catalogProduct.findUnique({
        where: {
          merchant_externalId: {
            merchant: "snowqueen",
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

    const deactivatedBlocked = await deactivateBlockedCatalogProducts("snowqueen");

    return res.json({
      ok: true,
      merchant: "snowqueen",
      total: rows.length,
      created,
      updated,
      skipped,
      restoredSafe: 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated - (deactivatedBlocked.count || 0),
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/snowqueen error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/admin/catalog/import/finnflare", async (_req, res) => {
  try {
    const FEED_URL = process.env.ADMITAD_FINNFLARE_FEED_URL || "";
    if (!FEED_URL) {
      return res.status(500).json({ error: "ADMITAD_FINNFLARE_FEED_URL is not set" });
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
    let aggregatedRows = 0;
    const seenRows = new Set();
    const grouped = new Map();
    const importDiag = createCatalogImportDiagnostics();

    await prisma.catalogProduct.updateMany({
      where: { merchant: "finnflare" },
      data: { isActive: false },
    });

    for (const r of rows) {
      const title = pickFirst(r, ["name", "title", "product_name", "model"]);
      const brand = pickFirst(r, ["brand", "vendor", "manufacturer"]) || "FINN FLARE";
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

      if (!title || !imageUrl || !affiliateUrl || price === null || price <= 0) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      if (!isFinnFlareCatalogItemRelevantAfterAllowList(r, title, brand)) {
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }

      const hasUsableImage = isFinnFlareCatalogImageUrl(imageUrl)
        ? true
        : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
        skipped++;
        continue;
      }

      const rowUniqueId = pickFirst(r, ["id", "barcode", "vendorCode", "url"]) || JSON.stringify(r);
      if (seenRows.has(rowUniqueId)) {
        importDiag.skip("duplicateSourceRow", r);
        skipped++;
        continue;
      }
      seenRows.add(rowUniqueId);

      const haystack = [
        title,
        brand,
        pickFirst(r, ["category", "category_name", "google_product_category"]),
        pickFirst(r, ["categoryId"]),
        pickFirst(r, ["market_category"]),
        pickFirst(r, ["gender", "sex"]),
        pickFirst(r, ["param"]),
      ].join(" ");

      const externalId = buildCatalogExternalId(r);
      const gender = normalizeCatalogGender(haystack);
      const category = normalizeCatalogCategory([rawCategory, title].join(" "));
      const catalogSizes = buildCatalogSizes(r, category, [rawCategory, haystack].join(" "));

      const existingGroup = grouped.get(externalId);

      if (existingGroup) {
        existingGroup.catalogSizes = mergeCatalogSizeArrays(existingGroup.catalogSizes, catalogSizes);
        existingGroup.rawRowsCount += 1;
        existingGroup.rawSizes = uniqueStrings([
          ...(existingGroup.rawSizes || []),
          ...catalogSizes.sizesTop,
          ...catalogSizes.sizesBottom,
          ...catalogSizes.sizesShoes,
        ]);
        aggregatedRows++;
        continue;
      }

      grouped.set(externalId, {
        externalId,
        catalogSizes,
        rawRowsCount: 1,
        rawSizes: uniqueStrings([
          ...catalogSizes.sizesTop,
          ...catalogSizes.sizesBottom,
          ...catalogSizes.sizesShoes,
        ]),
        data: {
          id: `cat-finnflare-${externalId}`,
          merchant: "finnflare",
          externalId,
          title,
          brand: brand || "FINN FLARE",
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
        },
      });
    }

    for (const group of grouped.values()) {
      const data = {
        ...group.data,
        ...group.catalogSizes,
        rawPayload: {
          ...(group.data.rawPayload || {}),
          _toptryAggregatedRows: group.rawRowsCount,
          _toptryAggregatedSizes: group.rawSizes,
        },
      };

      const existing = await prisma.catalogProduct.findUnique({
        where: {
          merchant_externalId: {
            merchant: "finnflare",
            externalId: group.externalId,
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

    const restoredSafe = { count: 0 };
    const deactivatedBlocked = await deactivateBlockedCatalogProducts("finnflare");

    return res.json({
      ok: true,
      merchant: "finnflare",
      total: rows.length,
      created,
      updated,
      skipped,
      aggregatedRows,
      importedGroups: grouped.size,
      restoredSafe: restoredSafe.count || 0,
      deactivatedBlocked: deactivatedBlocked.count || 0,
      active: created + updated + (restoredSafe.count || 0) - (deactivatedBlocked.count || 0),
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/import/finnflare error", e);
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
      "static.rendez-vous.ru",
      "goods.thecultt.com",
      "thecultt.com",
      "www.thecultt.com",
      "remington.fashion",
      "www.remington.fashion",
      "snowqueen.ru",
      "www.snowqueen.ru",
      "static.snowqueen.ru",
      "cdn.snowqueen.ru",
      "img.snowqueen.ru",
      "media.snowqueen.ru",
      "finn-flare.ru",
      "www.finn-flare.ru",
      "static.finn-flare.ru",
      "cdn.finn-flare.ru",
      "img.finn-flare.ru",
      "media.finn-flare.ru",
      "finnflare.com",
      "www.finnflare.com",
      "cdn.finnflare.com",
      "finn-flare.com",
      "www.finn-flare.com",
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
          "snowqueen.ru",
          "www.snowqueen.ru",
          "static.snowqueen.ru",
          "cdn.snowqueen.ru",
          "img.snowqueen.ru",
          "media.snowqueen.ru",
      "snowqueen.ru",
      "www.snowqueen.ru",
      "static.snowqueen.ru",
      "cdn.snowqueen.ru",
      "img.snowqueen.ru",
      "media.snowqueen.ru",
          "finn-flare.ru",
          "www.finn-flare.ru",
          "static.finn-flare.ru",
          "cdn.finn-flare.ru",
          "img.finn-flare.ru",
          "media.finn-flare.ru",
          "finnflare.com",
          "www.finnflare.com",
          "cdn.finnflare.com",
          "finn-flare.com",
          "www.finn-flare.com",
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
    const importDiag = createCatalogImportDiagnostics();

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
      const isBlocked = !isTheCulttOrRendezvousRelevantAfterAllowList(r, title, brand);

      if (!title || !imageUrl || !affiliateUrl || price === null) {
        importDiag.skip("missingRequired", r);
        skipped++;
        continue;
      }

      if (!isAllowed) {
        importDiag.skip("notAllowed", r);
        skipped++;
        continue;
      }

      if (isBlocked) {
        importDiag.skip("blocked", r);
        skipped++;
        continue;
      }

      const hasUsableImage =
        String(imageUrl).includes("www.rendez-vous.ru/")
          ? true
          : await isUsableCatalogImageUrl(imageUrl);

      if (!hasUsableImage) {
        importDiag.skip("imageUnavailable", r);
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

      if (!isTheCulttOrRendezvousRelevantAfterAllowList(r, title, brand)) {
        importDiag.skip("notTryOnRelevant", r);
        skipped++;
        continue;
      }

      const externalId = buildCatalogExternalId(r);
      if (seen.has(externalId)) {
        importDiag.skip("duplicate", r);
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
      skippedByReason: importDiag.byReason,
      skippedSamples: importDiag.samples,
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
      "static.rendez-vous.ru",
      "goods.thecultt.com",
      "thecultt.com",
      "www.thecultt.com",
      "remington.fashion",
      "www.remington.fashion",
      "snowqueen.ru",
      "www.snowqueen.ru",
      "static.snowqueen.ru",
      "cdn.snowqueen.ru",
      "img.snowqueen.ru",
      "media.snowqueen.ru",
      "finn-flare.ru",
      "www.finn-flare.ru",
      "static.finn-flare.ru",
      "cdn.finn-flare.ru",
      "img.finn-flare.ru",
      "media.finn-flare.ru",
      "finnflare.com",
      "www.finnflare.com",
      "cdn.finnflare.com",
      "finn-flare.com",
      "www.finn-flare.com",
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
          "snowqueen.ru",
          "www.snowqueen.ru",
          "static.snowqueen.ru",
          "cdn.snowqueen.ru",
          "img.snowqueen.ru",
          "media.snowqueen.ru",
      "snowqueen.ru",
      "www.snowqueen.ru",
      "static.snowqueen.ru",
      "cdn.snowqueen.ru",
      "img.snowqueen.ru",
      "media.snowqueen.ru",
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
    const bagType =
      typeof req.query.bagType === "string" && req.query.bagType.trim()
        ? req.query.bagType.trim().toUpperCase()
        : "";
    const accessoryType =
      typeof req.query.accessoryType === "string" && req.query.accessoryType.trim()
        ? req.query.accessoryType.trim().toUpperCase()
        : "";

    const discountOnly =
      String(req.query.discountOnly || "").trim() === "1";
    const colorFamily =
      typeof req.query.colorFamily === "string" && req.query.colorFamily.trim()
        ? req.query.colorFamily.trim()
        : "";

    const where = buildCatalogDbWhere({
      merchant,
      gender,
      category,
      displayCategory,
      q,
      discountOnly,
      brand: "",
      colorFamily,
      priceMin: "",
      priceMax: "",
      clothingType,
      shoeType,
      bagType,
      accessoryType,
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
              : p.merchant === "finnflare"
                ? "FINN FLARE"
                : p.merchant === "snowqueen"
                  ? "Снежная Королева"
                  : p.merchant === "sportcourt"
                    ? "Sportcourt"
                    : p.merchant || "Магазин",
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





function shuffleCatalogCollectionRows(rows) {
  const out = Array.isArray(rows) ? rows.slice() : [];

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

function normalizeCatalogCollectionText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/[,/].*$/, "")
    .replace(/\b(женск(ая|ие|ий)?|мужск(ая|ие|ий)?|детск(ая|ие|ий)?)\b/g, "")
    .replace(/\b(черный|чёрный|белый|синий|голубой|серый|серебристый|красный|бордовый|зеленый|зелёный|розовый|бежевый|коричневый|желтый|жёлтый|оранжевый|фиолетовый|мультицвет|black|white|blue|navy|grey|gray|red|green|pink|beige|brown|yellow|orange|purple|multi)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogCollectionImageKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+/g, "/");
}

function getCatalogCollectionDedupeKey(product) {
  const imageKey = normalizeCatalogCollectionImageKey(product?.imageUrl);
  if (imageKey) return `img:${imageKey}`;

  const merchant = normalizeCatalogCollectionText(product?.merchant || "unknown");
  const brand = normalizeCatalogCollectionText(product?.brand || "");
  const title = normalizeCatalogCollectionText(product?.title || "").slice(0, 96);

  if (brand || title) return `txt:${merchant}|${brand}|${title}`;
  return `id:${String(product?.id || Math.random()).trim()}`;
}

function pickCatalogCollectionDiverseRows({
  rows,
  limit,
  merchantMax = 2,
  groupMax = 2,
  bagMax = Infinity,
  luxuryMax = Infinity,
  allowDupes = false,
  titleKeyFn = null,
}) {
  const picked = [];
  const merchantCounts = new Map();
  const groupCounts = new Map();
  const seenDedupe = new Set();
  const seenTitle = new Set();
  let bagCount = 0;
  let luxuryCount = 0;

  for (const p of Array.isArray(rows) ? rows : []) {
    const merchant = String(p?.merchant || "unknown");
    const group = String(p?.taxonomyGroup || "OTHER");
    const dedupeKey = getCatalogCollectionDedupeKey(p);
    const titleKey = typeof titleKeyFn === "function"
      ? titleKeyFn(p)
      : normalizeCatalogCollectionText(p?.title || "").slice(0, 96);
    const isBag = group === "BAGS";
    const isLuxury = Boolean(p?._isLuxury);

    if ((merchantCounts.get(merchant) || 0) >= merchantMax) continue;
    if ((groupCounts.get(group) || 0) >= groupMax) continue;
    if (isBag && bagCount >= bagMax) continue;
    if (isLuxury && luxuryCount >= luxuryMax) continue;
    if (!allowDupes && dedupeKey && seenDedupe.has(dedupeKey)) continue;
    if (!allowDupes && titleKey && seenTitle.has(titleKey)) continue;

    picked.push(p);
    merchantCounts.set(merchant, (merchantCounts.get(merchant) || 0) + 1);
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    if (dedupeKey) seenDedupe.add(dedupeKey);
    if (titleKey) seenTitle.add(titleKey);
    if (isBag) bagCount += 1;
    if (isLuxury) luxuryCount += 1;

    if (picked.length >= limit) break;
  }

  return picked;
}

function catalogCollectionGroup(row) {
  return String(row?.taxonomyGroup || row?.category || "OTHER").toUpperCase();
}

function catalogCollectionGender(row) {
  const gender = String(row?.gender || "").trim().toUpperCase();
  if (gender === "FEMALE" || gender === "MALE") return gender;
  return "UNISEX";
}

function pickCatalogCollectionMerchandisedRows({
  rows,
  limit,
  requiredClothing = 2,
  merchantMax = 3,
  groupMax = {},
  genderMax = {},
  requiredGenders = [],
  titleKeyFn = null,
}) {
  const source = Array.isArray(rows) ? rows : [];
  const picked = [];
  const seenDedupe = new Set();
  const seenTitle = new Set();
  const merchantCounts = new Map();
  const groupCounts = new Map();
  const genderCounts = new Map();

  const normalizedRequiredGenders = Array.from(
    new Set(
      (Array.isArray(requiredGenders) ? requiredGenders : [])
        .map((g) => String(g || "").trim().toUpperCase())
        .filter((g) => g === "FEMALE" || g === "MALE")
    )
  );

  const resolvedGenderMax = {
    FEMALE: Math.max(1, Math.ceil(limit * 0.6)),
    MALE: Math.max(1, Math.ceil(limit * 0.6)),
    UNISEX: Math.max(1, Math.ceil(limit * 0.35)),
    ...(genderMax || {}),
  };

  const add = (p, strict = true) => {
    if (!p || picked.length >= limit) return false;

    const group = catalogCollectionGroup(p);
    const gender = catalogCollectionGender(p);
    const merchant = String(p?.merchant || "unknown");
    const dedupeKey = getCatalogCollectionDedupeKey(p);
    const titleKey = typeof titleKeyFn === "function" ? titleKeyFn(p) : "";

    if (dedupeKey && seenDedupe.has(dedupeKey)) return false;
    if (titleKey && seenTitle.has(titleKey)) return false;

    if (strict) {
      if ((merchantCounts.get(merchant) || 0) >= merchantMax) return false;

      const maxForGroup = Number(groupMax[group] ?? limit);
      if ((groupCounts.get(group) || 0) >= maxForGroup) return false;

      const maxForGender = Number(resolvedGenderMax[gender] ?? limit);
      if ((genderCounts.get(gender) || 0) >= maxForGender) return false;
    }

    picked.push(p);
    if (dedupeKey) seenDedupe.add(dedupeKey);
    if (titleKey) seenTitle.add(titleKey);
    merchantCounts.set(merchant, (merchantCounts.get(merchant) || 0) + 1);
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    genderCounts.set(gender, (genderCounts.get(gender) || 0) + 1);

    return true;
  };

  // First force clothing into homepage blocks. TopTry must not look like bags/shoes only.
  const clothingTarget = Math.max(0, Math.min(limit, Number(requiredClothing || 0)));

  for (const requiredGender of normalizedRequiredGenders) {
    if ((groupCounts.get("CLOTHING") || 0) >= clothingTarget) break;
    if ((genderCounts.get(requiredGender) || 0) > 0) continue;

    for (const p of source) {
      if (
        catalogCollectionGroup(p) === "CLOTHING" &&
        catalogCollectionGender(p) === requiredGender &&
        add(p, true)
      ) {
        break;
      }
    }
  }

  for (const p of source) {
    if ((groupCounts.get("CLOTHING") || 0) >= clothingTarget) break;
    if (catalogCollectionGroup(p) === "CLOTHING") add(p, true);
  }

  // Then fill with strict group/merchant/gender caps.
  for (const p of source) {
    if (picked.length >= limit) break;
    add(p, true);
  }

  // Last fallback: keep dedupe but relax caps if the pool is narrow.
  for (const p of source) {
    if (picked.length >= limit) break;
    add(p, false);
  }

  return picked.slice(0, limit);
}

app.get("/api/catalog/deals", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit || 4);
    const limit = Math.max(1, Math.min(16, Number.isFinite(rawLimit) ? rawLimit : 4));

    const rawMinDiscount = Number(req.query.minDiscount || 30);
    const minDiscount = Math.max(5, Math.min(90, Number.isFinite(rawMinDiscount) ? rawMinDiscount : 30));

    const poolLimit = Math.max(160, Math.min(700, limit * 140));

    const rows = await prisma.$queryRawUnsafe(
      `
      with latest_review as (
        select distinct on (r."productId")
          r."productId",
          r."isTryOnRelevantSuggested",
          r."rejectReasons",
          r.confidence,
          r."createdAt"
        from "CatalogProductAIReview" r
        order by r."productId", r."createdAt" desc
      )
      select
        p.id,
        p.merchant,
        p."externalId",
        p.title,
        p.brand,
        p.category,
        p.gender,
        p.price,
        p."oldPrice",
        p.currency,
        p."imageUrl",
        p."productUrl",
        p."affiliateUrl",
        p."sizesTop",
        p."sizesBottom",
        p."sizesShoes",
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."styleTags",
        p."occasionTags",
        p."seasonTags",
        p."colorFamily",
        p."createdAt",
        p."updatedAt",
        round(((p."oldPrice" - p.price) / p."oldPrice" * 100)::numeric, 0)::int as "discountPercent"
      from "CatalogProduct" p
      join latest_review lr on lr."productId" = p.id
      where p."isActive" = true
        and p.price is not null
        and p.price > 0
        and p."oldPrice" is not null
        and p."oldPrice" > p.price
        and ((p."oldPrice" - p.price) / p."oldPrice" * 100) >= $1
        and p."imageUrl" is not null
        and p."imageUrl" <> ''
        and coalesce(p."taxonomyGroup", '') in ('CLOTHING', 'SHOES', 'BAGS')
        and lr."isTryOnRelevantSuggested" = true
        and coalesce(cardinality(lr."rejectReasons"), 0) = 0
      order by
        case coalesce(p."taxonomyGroup", '')
          when 'CLOTHING' then 0
          when 'SHOES' then 1
          when 'BAGS' then 2
          else 3
        end,
        "discountPercent" desc,
        p."createdAt" desc,
        p."updatedAt" desc
      limit $2
      `,
      minDiscount,
      poolLimit
    );

    const sizeCount = (p) =>
      (Array.isArray(p.sizesTop) ? p.sizesTop.length : 0) +
      (Array.isArray(p.sizesBottom) ? p.sizesBottom.length : 0) +
      (Array.isArray(p.sizesShoes) ? p.sizesShoes.length : 0);

    const titleKey = (p) =>
      String(p.title || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\b(черный|чёрный|белый|синий|серый|серебристый|красный|зеленый|зелёный|бежевый|розовый|мультицвет|black|white|blue|grey|gray|red|green|beige|pink)\b/gi, "")
        .trim()
        .slice(0, 90);

    const now = Date.now();

    const scored = rows.map((p) => {
      const price = Number(p.price || 0);
      const oldPrice = Number(p.oldPrice || 0);
      const discountPercent =
        oldPrice > price && price > 0
          ? Math.round(((oldPrice - price) / oldPrice) * 100)
          : Number(p.discountPercent || 0);

      const discountScore = Math.min(discountPercent, 60) * 2.0;

      const group = String(p.taxonomyGroup || "");
      const subgroup = String(p.taxonomySubgroup || "");

      const categoryScore =
        // Homepage merchandising: clothing must be visible on TopTry.
        // Without a strong boost, large shoe feeds drown clothing deals in the shortlist.
        group === "CLOTHING" ? 140 :
        group === "SHOES" ? 22 :
        group === "BAGS" ? 8 :
        0;

      const sizes = sizeCount(p);
      const sizeScore = sizes > 0 ? 18 : -18;

      const createdAtMs = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      const ageDays = createdAtMs ? Math.max(0, (now - createdAtMs) / 86400000) : 999;
      const freshnessScore = Math.max(0, 28 - ageDays) * 0.8;

      let priceScore = 0;
      if (group === "BAGS") {
        if (price <= 100000) priceScore += 8;
        if (price > 150000) priceScore -= 35;
      } else if (group === "SHOES") {
        if (price >= 2500 && price <= 35000) priceScore += 12;
        if (price > 60000) priceScore -= 25;
      } else if (group === "CLOTHING") {
        if (price >= 1200 && price <= 50000) priceScore += 12;
        if (price > 90000) priceScore -= 25;
      }

      const luxuryOutlierPenalty = price > 100000 ? 25 : 0;

      const tryOnCategoryBonus =
        ["TSHIRTS", "SHIRTS", "KNITWEAR", "OUTERWEAR", "DRESSES", "TROUSERS", "DENIM", "SNEAKERS", "LOAFERS", "SANDALS", "BOOTS", "SHOES_CLASSIC"].includes(subgroup)
          ? 8
          : 0;

      const score =
        discountScore +
        categoryScore +
        sizeScore +
        freshnessScore +
        priceScore +
        tryOnCategoryBonus -
        luxuryOutlierPenalty;

      return {
        ...p,
        _score: score,
        _titleKey: titleKey(p),
        _discountPercent: discountPercent,
        _isLuxury: price > 100000,
      };
    }).sort((a, b) => b._score - a._score);

    const selectionPool = shuffleCatalogCollectionRows(scored.slice(0, Math.max(limit * 30, 120)));

    const pick = (merchantMax, groupMax, bagMax, luxuryMax, allowDupes = false) =>
      pickCatalogCollectionDiverseRows({
        rows: selectionPool,
        limit,
        merchantMax,
        groupMax,
        bagMax,
        luxuryMax,
        allowDupes,
        titleKeyFn: (p) => p._titleKey || p.id,
      });

    let selected = pickCatalogCollectionMerchandisedRows({
      rows: selectionPool,
      limit,
      requiredClothing: Math.min(2, Math.max(1, Math.ceil(limit * 0.3))),
      merchantMax: Math.max(2, Math.ceil(limit * 0.45)),
      groupMax: {
        CLOTHING: Math.max(2, Math.ceil(limit * 0.5)),
        SHOES: Math.max(1, Math.ceil(limit * 0.45)),
        BAGS: Math.max(1, Math.floor(limit * 0.2)),
      },
      genderMax: {
        FEMALE: Math.max(2, Math.ceil(limit * 0.6)),
        MALE: Math.max(2, Math.ceil(limit * 0.6)),
        UNISEX: Math.max(1, Math.floor(limit * 0.25)),
      },
      requiredGenders: ["FEMALE", "MALE"],
      titleKeyFn: (p) => p._titleKey || p.id,
    });

    const products = selected.slice(0, limit).map((p) => {
      const price = Number(p.price || 0);
      const oldPrice = Number(p.oldPrice || 0);
      const discountPercent =
        oldPrice > price && price > 0
          ? Math.max(1, Math.round(((oldPrice - price) / oldPrice) * 100))
          : Number(p._discountPercent || p.discountPercent || 0);

      return {
        id: p.id,
        merchant: p.merchant,
        externalId: p.externalId,
        title: p.title,
        brand: p.brand,
        category: p.category,
        gender: p.gender,
        price,
        oldPrice,
        discountPercent,
        currency: p.currency || "RUB",
        imageUrl: p.imageUrl,
        images: p.imageUrl ? [p.imageUrl] : [],
        productUrl: p.productUrl,
        affiliateUrl: p.affiliateUrl,
        sizesTop: p.sizesTop || [],
        sizesBottom: p.sizesBottom || [],
        sizesShoes: p.sizesShoes || [],
        taxonomyGroup: p.taxonomyGroup,
        taxonomySubgroup: p.taxonomySubgroup,
        styleTags: p.styleTags || [],
        occasionTags: p.occasionTags || [],
        seasonTags: p.seasonTags || [],
        colorFamily: p.colorFamily || "",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        dealScore: Math.round(Number(p._score || 0)),
      };
    });

    res.json({
      ok: true,
      products,
      meta: {
        limit,
        minDiscount,
        pool: rows.length,
        selected: products.length,
        strategy: "deal_quality_score_merchandised_clothing_gender_balanced_pool",
      },
    });
  } catch (e) {
    console.error("[toptry] /api/catalog/deals error", e);
    res.status(500).json({ error: "Failed to load catalog deals" });
  }
});




function mapCatalogCollectionProductForApi(p, extra = {}) {
  const price = Number(p?.price || p?.currentPrice || 0);
  const oldPrice = Number(p?.oldPrice || p?.previousPrice || 0);
  const previousPrice = Number(p?.previousPrice || 0);
  const currentPrice = Number(p?.currentPrice || price || 0);
  const delta = Number(p?.delta || (previousPrice > currentPrice ? previousPrice - currentPrice : 0));
  const deltaPct = Number(p?.deltaPct || (previousPrice > 0 && currentPrice > 0 ? ((previousPrice - currentPrice) / previousPrice) * 100 : 0));

  const discountPercent =
    previousPrice > currentPrice && currentPrice > 0
      ? Math.max(1, Math.round(deltaPct))
      : oldPrice > price && price > 0
        ? Math.max(1, Math.round(((oldPrice - price) / oldPrice) * 100))
        : Number(p?.discountPercent || 0);

  return {
    id: p.id,
    merchant: p.merchant,
    externalId: p.externalId,
    title: p.title,
    brand: p.brand,
    category: p.category,
    gender: p.gender,
    price,
    oldPrice: oldPrice || previousPrice || null,
    previousPrice: previousPrice || oldPrice || null,
    currentPrice: currentPrice || price || null,
    delta,
    deltaPct: Math.round(deltaPct * 100) / 100,
    discountPercent,
    currency: p.currency || "RUB",
    imageUrl: p.imageUrl,
    images: p.imageUrl ? [p.imageUrl] : [],
    productUrl: p.productUrl,
    affiliateUrl: p.affiliateUrl,
    sizesTop: p.sizesTop || [],
    sizesBottom: p.sizesBottom || [],
    sizesShoes: p.sizesShoes || [],
    taxonomyGroup: p.taxonomyGroup,
    taxonomySubgroup: p.taxonomySubgroup,
    styleTags: p.styleTags || [],
    occasionTags: p.occasionTags || [],
    seasonTags: p.seasonTags || [],
    colorFamily: p.colorFamily || "",
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    detectedAt: p.detectedAt || null,
    ...extra,
  };
}

function normalizeCollectionLimit(value, fallback = 24, max = 60) {
  const n = Number(value || fallback);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? Math.floor(n) : fallback));
}

app.get("/api/catalog/price-drops", async (req, res) => {
  try {
    const limit = normalizeCollectionLimit(req.query.limit, 24, 60);
    const minDeltaPctRaw = Number(req.query.minDeltaPct || 10);
    const minDeltaPct = Math.max(0, Math.min(90, Number.isFinite(minDeltaPctRaw) ? minDeltaPctRaw : 10));
    const daysRaw = Number(req.query.days || 30);
    const days = Math.max(1, Math.min(180, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));
    const poolLimit = Math.max(120, Math.min(1200, limit * 80));

    const rows = await prisma.$queryRawUnsafe(
      `
      with latest_drop as (
        select distinct on (c."productId")
          c."productId",
          c."previousPrice",
          c."currentPrice",
          c.delta,
          c."deltaPct",
          c."detectedAt",
          c."pipelineRunId"
        from "CatalogProductPriceChange" c
        where c.direction = 'DROP'
          and c."deltaPct" >= $1
          and c."detectedAt" >= now() - ($2::text || ' days')::interval
        order by c."productId", c."detectedAt" desc, c."deltaPct" desc
      )
      select
        p.id,
        p.merchant,
        p."externalId",
        p.title,
        p.brand,
        p.category,
        p.gender,
        p.price,
        p."oldPrice",
        p.currency,
        p."imageUrl",
        p."productUrl",
        p."affiliateUrl",
        p."sizesTop",
        p."sizesBottom",
        p."sizesShoes",
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."styleTags",
        p."occasionTags",
        p."seasonTags",
        p."colorFamily",
        p."createdAt",
        p."updatedAt",
        ld."previousPrice",
        ld."currentPrice",
        ld.delta,
        ld."deltaPct",
        ld."detectedAt"
      from latest_drop ld
      join "CatalogProduct" p on p.id = ld."productId"
      where p."isActive" = true
        and p.price is not null
        and p.price > 0
        and p."imageUrl" is not null
        and p."imageUrl" <> ''
        and coalesce(p."taxonomyGroup", '') in ('CLOTHING', 'SHOES', 'BAGS', 'ACCESSORIES')
        and not (
          lower(coalesce(p.title, '')) ~ '(зонт|umbrella|шнурк|shoelace|стельк|insole|украшен.*для обув|аксессуар.*для обув|средств.*для обув|уход.*обув|крем.*обув|губк.*обув|щетк.*обув|щётк.*обув|пропитк|дезодорант.*обув)'
        )
      order by random()
      limit $3
      `,
      minDeltaPct,
      days,
      poolLimit
    );

    const selected = pickCatalogCollectionMerchandisedRows({
      rows: shuffleCatalogCollectionRows(rows),
      limit,
      requiredClothing: Math.min(2, Math.max(1, Math.ceil(limit * 0.25))),
      merchantMax: Math.max(2, Math.ceil(limit * 0.45)),
      groupMax: {
        CLOTHING: Math.max(2, Math.ceil(limit * 0.45)),
        SHOES: Math.max(1, Math.ceil(limit * 0.45)),
        BAGS: Math.max(1, Math.floor(limit * 0.25)),
        ACCESSORIES: Math.max(1, Math.floor(limit * 0.2)),
      },
      genderMax: {
        FEMALE: Math.max(2, Math.ceil(limit * 0.6)),
        MALE: Math.max(2, Math.ceil(limit * 0.6)),
        UNISEX: Math.max(1, Math.floor(limit * 0.25)),
      },
      requiredGenders: ["FEMALE", "MALE"],
      titleKeyFn: (p) => String(p.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 90),
    });

    const products = selected.map((p) =>
      mapCatalogCollectionProductForApi(p, { collection: "price-drops" })
    );

    return res.json({
      ok: true,
      products,
      meta: {
        limit,
        pool: rows.length,
        selected: products.length,
        minDeltaPct,
        days,
        strategy: "price_change_drop_merchandised_clothing_gender_balanced_pool",
      },
    });
  } catch (e) {
    console.error("[toptry] /api/catalog/price-drops error", e);
    return res.status(500).json({ error: e?.message || "Failed to load price drops" });
  }
});

app.get("/api/wardrobe/price-drops", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const limit = normalizeCollectionLimit(req.query.limit, 24, 60);
    const daysRaw = Number(req.query.days || 30);
    const days = Math.max(1, Math.min(180, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));

    const rows = await prisma.$queryRawUnsafe(
      `
      with wardrobe_catalog as (
        select
          w.id as "wardrobeItemId",
          w.title as "wardrobeTitle",
          w.price as "wardrobePrice",
          w.currency as "wardrobeCurrency",
          w."imageUrl" as "wardrobeImageUrl",
          w."productUrl" as "wardrobeProductUrl",
          w."affiliateUrl" as "wardrobeAffiliateUrl",
          w."storeId" as "wardrobeStoreId",
          w.brand as "wardrobeBrand",
          w."createdAt" as "wardrobeAddedAt"
        from "WardrobeItem" w
        where w."userId" = $1
          and w."sourceType" = 'catalog'
          and w.price is not null
          and w.price > 0
      ),
      latest_drop as (
        select distinct on (c."productId")
          c."productId",
          c."previousPrice" as "eventPreviousPrice",
          c."currentPrice" as "eventCurrentPrice",
          c.delta as "eventDelta",
          c."deltaPct" as "eventDeltaPct",
          c."detectedAt"
        from "CatalogProductPriceChange" c
        where c.direction = 'DROP'
          and c."detectedAt" >= now() - ($2::text || ' days')::interval
        order by c."productId", c."detectedAt" desc, c."deltaPct" desc
      ),
      matched as (
        select distinct on (w."wardrobeItemId")
          w.*,
          p.id,
          p.merchant,
          p."externalId",
          p.title,
          p.brand,
          p.category,
          p.gender,
          p.price,
          p."oldPrice",
          p.currency,
          p."imageUrl",
          p."productUrl",
          p."affiliateUrl",
          p."sizesTop",
          p."sizesBottom",
          p."sizesShoes",
          p."taxonomyGroup",
          p."taxonomySubgroup",
          p."styleTags",
          p."occasionTags",
          p."seasonTags",
          p."colorFamily",
          p."createdAt",
          p."updatedAt",
          ld."detectedAt",
          ld."eventPreviousPrice",
          ld."eventCurrentPrice",
          ld."eventDelta",
          ld."eventDeltaPct",
          (w."wardrobePrice" - p.price) as delta,
          case when w."wardrobePrice" > 0 then round((((w."wardrobePrice" - p.price) / w."wardrobePrice") * 100)::numeric, 2)::double precision else 0 end as "deltaPct"
        from wardrobe_catalog w
        join "CatalogProduct" p
          on p."isActive" = true
         and p.price is not null
         and p.price > 0
         and (
              (coalesce(w."wardrobeAffiliateUrl", '') <> '' and p."affiliateUrl" = w."wardrobeAffiliateUrl")
           or (coalesce(w."wardrobeProductUrl", '') <> '' and p."productUrl" = w."wardrobeProductUrl")
           or (coalesce(w."wardrobeImageUrl", '') <> '' and p."imageUrl" = w."wardrobeImageUrl")
           or (
                coalesce(w."wardrobeImageUrl", '') <> ''
            and lower(coalesce(p.brand, '')) = lower(coalesce(w."wardrobeBrand", ''))
            and regexp_replace(lower(coalesce(p."imageUrl", '')), '[?#].*$', '') = regexp_replace(lower(coalesce(w."wardrobeImageUrl", '')), '[?#].*$', '')
              )
         )
        join latest_drop ld on ld."productId" = p.id
        where p.price < w."wardrobePrice"
          and coalesce(p."taxonomyGroup", '') in ('CLOTHING', 'SHOES', 'BAGS', 'ACCESSORIES')
        order by w."wardrobeItemId", ld."detectedAt" desc, (w."wardrobePrice" - p.price) desc, p."updatedAt" desc
      )
      select *
      from matched
      order by "detectedAt" desc, "deltaPct" desc, delta desc
      limit $3
      `,
      userId,
      days,
      limit
    );

    const items = rows.map((p) =>
      mapCatalogCollectionProductForApi(p, {
        collection: "wardrobe-price-drops",
        wardrobeItemId: p.wardrobeItemId,
        wardrobeTitle: p.wardrobeTitle,
        wardrobePrice: Number(p.wardrobePrice || 0),
        wardrobeAddedAt: p.wardrobeAddedAt,
        previousPrice: Number(p.wardrobePrice || 0),
        currentPrice: Number(p.price || 0),
        detectedAt: p.detectedAt || null,
        priceDropDetectedAt: p.detectedAt || null,
        eventPreviousPrice: p.eventPreviousPrice !== null && p.eventPreviousPrice !== undefined ? Number(p.eventPreviousPrice) : null,
        eventCurrentPrice: p.eventCurrentPrice !== null && p.eventCurrentPrice !== undefined ? Number(p.eventCurrentPrice) : null,
        eventDelta: p.eventDelta !== null && p.eventDelta !== undefined ? Number(p.eventDelta) : null,
        eventDeltaPct: p.eventDeltaPct !== null && p.eventDeltaPct !== undefined ? Number(p.eventDeltaPct) : null,
        priceDropDays: days,
      })
    );

    return res.json({
      ok: true,
      items,
      products: items,
      meta: {
        limit,
        days,
        selected: items.length,
        strategy: "wardrobe_recent_price_change_vs_saved_price",
      },
    });
  } catch (e) {
    console.error("[toptry] /api/wardrobe/price-drops error", e);
    return res.status(500).json({ error: e?.message || "Failed to load wardrobe price drops" });
  }
});



app.get("/api/catalog/home-new", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit || 8);
    const limit = Math.max(1, Math.min(16, Number.isFinite(rawLimit) ? rawLimit : 8));
    const poolLimit = Math.max(120, Math.min(500, limit * 80));

    const rows = await prisma.$queryRawUnsafe(
      `
      with latest_review as (
        select distinct on (r."productId")
          r."productId",
          r."isTryOnRelevantSuggested",
          r."rejectReasons",
          r.confidence,
          r."createdAt"
        from "CatalogProductAIReview" r
        order by r."productId", r."createdAt" desc
      )
      select
        p.id,
        p.merchant,
        p."externalId",
        p.title,
        p.brand,
        p.category,
        p.gender,
        p.price,
        p."oldPrice",
        p.currency,
        p."imageUrl",
        p."productUrl",
        p."affiliateUrl",
        p."sizesTop",
        p."sizesBottom",
        p."sizesShoes",
        p."taxonomyGroup",
        p."taxonomySubgroup",
        p."styleTags",
        p."occasionTags",
        p."seasonTags",
        p."colorFamily",
        p."createdAt",
        p."updatedAt"
      from "CatalogProduct" p
      join latest_review lr on lr."productId" = p.id
      where p."isActive" = true
        and p.price is not null
        and p.price > 0
        and p."imageUrl" is not null
        and p."imageUrl" <> ''
        and coalesce(p."taxonomyGroup", '') in ('CLOTHING', 'SHOES', 'BAGS')
        and lr."isTryOnRelevantSuggested" = true
        and coalesce(cardinality(lr."rejectReasons"), 0) = 0
      order by
        case coalesce(p."taxonomyGroup", '')
          when 'CLOTHING' then 0
          when 'SHOES' then 1
          when 'BAGS' then 2
          else 3
        end,
        p."createdAt" desc,
        p."updatedAt" desc
      limit $1
      `,
      poolLimit
    );

    const sizeCount = (p) =>
      (Array.isArray(p.sizesTop) ? p.sizesTop.length : 0) +
      (Array.isArray(p.sizesBottom) ? p.sizesBottom.length : 0) +
      (Array.isArray(p.sizesShoes) ? p.sizesShoes.length : 0);

    const titleKey = (p) =>
      String(p.title || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\b(черный|чёрный|белый|синий|серый|красный|зеленый|зелёный|мультицвет|black|white|blue|grey|gray|red|green)\b/gi, "")
        .trim()
        .slice(0, 80);

    const scored = rows.map((p, idx) => {
      const price = Number(p.price || 0);
      const oldPrice = Number(p.oldPrice || 0);
      const discountPct = oldPrice > price && price > 0
        ? Math.round(((oldPrice - price) / oldPrice) * 100)
        : 0;

      const hasSizes = sizeCount(p) > 0 ? 1 : 0;

      // Freshness dominates: rows are already ordered by createdAt desc.
      // Discount and size availability only break ties / improve merchandising.
      const score =
        (rows.length - idx) * 100 +
        Math.min(discountPct, 70) * 2 +
        hasSizes * 25;

      return { ...p, _score: score, _titleKey: titleKey(p) };
    }).sort((a, b) => b._score - a._score);

    const selectionPool = shuffleCatalogCollectionRows(scored.slice(0, Math.max(limit * 30, 120)));

    const pickWithLimits = (merchantMax, groupMax, allowDupes = false) =>
      pickCatalogCollectionDiverseRows({
        rows: selectionPool,
        limit,
        merchantMax,
        groupMax,
        allowDupes,
        titleKeyFn: (p) => p._titleKey || p.id,
      });

    let selected = pickCatalogCollectionMerchandisedRows({
      rows: selectionPool,
      limit,
      requiredClothing: Math.min(3, Math.max(2, Math.ceil(limit * 0.35))),
      merchantMax: Math.max(2, Math.ceil(limit * 0.4)),
      groupMax: {
        CLOTHING: Math.max(2, Math.ceil(limit * 0.55)),
        SHOES: Math.max(1, Math.ceil(limit * 0.35)),
        BAGS: Math.max(1, Math.floor(limit * 0.25)),
      },
      genderMax: {
        FEMALE: Math.max(2, Math.ceil(limit * 0.6)),
        MALE: Math.max(2, Math.ceil(limit * 0.6)),
        UNISEX: Math.max(1, Math.floor(limit * 0.25)),
      },
      requiredGenders: ["FEMALE", "MALE"],
      titleKeyFn: (p) => p._titleKey || p.id,
    });

    const products = selected.slice(0, limit).map((p) => ({
      id: p.id,
      merchant: p.merchant,
      externalId: p.externalId,
      title: p.title,
      brand: p.brand,
      category: p.category,
      gender: p.gender,
      price: p.price,
      oldPrice: p.oldPrice,
      currency: p.currency || "RUB",
      imageUrl: p.imageUrl,
      images: p.imageUrl ? [p.imageUrl] : [],
      productUrl: p.productUrl,
      affiliateUrl: p.affiliateUrl,
      sizesTop: p.sizesTop || [],
      sizesBottom: p.sizesBottom || [],
      sizesShoes: p.sizesShoes || [],
      taxonomyGroup: p.taxonomyGroup,
      taxonomySubgroup: p.taxonomySubgroup,
      styleTags: p.styleTags || [],
      occasionTags: p.occasionTags || [],
      seasonTags: p.seasonTags || [],
      colorFamily: p.colorFamily || "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    res.json({
      ok: true,
      products,
      meta: {
        limit,
        pool: rows.length,
        selected: products.length,
        strategy: "fresh_ai_clean_merchandised_clothing_gender_balanced_pool",
      },
    });
  } catch (e) {
    console.error("[toptry] /api/catalog/home-new error", e);
    res.status(500).json({ error: "Failed to load home catalog products" });
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
    const bagType =
      typeof req.query.bagType === "string" && req.query.bagType.trim()
        ? req.query.bagType.trim().toUpperCase()
        : "";
    const accessoryType =
      typeof req.query.accessoryType === "string" && req.query.accessoryType.trim()
        ? req.query.accessoryType.trim().toUpperCase()
        : "";

    const discountOnly =
      String(req.query.discountOnly || "").trim() === "1";
    const brand =
      typeof req.query.brand === "string" && req.query.brand.trim()
        ? req.query.brand.trim()
        : "";
    const colorFamily =
      typeof req.query.colorFamily === "string" && req.query.colorFamily.trim()
        ? req.query.colorFamily.trim()
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
      colorFamily,
      priceMin,
      priceMax,
      clothingType,
      shoeType,
      bagType,
      accessoryType,
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
                  : p.merchant === "finnflare"
                    ? "FINN FLARE"
                    : p.merchant === "snowqueen"
                      ? "Снежная Королева"
                      : p.merchant === "sportcourt"
                        ? "Sportcourt"
                        : p.merchant || "Магазин",
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

    let products = rows.map(mapProduct);

    const isUnavailableSimilarFallback =
      String(req.query.unavailable || "").trim() === "1" &&
      offset === 0 &&
      total === 0 &&
      !!colorFamily &&
      !!(displayCategory || category || clothingType || shoeType || bagType || accessoryType);

    if (isUnavailableSimilarFallback) {
      const fallbackWhere = buildCatalogDbWhere({
        merchant,
        gender,
        category,
        displayCategory,
        q,
        discountOnly,
        brand,
        colorFamily: "",
        priceMin,
        priceMax,
        clothingType,
        shoeType,
        bagType,
      accessoryType,
        accessoryType,
        size: rawSize === "MY" ? "" : rawSize,
        sizeTop: effectiveMySizeTop,
        sizeBottom: effectiveMySizeBottom,
        sizeShoes: effectiveMySizeShoes,
        sizeLoose,
      });

      let fallbackRows = [];
      let fallbackTotal = 0;

      if (rawSize === "MY") {
        let allFallbackRows = await prisma.catalogProduct.findMany({
          where: fallbackWhere,
          orderBy: sort === "discount_desc" ? [{ updatedAt: "desc" }] : orderBy,
        });

        allFallbackRows = allFallbackRows.filter(matchesEffectiveMySize);

        if (sort === "discount_desc") {
          allFallbackRows.sort((a, b) => {
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

        fallbackTotal = allFallbackRows.length;
        fallbackRows = allFallbackRows.slice(0, limit);
      } else if (sort === "discount_desc") {
        const allFallbackRows = await prisma.catalogProduct.findMany({
          where: fallbackWhere,
          orderBy: [{ updatedAt: "desc" }],
        });

        allFallbackRows.sort((a, b) => {
          const priceA = Number(a.price || 0);
          const oldA = Number(a.oldPrice || 0);
          const discountA = oldA > priceA && priceA > 0 ? (oldA - priceA) / oldA : 0;

          const priceB = Number(b.price || 0);
          const oldB = Number(b.oldPrice || 0);
          const discountB = oldB > priceB && priceB > 0 ? (oldB - priceB) / oldB : 0;

          if (discountB !== discountA) return discountB - discountA;
          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        });

        fallbackTotal = allFallbackRows.length;
        fallbackRows = allFallbackRows.slice(0, limit);
      } else {
        [fallbackRows, fallbackTotal] = await Promise.all([
          prisma.catalogProduct.findMany({
            where: fallbackWhere,
            orderBy,
            skip: 0,
            take: limit,
          }),
          prisma.catalogProduct.count({ where: fallbackWhere }),
        ]);
      }

      products = fallbackRows.map(mapProduct);

      return res.json({
        products,
        total: fallbackTotal,
        originalTotal: 0,
        limit,
        offset,
        hasMore: products.length < fallbackTotal,
        fallback: {
          active: true,
          reason: "no_exact_color_match",
          message: "Точных совпадений нет — показываем похожие товары других цветов",
          removedFilters: ["colorFamily"],
          originalColorFamily: normalizeCatalogColorFamily(colorFamily) || colorFamily,
        },
      });
    }

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
          authorName: author?.publicDisplayName || author?.username || author?.name || "Автор",
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



// ---------- CATALOG NIGHTLY PIPELINE ----------

const CATALOG_PIPELINE_MERCHANTS = [
  "remington",
  "rendezvous",
  "thecultt",
  "sportcourt",
  "sportmaster",
  "finnflare",
  "snowqueen",
];

const CATALOG_PIPELINE_REPORT_DIR =
  process.env.CATALOG_PIPELINE_REPORT_DIR || "/tmp/toptry-catalog-pipeline-reports";

const CATALOG_PIPELINE_AI_BATCH_DELAY_MS = Math.max(
  0,
  Number(process.env.CATALOG_PIPELINE_AI_BATCH_DELAY_MS || 45000)
);

const CATALOG_PIPELINE_AI_ERROR_SLEEP_MS = Math.max(
  1000,
  Number(process.env.CATALOG_PIPELINE_AI_ERROR_SLEEP_MS || 240000)
);

const CATALOG_PIPELINE_AI_MAX_CONSECUTIVE_ERRORS = Math.max(
  1,
  Number(process.env.CATALOG_PIPELINE_AI_MAX_CONSECUTIVE_ERRORS || 5)
);

let catalogNightlyPipelineRunning = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_k, v) =>
    typeof v === "bigint" ? String(v) : v
  ));
}

function pipelineNowIso() {
  return new Date().toISOString();
}

function truncateForReport(value, maxLen = 2000) {
  const s = typeof value === "string" ? value : JSON.stringify(jsonSafe(value), null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + "\n...[truncated]" : s;
}

async function updateCatalogPipelineLiveReport(runId, reportLines) {
  if (!runId) return;
  try {
    await prisma.catalogPipelineRun.update({
      where: { id: runId },
      data: {
        reportText: reportLines.join("\n"),
      },
    });
  } catch (e) {
    console.warn("[toptry] catalog pipeline live report update failed", e?.message || e);
  }
}

function findExpressRouteHandler(method, routePath) {
  const stack = app?._router?.stack || app?.router?.stack || [];
  const lowerMethod = String(method || "GET").toLowerCase();

  for (const layer of stack) {
    const route = layer?.route;
    if (!route) continue;
    if (route.path !== routePath) continue;
    if (!route.methods?.[lowerMethod]) continue;

    const routeStack = Array.isArray(route.stack) ? route.stack : [];
    const match = routeStack.find((r) => typeof r?.handle === "function");
    if (match?.handle) return match.handle;
  }

  return null;
}

async function callLocalCatalogPipelineJson(pathname, { method = "POST", timeoutMs = 1800000 } = {}) {
  // Do not call this backend through HTTP from itself.
  // Long catalog imports were observed to hang/fail through self-HTTP calls.
  // Instead, invoke the already registered Express route handler directly.
  const u = new URL(String(pathname || "/"), "http://toptry.local");
  const routePath = u.pathname;
  const handler = findExpressRouteHandler(method, routePath);

  if (!handler) {
    throw new Error(`local pipeline route handler not found: ${method} ${routePath}`);
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    let statusCode = 200;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`local pipeline handler timeout after ${timeoutMs}ms: ${method} ${pathname}`));
    }, timeoutMs);

    const finish = (payload, isSend = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let data = payload;
      if (isSend && typeof payload === "string") {
        try {
          data = JSON.parse(payload);
        } catch {
          data = { rawText: payload };
        }
      }

      if (statusCode < 200 || statusCode >= 300) {
        const err = new Error(`HTTP ${statusCode}: ${truncateForReport(data, 800)}`);
        err.status = statusCode;
        err.data = data;
        reject(err);
        return;
      }

      resolve(data);
    };

    const req = {
      method: String(method || "GET").toUpperCase(),
      url: pathname,
      path: routePath,
      originalUrl: pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      params: {},
      body: {},
      headers: {},
      auth: null,
    };

    const res = {
      status(code) {
        statusCode = Number(code || 200);
        return this;
      },
      json(payload) {
        finish(payload, false);
        return this;
      },
      send(payload) {
        finish(payload, true);
        return this;
      },
      end(payload) {
        finish(payload || "", true);
        return this;
      },
      setHeader() {
        return this;
      },
    };

    Promise.resolve(handler(req, res)).catch((e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function createPipelineStep(runId, name, merchant = null) {
  return prisma.catalogPipelineStep.create({
    data: {
      runId,
      name,
      merchant,
      status: "RUNNING",
    },
  });
}

async function finishPipelineStep(step, status, result = null, error = null) {
  const finishedAt = new Date();
  const durationMs = Math.max(
    0,
    finishedAt.getTime() - new Date(step.startedAt).getTime()
  );

  return prisma.catalogPipelineStep.update({
    where: { id: step.id },
    data: {
      status,
      finishedAt,
      durationMs,
      result: result == null ? undefined : jsonSafe(result),
      error: error ? String(error).slice(0, 5000) : null,
    },
  });
}

async function runPipelineStep(runId, name, merchant, fn, reportLines, warnings) {
  const step = await createPipelineStep(runId, name, merchant);
  const label = merchant ? `${name}:${merchant}` : name;
  reportLines.push(`\n[${pipelineNowIso()}] STEP START ${label}`);
  await updateCatalogPipelineLiveReport(runId, reportLines);

  try {
    const result = await fn();
    await finishPipelineStep(step, "COMPLETED", result, null);
    reportLines.push(`[${pipelineNowIso()}] STEP OK ${label}`);
    reportLines.push(truncateForReport(result, 5000));
    await updateCatalogPipelineLiveReport(runId, reportLines);
    return { ok: true, result };
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    await finishPipelineStep(step, "FAILED", e?.data || null, msg);
    reportLines.push(`[${pipelineNowIso()}] STEP FAILED ${label}`);
    reportLines.push(String(msg).slice(0, 5000));
    warnings.push(`${label}: ${String(e?.message || e).slice(0, 500)}`);
    await updateCatalogPipelineLiveReport(runId, reportLines);
    return { ok: false, error: msg };
  }
}

async function getCatalogPipelineHealthSummary() {
  return prisma.$queryRawUnsafe(`
    select
      p.merchant,
      count(*) filter (where p."isActive" = true) as active_products,
      count(*) filter (
        where p."isActive" = true and coalesce(p."taxonomyGroup",'') = ''
      ) as active_empty_group,
      count(*) filter (
        where p."isActive" = true and coalesce(p."taxonomySubgroup",'') = ''
      ) as active_empty_subgroup,
      count(*) filter (
        where p."isActive" = true
          and coalesce(array_length(p."sizesTop",1),0)
            + coalesce(array_length(p."sizesBottom",1),0)
            + coalesce(array_length(p."sizesShoes",1),0) = 0
      ) as active_without_sizes,
      count(*) filter (
        where p."isActive" = true
          and exists (
            select 1 from "CatalogProductAIReview" r where r."productId" = p.id
          )
      ) as active_with_ai_review,
      count(*) filter (
        where p."isActive" = true
          and not exists (
            select 1 from "CatalogProductAIReview" r where r."productId" = p.id
          )
      ) as active_without_ai_review
    from "CatalogProduct" p
    group by p.merchant
    order by p.merchant
  `);
}

async function runCatalogPipelineAiReviewForMerchant(runId, merchant, reportLines, warnings) {
  const step = await createPipelineStep(runId, "ai-review-new-products", merchant);
  const startedAt = Date.now();

  const totals = {
    merchant,
    reviewed: 0,
    saved: 0,
    batches: 0,
    errors: 0,
    retries: 0,
    completed: false,
  };

  reportLines.push(`\n[${pipelineNowIso()}] STEP START ai-review-new-products:${merchant}`);

  let consecutiveErrors = 0;

  while (true) {
    try {
      const data = await callLocalCatalogPipelineJson(
        `/api/admin/catalog/ai-review/gemini-text?merchant=${encodeURIComponent(merchant)}&limit=100&chunkSize=20&skipReviewed=1`,
        { method: "POST", timeoutMs: 1200000 }
      );

      const reviewed = Number(data?.reviewed || 0);
      const saved = Number(data?.saved || 0);

      totals.batches += 1;
      totals.reviewed += reviewed;
      totals.saved += saved;
      consecutiveErrors = 0;

      reportLines.push(
        `[${pipelineNowIso()}] AI ${merchant} batch=${totals.batches} reviewed=${reviewed} saved=${saved} model=${data?.model || ""}`
      );
      await updateCatalogPipelineLiveReport(runId, reportLines);

      if (reviewed <= 0) {
        totals.completed = true;
        break;
      }

      if (CATALOG_PIPELINE_AI_BATCH_DELAY_MS > 0) {
        await sleep(CATALOG_PIPELINE_AI_BATCH_DELAY_MS);
      }
    } catch (e) {
      totals.errors += 1;
      totals.retries += 1;
      consecutiveErrors += 1;

      const msg = String(e?.message || e);
      reportLines.push(
        `[${pipelineNowIso()}] AI ERROR ${merchant} consecutive=${consecutiveErrors}/${CATALOG_PIPELINE_AI_MAX_CONSECUTIVE_ERRORS}: ${msg.slice(0, 800)}`
      );
      await updateCatalogPipelineLiveReport(runId, reportLines);

      if (consecutiveErrors >= CATALOG_PIPELINE_AI_MAX_CONSECUTIVE_ERRORS) {
        const warning = `AI-review incomplete for ${merchant}: ${consecutiveErrors} consecutive errors`;
        warnings.push(warning);
        reportLines.push(`[${pipelineNowIso()}] WARNING ${warning}`);
        break;
      }

      await sleep(CATALOG_PIPELINE_AI_ERROR_SLEEP_MS);
    }
  }

  const status = totals.completed ? "COMPLETED" : "WARNING";
  await finishPipelineStep(
    step,
    status,
    totals,
    totals.completed ? null : `AI-review incomplete for ${merchant}`
  );

  reportLines.push(
    `[${pipelineNowIso()}] STEP ${status} ai-review-new-products:${merchant} reviewed=${totals.reviewed} saved=${totals.saved} batches=${totals.batches} errors=${totals.errors} durationMs=${Date.now() - startedAt}`
  );

  return totals;
}


app.post("/api/admin/catalog/record-price-changes", async (req, res) => {
  try {
    const pipelineRunId = String(req.query.runId || req.body?.runId || "").trim() || null;
    const minDeltaRub = Math.max(1, Number(req.query.minDeltaRub || 1) || 1);
    const minDeltaPct = Math.max(0, Number(req.query.minDeltaPct || 0) || 0);

    await prisma.$executeRawUnsafe(`
      create table if not exists "CatalogProductPriceSnapshot" (
        "productId" text primary key,
        merchant text not null,
        title text,
        price double precision,
        "oldPrice" double precision,
        currency text,
        "imageUrl" text,
        "firstSeenAt" timestamptz not null default now(),
        "lastSeenAt" timestamptz not null default now(),
        "updatedAt" timestamptz not null default now()
      );
    `);

    await prisma.$executeRawUnsafe(`
      create table if not exists "CatalogProductPriceChange" (
        id text primary key,
        "changeKey" text not null unique,
        "productId" text not null,
        merchant text not null,
        title text,
        "previousPrice" double precision not null,
        "currentPrice" double precision not null,
        delta double precision not null,
        "deltaPct" double precision not null,
        direction text not null,
        "detectedAt" timestamptz not null default now(),
        "pipelineRunId" text,
        "imageUrl" text,
        "productUrl" text,
        "affiliateUrl" text
      );
    `);

    await prisma.$executeRawUnsafe(`create index if not exists "CatalogProductPriceSnapshot_merchant_idx" on "CatalogProductPriceSnapshot"(merchant);`);
    await prisma.$executeRawUnsafe(`create index if not exists "CatalogProductPriceChange_merchant_idx" on "CatalogProductPriceChange"(merchant);`);
    await prisma.$executeRawUnsafe(`create index if not exists "CatalogProductPriceChange_detectedAt_idx" on "CatalogProductPriceChange"("detectedAt");`);
    await prisma.$executeRawUnsafe(`create index if not exists "CatalogProductPriceChange_direction_idx" on "CatalogProductPriceChange"(direction);`);

    // Backfill hidden drops caused by old product ids that included price in dedupe key.
    // Stable match: merchant + normalized brand + normalized imageUrl.
    const insertedHiddenDrops = await prisma.$executeRawUnsafe(
      `
      with active_products as (
        select
          p.id,
          p.merchant,
          p.title,
          p.brand,
          p.price,
          p."oldPrice",
          p.currency,
          p."imageUrl",
          p."productUrl",
          p."affiliateUrl",
          lower(coalesce(p.brand, '')) as brand_key,
          regexp_replace(lower(coalesce(p."imageUrl", '')), '[?#].*$', '') as image_key
        from "CatalogProduct" p
        where p."isActive" = true
          and p.merchant <> 'snowqueen'
          and p.price is not null
          and p.price > 0
          and coalesce(p."imageUrl", '') <> ''
      ),
      old_products as (
        select
          p.id,
          p.merchant,
          p.title,
          p.brand,
          p.price,
          p."oldPrice",
          p.currency,
          p."imageUrl",
          p."productUrl",
          p."affiliateUrl",
          lower(coalesce(p.brand, '')) as brand_key,
          regexp_replace(lower(coalesce(p."imageUrl", '')), '[?#].*$', '') as image_key,
          p."updatedAt"
        from "CatalogProduct" p
        where p."isActive" = false
          and p.merchant <> 'snowqueen'
          and p.price is not null
          and p.price > 0
          and coalesce(p."imageUrl", '') <> ''
      ),
      best_old as (
        select distinct on (a.id)
          a.id as active_id,
          a.merchant,
          a.title,
          a.price as current_price,
          a."oldPrice" as current_old_price,
          a.currency,
          a."imageUrl",
          a."productUrl",
          a."affiliateUrl",
          o.id as old_id,
          o.price as previous_price,
          o."updatedAt" as old_updated_at
        from active_products a
        join old_products o
          on o.merchant = a.merchant
         and o.brand_key = a.brand_key
         and o.image_key = a.image_key
         and o.id <> a.id
        where a.price < o.price
          and (o.price - a.price) >= $2
          and (case when o.price > 0 then ((o.price - a.price) / o.price) * 100 else 0 end) >= $3
        order by a.id, o.price desc, o."updatedAt" desc
      )
      insert into "CatalogProductPriceChange" (
        id,
        "changeKey",
        "productId",
        merchant,
        title,
        "previousPrice",
        "currentPrice",
        delta,
        "deltaPct",
        direction,
        "detectedAt",
        "pipelineRunId",
        "imageUrl",
        "productUrl",
        "affiliateUrl"
      )
      select
        'price-change-hidden-' || md5(active_id || ':' || old_id || ':' || previous_price::text || ':' || current_price::text),
        md5('hidden:' || active_id || ':' || old_id || ':' || previous_price::text || ':' || current_price::text),
        active_id,
        merchant,
        title,
        previous_price,
        current_price,
        previous_price - current_price,
        case when previous_price > 0 then round((((previous_price - current_price) / previous_price) * 100)::numeric, 2)::double precision else 0 end,
        'DROP',
        now(),
        $1,
        "imageUrl",
        "productUrl",
        "affiliateUrl"
      from best_old
      on conflict ("changeKey") do nothing
      `,
      pipelineRunId,
      minDeltaRub,
      minDeltaPct
    );

    const insertedDrops = await prisma.$executeRawUnsafe(
      `
      insert into "CatalogProductPriceChange" (
        id,
        "changeKey",
        "productId",
        merchant,
        title,
        "previousPrice",
        "currentPrice",
        delta,
        "deltaPct",
        direction,
        "detectedAt",
        "pipelineRunId",
        "imageUrl",
        "productUrl",
        "affiliateUrl"
      )
      select
        'price-change-' || md5(p.id || ':' || s.price::text || ':' || p.price::text || ':' || to_char(now(), 'YYYY-MM-DD')),
        md5(p.id || ':' || s.price::text || ':' || p.price::text || ':' || to_char(now(), 'YYYY-MM-DD')),
        p.id,
        p.merchant,
        p.title,
        s.price,
        p.price,
        s.price - p.price,
        case when s.price > 0 then round((((s.price - p.price) / s.price) * 100)::numeric, 2)::double precision else 0 end,
        'DROP',
        now(),
        $1,
        p."imageUrl",
        p."productUrl",
        p."affiliateUrl"
      from "CatalogProduct" p
      join "CatalogProductPriceSnapshot" s on s."productId" = p.id
      where p."isActive" = true
        and p.price is not null
        and p.price > 0
        and s.price is not null
        and s.price > p.price
        and (s.price - p.price) >= $2
        and (case when s.price > 0 then ((s.price - p.price) / s.price) * 100 else 0 end) >= $3
      on conflict ("changeKey") do nothing
      `,
      pipelineRunId,
      minDeltaRub,
      minDeltaPct
    );

    const snapshotUpdated = await prisma.$executeRawUnsafe(
      `
      insert into "CatalogProductPriceSnapshot" (
        "productId",
        merchant,
        title,
        price,
        "oldPrice",
        currency,
        "imageUrl",
        "firstSeenAt",
        "lastSeenAt",
        "updatedAt"
      )
      select
        p.id,
        p.merchant,
        p.title,
        p.price,
        p."oldPrice",
        p.currency,
        p."imageUrl",
        now(),
        now(),
        now()
      from "CatalogProduct" p
      where p."isActive" = true
        and p.price is not null
        and p.price > 0
      on conflict ("productId") do update set
        merchant = excluded.merchant,
        title = excluded.title,
        price = excluded.price,
        "oldPrice" = excluded."oldPrice",
        currency = excluded.currency,
        "imageUrl" = excluded."imageUrl",
        "lastSeenAt" = now(),
        "updatedAt" = now()
      `
    );

    const byMerchant = await prisma.$queryRawUnsafe(
      `
      select
        merchant,
        count(*)::int as drops,
        round(sum(delta)::numeric, 2)::double precision as "totalDeltaRub"
      from "CatalogProductPriceChange"
      where ($1::text is null or "pipelineRunId" = $1::text)
        and direction = 'DROP'
      group by merchant
      order by drops desc, merchant asc
      `,
      pipelineRunId
    );

    res.json({
      ok: true,
      pipelineRunId,
      insertedDrops,
      insertedHiddenDrops,
      snapshotUpdated,
      byMerchant,
      minDeltaRub,
      minDeltaPct,
    });
  } catch (e) {
    console.error("[toptry] /api/admin/catalog/record-price-changes error", e);
    res.status(500).json({ error: e?.message || "Failed to record price changes" });
  }
});


async function runCatalogNightlyPipeline({ runId = "", applySafe = false, trigger = "manual" } = {}) {
  runId = runId || `catalog-pipeline-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = new Date();

  const reportLines = [];
  const warnings = [];
  const stepResults = {
    imports: {},
    priceChanges: null,
    backfillSizes: {},
    enrichTaxonomy: {},
    aiReview: {},
    safeTaxonomy: null,
    safeDeactivate: null,
    finalHealth: null,
  };

  await prisma.catalogPipelineRun.create({
    data: {
      id: runId,
      kind: "nightly-catalog",
      status: "RUNNING",
      applySafe,
      startedAt,
      meta: {
        trigger,
        merchants: CATALOG_PIPELINE_MERCHANTS,
        aiBatchDelayMs: CATALOG_PIPELINE_AI_BATCH_DELAY_MS,
        aiErrorSleepMs: CATALOG_PIPELINE_AI_ERROR_SLEEP_MS,
        aiMaxConsecutiveErrors: CATALOG_PIPELINE_AI_MAX_CONSECUTIVE_ERRORS,
      },
    },
  });

  reportLines.push(`TopTry catalog nightly pipeline report`);
  reportLines.push(`Run ID: ${runId}`);
  reportLines.push(`Status: RUNNING`);
  reportLines.push(`Started: ${startedAt.toISOString()}`);
  reportLines.push(`Trigger: ${trigger}`);
  reportLines.push(`applySafe: ${applySafe ? "true" : "false"}`);
  reportLines.push(`Merchants: ${CATALOG_PIPELINE_MERCHANTS.join(", ")}`);

  let finalStatus = "COMPLETED";
  let finalError = null;

  try {
    for (const merchant of CATALOG_PIPELINE_MERCHANTS) {
      const r = await runPipelineStep(
        runId,
        "import",
        merchant,
        () => callLocalCatalogPipelineJson(
          `/api/admin/catalog/import/${encodeURIComponent(merchant)}`,
          { method: "POST", timeoutMs: 1800000 }
        ),
        reportLines,
        warnings
      );
      stepResults.imports[merchant] = r.result || { error: r.error };
      if (!r.ok) finalStatus = "WARNING";
    }

    {
      const r = await runPipelineStep(
        runId,
        "record-price-changes",
        null,
        () => callLocalCatalogPipelineJson(
          `/api/admin/catalog/record-price-changes?runId=${encodeURIComponent(runId)}&minDeltaRub=1&minDeltaPct=0`,
          { method: "POST", timeoutMs: 600000 }
        ),
        reportLines,
        warnings
      );
      stepResults.priceChanges = r.result || { error: r.error };
      if (!r.ok) finalStatus = "WARNING";
    }

    for (const merchant of CATALOG_PIPELINE_MERCHANTS) {
      const r = await runPipelineStep(
        runId,
        "backfill-sizes",
        merchant,
        () => callLocalCatalogPipelineJson(
          `/api/admin/catalog/backfill-sizes?merchant=${encodeURIComponent(merchant)}&limit=50000`,
          { method: "POST", timeoutMs: 1200000 }
        ),
        reportLines,
        warnings
      );
      stepResults.backfillSizes[merchant] = r.result || { error: r.error };
      if (!r.ok) finalStatus = "WARNING";
    }

    for (const merchant of CATALOG_PIPELINE_MERCHANTS) {
      const r = await runPipelineStep(
        runId,
        "enrich-taxonomy",
        merchant,
        () => callLocalCatalogPipelineJson(
          `/api/admin/catalog/enrich-taxonomy?merchant=${encodeURIComponent(merchant)}&limit=50000&force=1`,
          { method: "POST", timeoutMs: 1200000 }
        ),
        reportLines,
        warnings
      );
      stepResults.enrichTaxonomy[merchant] = r.result || { error: r.error };
      if (!r.ok) finalStatus = "WARNING";
    }

    for (const merchant of CATALOG_PIPELINE_MERCHANTS) {
      const r = await runCatalogPipelineAiReviewForMerchant(
        runId,
        merchant,
        reportLines,
        warnings
      );
      stepResults.aiReview[merchant] = r;
      if (!r.completed) finalStatus = "WARNING";
    }

    const safeTaxonomyDryRun = !applySafe;
    const safeDeactivateDryRun = !applySafe;

    const safeTaxonomy = await runPipelineStep(
      runId,
      "apply-taxonomy-safe",
      null,
      () => callLocalCatalogPipelineJson(
        `/api/admin/catalog/ai-review/apply-taxonomy-safe?dryRun=${safeTaxonomyDryRun ? "1" : "0"}&limit=5000&minConfidence=0.9`,
        { method: "POST", timeoutMs: 1200000 }
      ),
      reportLines,
      warnings
    );
    stepResults.safeTaxonomy = safeTaxonomy.result || { error: safeTaxonomy.error };
    if (!safeTaxonomy.ok) finalStatus = "WARNING";

    const safeDeactivate = await runPipelineStep(
      runId,
      "apply-safe-deactivate",
      null,
      () => callLocalCatalogPipelineJson(
        `/api/admin/catalog/ai-review/apply-safe-deactivate?dryRun=${safeDeactivateDryRun ? "1" : "0"}&limit=5000&minConfidence=0.95`,
        { method: "POST", timeoutMs: 1200000 }
      ),
      reportLines,
      warnings
    );
    stepResults.safeDeactivate = safeDeactivate.result || { error: safeDeactivate.error };
    if (!safeDeactivate.ok) finalStatus = "WARNING";

    const finalHealthStep = await runPipelineStep(
      runId,
      "final-health",
      null,
      async () => {
        const rows = await getCatalogPipelineHealthSummary();
        return jsonSafe(rows);
      },
      reportLines,
      warnings
    );
    stepResults.finalHealth = finalHealthStep.result || { error: finalHealthStep.error };
    if (!finalHealthStep.ok) finalStatus = "WARNING";

    if (warnings.length && finalStatus === "COMPLETED") {
      finalStatus = "WARNING";
    }
  } catch (e) {
    finalStatus = "FAILED";
    finalError = e?.stack || e?.message || String(e);
    reportLines.push(`\n[${pipelineNowIso()}] PIPELINE FAILED`);
    reportLines.push(String(finalError).slice(0, 5000));
  }

  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  reportLines.push(`\nFinished: ${finishedAt.toISOString()}`);
  reportLines.push(`Duration ms: ${durationMs}`);
  reportLines.push(`Final status: ${finalStatus}`);

  if (warnings.length) {
    reportLines.push(`\nWARNINGS`);
    for (const w of warnings) reportLines.push(`- ${w}`);
  }

  reportLines.push(`\nSUMMARY JSON`);
  reportLines.push(JSON.stringify(jsonSafe(stepResults), null, 2));

  const reportText = reportLines.join("\n");
  let reportPath = null;

  try {
    await fs.mkdir(CATALOG_PIPELINE_REPORT_DIR, { recursive: true });
    reportPath = path.join(
      CATALOG_PIPELINE_REPORT_DIR,
      `${runId}.txt`
    );
    await fs.writeFile(reportPath, reportText, "utf8");
  } catch (e) {
    warnings.push(`report file write failed: ${e?.message || e}`);
  }

  await prisma.catalogPipelineRun.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      finishedAt,
      durationMs,
      reportText,
      reportPath,
      error: finalError ? String(finalError).slice(0, 5000) : null,
      meta: {
        trigger,
        merchants: CATALOG_PIPELINE_MERCHANTS,
        warnings,
        stepResults: jsonSafe(stepResults),
      },
    },
  });

  catalogNightlyPipelineRunning = null;
  await updateCatalogPipelineLiveReport(runId, reportLines);

  console.log("[toptry] catalog nightly pipeline finished", {
    runId,
    status: finalStatus,
    durationMs,
    reportPath,
    warnings: warnings.length,
  });

  return {
    ok: finalStatus !== "FAILED",
    runId,
    status: finalStatus,
    durationMs,
    reportPath,
    warnings,
  };
}

function startCatalogNightlyPipeline({ applySafe = false, trigger = "manual" } = {}) {
  if (catalogNightlyPipelineRunning?.running) {
    return {
      ok: true,
      queued: false,
      running: true,
      runId: catalogNightlyPipelineRunning.runId,
      startedAt: catalogNightlyPipelineRunning.startedAt,
    };
  }

  const startedAt = new Date().toISOString();
  const runId = `catalog-pipeline-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const runPromise = runCatalogNightlyPipeline({ runId, applySafe, trigger })
    .catch((e) => {
      console.error("[toptry] catalog nightly pipeline fatal", e?.stack || e);
      catalogNightlyPipelineRunning = null;
    });

  catalogNightlyPipelineRunning = {
    running: true,
    runId,
    startedAt,
    promise: runPromise,
  };

  return {
    ok: true,
    queued: true,
    running: true,
    runId,
    startedAt,
  };
}

app.post("/api/admin/catalog/nightly-pipeline/start", (req, res) => {
  const applySafe = String(req.query.applySafe || "") === "1";
  const trigger = String(req.query.trigger || "manual").slice(0, 80);

  const result = startCatalogNightlyPipeline({ applySafe, trigger });
  return res.status(result.queued ? 202 : 200).json(result);
});

app.get("/api/admin/catalog/nightly-pipeline/runs", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));

    const runs = await prisma.catalogPipelineRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        steps: {
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            name: true,
            merchant: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            error: true,
          },
        },
      },
    });

    return res.json({ ok: true, runs });
  } catch (e) {
    console.error("[toptry] catalog pipeline runs list error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


setImmediate(async () => {
  try {
    const staleMessage = "Marked failed on backend startup: previous pipeline was interrupted";
    await prisma.catalogPipelineStep.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: staleMessage,
      },
    });
    await prisma.catalogPipelineRun.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: staleMessage,
      },
    });
  } catch (e) {
    console.warn("[toptry] catalog pipeline stale cleanup failed", e?.message || e);
  }
});


function parseToptryClockTime(value, fallback = "03:30") {
  const raw = String(value || fallback).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return parseToptryClockTime(fallback, "03:30");

  const hour = Math.max(0, Math.min(23, Number(m[1])));
  const minute = Math.max(0, Math.min(59, Number(m[2])));

  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function getToptryMoscowDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    dateKey: `${String(get("year")).padStart(4, "0")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`,
  };
}

let catalogNightlySchedulerLastDateKey = "";

function maybeStartCatalogNightlyScheduler() {
  const enabled = String(process.env.CATALOG_NIGHTLY_SCHEDULER_ENABLED || "").trim() === "1";
  if (!enabled) {
    console.log("[toptry] catalog nightly scheduler disabled");
    return;
  }

  const schedule = parseToptryClockTime(process.env.CATALOG_NIGHTLY_SCHEDULER_TIME_MSK || "03:30");
  const applySafe = String(process.env.CATALOG_NIGHTLY_SCHEDULER_APPLY_SAFE || "").trim() === "1";
  const tickMs = Math.max(30_000, Number(process.env.CATALOG_NIGHTLY_SCHEDULER_TICK_MS || 60_000));

  console.log("[toptry] catalog nightly scheduler enabled", {
    timeMsk: schedule.label,
    applySafe,
    tickMs,
  });

  const tick = () => {
    try {
      const now = getToptryMoscowDateParts(new Date());

      if (now.hour !== schedule.hour || now.minute !== schedule.minute) return;
      if (catalogNightlySchedulerLastDateKey === now.dateKey) return;

      catalogNightlySchedulerLastDateKey = now.dateKey;

      const result = startCatalogNightlyPipeline({
        applySafe,
        trigger: `scheduler:${schedule.label}:msk`,
      });

      console.log("[toptry] catalog nightly scheduler tick", {
        dateKey: now.dateKey,
        timeMsk: schedule.label,
        result,
      });
    } catch (e) {
      console.error("[toptry] catalog nightly scheduler error", e?.stack || e);
    }
  };

  setInterval(tick, tickMs);
  setTimeout(tick, 5_000);
}

maybeStartCatalogNightlyScheduler();

app.get("/api/admin/catalog/nightly-pipeline/runs/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");

    const run = await prisma.catalogPipelineRun.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { startedAt: "asc" },
        },
      },
    });

    if (!run) return res.status(404).json({ error: "Pipeline run not found" });
    return res.json({ ok: true, run });
  } catch (e) {
    console.error("[toptry] catalog pipeline run read error", e);
    return res.status(500).json({ error: e?.message || String(e) });
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
