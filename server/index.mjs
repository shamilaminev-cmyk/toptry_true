import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { ensureBucket, putDataUrl, getObjectStream } from './storage.mjs';
import { getPrisma, getPublicUserById } from './db.mjs';
import { authMiddleware, requireAuth, getAuthConfig, registerUser, loginUser, signSession } from './auth.mjs';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

const PORT = Number(process.env.API_PORT || 5174);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  // Server can still start (so the app boots), but AI endpoints will error.
  console.warn('[toptry] GEMINI_API_KEY is not set. AI endpoints will return 500.');
}

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(authMiddleware);
app.use(express.json({ limit: '20mb' }));
app.set('trust proxy', 1);


// Initialize optional infrastructure (MinIO bucket, Prisma)
(async () => {
  try {
    await ensureBucket();
  } catch (e) {
    console.warn('[toptry] MinIO not available (will run without object storage):', e?.message || e);
  }
  try {
    if (process.env.DATABASE_URL) {
      const p = getPrisma();
      await prisma.$queryRaw`SELECT 1`;
    }
  } catch (e) {
    console.warn('[toptry] Database not available (will run without DB):', e?.message || e);
  }
})();

// Basic DB connectivity check (optional)
if (!process.env.DATABASE_URL) {
  console.warn('[toptry] DATABASE_URL is not set. DB persistence is disabled.');
}

/**
 * Convert a remote image URL or a data URL to base64 (without data: prefix).
 * This runs on the server, so CORS is not a problem.
 */
async function imageToBase64(input) {
  if (typeof input !== 'string') throw new Error('Invalid image input');
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',');
    if (comma === -1) throw new Error('Invalid data URL');
    const meta = input.slice(0, comma);
    const mimeType = meta.match(/data:([^;]+);base64/)
      ? meta.match(/data:([^;]+);base64/)[1]
      : 'image/png';
    const base64 = input.slice(comma + 1);
    return { base64, mimeType };
  }

  const res = await fetch(input);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType: contentType };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ---------- AUTH ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const { email, password, username } = req.body || {};
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'email, password, username are required' });
    }
    const user = await registerUser({ email, password, username });
    const token = signSession(user);
    const { cookieName, cookieOptions } = getAuthConfig();
    res.cookie(cookieName, token, cookieOptions);
    res.json({ user });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('Unique constraint')) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'emailOrUsername and password are required' });
    }
    const user = await loginUser({ emailOrUsername, password });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signSession(user);
    const { cookieName, cookieOptions } = getAuthConfig();
    res.cookie(cookieName, token, cookieOptions);
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const { cookieName } = getAuthConfig();
  res.clearCookie(cookieName, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    if (!req.auth?.userId) return res.json({ user: null });
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const user = await p.user.findUnique({
      where: { id: req.auth.userId },
      select: { id: true, email: true, username: true, avatarUrl: true, isPublic: true, createdAt: true },
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
app.get('/media/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const stream = await getObjectStream(key);
    if (!stream) return res.status(404).send('Storage not configured');
    // Content-Type is stored in metadata but MinIO SDK doesn't return it in getObject.
    // We rely on file extension as a good enough fallback.
    if (key.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
    else if (key.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
    else res.setHeader('Content-Type', 'image/jpeg');
    stream.on('error', (e) => {
      console.error('[toptry] media stream error', e);
      res.status(404).end();
    });
    stream.pipe(res);
  } catch (e) {
    res.status(500).send(e?.message || 'media error');
  }
});

/**
 * POST /api/tryon
 * Body: { selfieDataUrl: string, itemImageUrls: string[], aspectRatio?: "3:4" | "1:1" | ... }
 * Returns: { imageDataUrl: string }
 */
app.post('/api/tryon', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    const { selfieDataUrl, itemImageUrls, aspectRatio } = req.body || {};
    if (!selfieDataUrl || !Array.isArray(itemImageUrls) || itemImageUrls.length === 0) {
      return res.status(400).json({ error: 'selfieDataUrl and itemImageUrls[] are required' });
    }
    if (itemImageUrls.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 items per try-on in MVP' });
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
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          { inlineData: { data: selfie.base64, mimeType: selfie.mimeType } },
          ...itemParts,
          { text: prompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio || '3:4',
          imageSize: '1K',
        },
      },
    });

    let imageDataUrl = '';
    const parts = response?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mt = part.inlineData.mimeType || 'image/png';
        imageDataUrl = `data:${mt};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!imageDataUrl) {
      return res.status(502).json({ error: 'Gemini did not return an image' });
    }

    res.json({ imageDataUrl });
  } catch (err) {
    console.error('[toptry] /api/tryon error', err);
    res.status(500).json({ error: err?.message || 'Unknown server error' });
  }
});

/**
 * POST /api/wardrobe/extract
 * Body: { photoDataUrl: string, hintCategory?: string, hintGender?: string }
 * Returns: { cutoutDataUrl: string, attributes: { title, category, gender, tags[], color, material } }
 */
app.post('/api/wardrobe/extract', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }
    const { photoDataUrl, hintCategory, hintGender } = req.body || {};
    if (!photoDataUrl) return res.status(400).json({ error: 'photoDataUrl is required' });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const photo = await imageToBase64(photoDataUrl);

    // 1) Generate cutout image (transparent background preferred)
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
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          { inlineData: { data: photo.base64, mimeType: photo.mimeType } },
          { text: cutoutPrompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
      },
    });

    let cutoutDataUrl = '';
    const cutoutParts = cutoutResp?.candidates?.[0]?.content?.parts || [];
    for (const part of cutoutParts) {
      if (part.inlineData?.data) {
        const mt = part.inlineData.mimeType || 'image/png';
        cutoutDataUrl = `data:${mt};base64,${part.inlineData.data}`;
        break;
      }
    }
    if (!cutoutDataUrl) return res.status(502).json({ error: 'Gemini did not return cutout image' });

    // 2) Extract attributes as strict JSON
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
- hintCategory: ${hintCategory || 'none'}
- hintGender: ${hintGender || 'none'}`;

    const attrResp = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
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
      .join('')
      .trim();

    let attributes = null;
    try {
      attributes = JSON.parse(attrText);
    } catch {
      // Fallback heuristic if model returned extra text
      const first = attrText.indexOf('{');
      const last = attrText.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        attributes = JSON.parse(attrText.slice(first, last + 1));
      }
    }

    if (!attributes) {
      attributes = {
        title: 'Моя вещь',
        category: hintCategory || 'Верх',
        gender: hintGender || 'UNISEX',
        tags: [],
        color: 'неизвестно',
        material: 'неизвестно',
      };
    }

    res.json({ cutoutDataUrl, attributes });
  } catch (err) {
    console.error('[toptry] /api/wardrobe/extract error', err);
    res.status(500).json({ error: err?.message || 'Unknown server error' });
  }
});

/**
 * POST /api/wardrobe/save
 * Body: { title, category, gender, tags?, color?, material?, notes?, originalDataUrl, cutoutDataUrl } (auth required)
 * Returns: { item } where item has URLs served via /media/... (if MinIO configured), else data URLs.
 */
app.post('/api/wardrobe/save', requireAuth, async (req, res) => {
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
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const p = getPrisma();
    const storedOriginal = await putDataUrl(originalDataUrl, `users/${userId}/original`);
    const storedCutout = await putDataUrl(cutoutDataUrl, `users/${userId}/cutouts`);

    // If MinIO is not configured, fallback to keeping data URLs.
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

    // Return an object shaped like WardrobeItem/Product for the frontend.
    const item = {
      id,
      title,
      price: 0,
      currency: 'RUB',
      gender,
      category,
      sizes: ['ONE'],
      images: [cutoutRef],
      storeId: 'user-upload',
      availability: true,
      isCatalog: false,
      userId,
      addedAt: new Date().toISOString(),
      sourceType: 'own',
      originalImage: originalRef,
      cutoutImage: cutoutRef,
      tags: Array.isArray(tags) ? tags : [],
      color: color || undefined,
      material: material || undefined,
      notes: notes || undefined,
    };

    res.json({ item });
  } catch (err) {
    console.error('[toptry] /api/wardrobe/save error', err);
    res.status(500).json({ error: err?.message || 'Unknown server error' });
  }
});

/**
 * GET /api/wardrobe/list (auth required)
 */
app.get('/api/wardrobe/list', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const p = getPrisma();
    if (!p) return res.json({ items: [] });
    const rows = await p.wardrobeItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      price: 0,
      currency: 'RUB',
      gender: r.gender,
      category: r.category,
      sizes: ['ONE'],
      images: [`/media/${r.cutoutKey}`],
      storeId: 'user-upload',
      availability: true,
      isCatalog: false,
      userId: r.userId,
      addedAt: r.createdAt.toISOString(),
      sourceType: 'own',
      originalImage: `/media/${r.originalKey}`,
      cutoutImage: `/media/${r.cutoutKey}`,
      tags: r.tags || [],
      color: r.color || undefined,
      material: r.material || undefined,
      notes: r.notes || undefined,
    }));

    res.json({ items });
  } catch (err) {
    console.error('[toptry] /api/wardrobe/list error', err);
    res.status(500).json({ error: err?.message || 'Unknown server error' });
  }
});

// ---------- LOOKS / SOCIAL ----------
async function generateTryOnImageDataUrl({ selfieDataUrl, itemImageUrls, aspectRatio }) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server');
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
Style: premium e-commerce, professional lighting, clean neutral background.
Avoid brand logos and text. Front view.`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts: [{ inlineData: { data: selfie.base64, mimeType: selfie.mimeType } }, ...itemParts, { text: prompt }] },
    config: { imageConfig: { aspectRatio: aspectRatio || '3:4', imageSize: '1K' } },
  });
  let imageDataUrl = '';
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mt = part.inlineData.mimeType || 'image/png';
      imageDataUrl = `data:${mt};base64,${part.inlineData.data}`;
      break;
    }
  }
  if (!imageDataUrl) throw new Error('Gemini did not return an image');
  return imageDataUrl;
}

async function generateLookAiDescription({ tryOnImageDataUrl, itemsSummary }) {
  if (!GEMINI_API_KEY) return '';
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const img = await imageToBase64(tryOnImageDataUrl);
    const prompt = `Ты — стилист. Опиши образ на фото в 1-2 предложениях по-русски: настроение, куда подходит, ключевые детали. Без упоминания брендов.\nСписок вещей: ${itemsSummary}`;
    const resp = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: { parts: [{ inlineData: { data: img.base64, mimeType: img.mimeType } }, { text: prompt }] },
    });
    return (resp?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  } catch {
    return '';
  }
}

app.post('/api/looks/create', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const userId = req.auth.userId;
    const { selfieDataUrl, itemImageUrls, itemIds, title, userDescription, buyLinks, aspectRatio, priceBuyNowRUB } = req.body || {};
    if (!selfieDataUrl || !Array.isArray(itemImageUrls) || itemImageUrls.length === 0) {
      return res.status(400).json({ error: 'selfieDataUrl and itemImageUrls[] are required' });
    }
    if (!Array.isArray(itemIds) || itemIds.length !== itemImageUrls.length) {
      return res.status(400).json({ error: 'itemIds[] must be provided and match itemImageUrls[] length' });
    }
    if (itemImageUrls.length > 5) return res.status(400).json({ error: 'Maximum 5 items per look in MVP' });

    const imageDataUrl = await generateTryOnImageDataUrl({ selfieDataUrl, itemImageUrls, aspectRatio });
    const stored = await putDataUrl(imageDataUrl, `users/${userId}/looks`);
    if (!stored) return res.status(500).json({ error: 'Object storage is not configured' });
    const resultImageKey = stored.key;

    const itemsSummary = itemIds.join(', ');
    const aiDescription = await generateLookAiDescription({ tryOnImageDataUrl: imageDataUrl, itemsSummary });

    const id = `l-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const look = await p.look.create({
      data: {
        id,
        userId,
        title: String(title || `Образ (${itemIds.length} вещей)`),
        itemIds: itemIds.map(String),
        resultImageKey,
        userDescription: userDescription ? String(userDescription) : null,
        aiDescription: aiDescription || null,
        priceBuyNowRUB: Number.isFinite(+priceBuyNowRUB) ? Math.max(0, Math.round(+priceBuyNowRUB)) : 0,
        buyLinks: Array.isArray(buyLinks) ? buyLinks.map(String) : [],
      },
      select: { id: true, userId: true, title: true, itemIds: true, resultImageKey: true, isPublic: true, userDescription: true, aiDescription: true, priceBuyNowRUB: true, buyLinks: true, likesCount: true, commentsCount: true, createdAt: true },
    });

    const author = await getPublicUserById(userId);
    res.json({
      look: {
        id: look.id,
        userId: look.userId,
        title: look.title,
        items: look.itemIds,
        resultImageUrl: `/media/${look.resultImageKey}`,
        isPublic: look.isPublic,
        likes: look.likesCount,
        comments: look.commentsCount,
        createdAt: look.createdAt,
        authorName: author?.username || 'user',
        authorAvatar: author?.avatarUrl || '',
        userDescription: look.userDescription || '',
        aiDescription: look.aiDescription || '',
        priceBuyNowRUB: look.priceBuyNowRUB,
        buyLinks: look.buyLinks || [],
      },
    });
  } catch (e) {
    console.error('[toptry] /api/looks/create error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/looks/my', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.json({ looks: [] });
    const userId = req.auth.userId;
    const rows = await p.look.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const author = await getPublicUserById(userId);
    const looks = rows.map((look) => ({
      id: look.id,
      userId: look.userId,
      title: look.title,
      items: look.itemIds,
      resultImageUrl: look.resultImageKey ? `/media/${look.resultImageKey}` : '',
      isPublic: look.isPublic,
      likes: look.likesCount,
      comments: look.commentsCount,
      createdAt: look.createdAt,
      authorName: author?.username || 'user',
      authorAvatar: author?.avatarUrl || '',
      userDescription: look.userDescription || '',
      aiDescription: look.aiDescription || '',
      priceBuyNowRUB: look.priceBuyNowRUB,
      buyLinks: look.buyLinks || [],
    }));
    res.json({ looks });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/looks/public', async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.json({ looks: [] });
    const sort = String(req.query.sort || 'trending');
    const orderBy = sort === 'new' ? { createdAt: 'desc' } : { likesCount: 'desc' };
    const rows = await p.look.findMany({ where: { isPublic: true }, orderBy, take: 50 });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await p.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, avatarUrl: true, isPublic: true } });
    const map = new Map(users.map((u) => [u.id, u]));
    const looks = rows.map((look) => {
      const a = map.get(look.userId);
      return {
        id: look.id,
        userId: look.userId,
        title: look.title,
        items: look.itemIds,
        resultImageUrl: look.resultImageKey ? `/media/${look.resultImageKey}` : '',
        isPublic: look.isPublic,
        likes: look.likesCount,
        comments: look.commentsCount,
        createdAt: look.createdAt,
        authorName: a?.username || 'user',
        authorAvatar: a?.avatarUrl || '',
        userDescription: look.userDescription || '',
        aiDescription: look.aiDescription || '',
        priceBuyNowRUB: look.priceBuyNowRUB,
        buyLinks: look.buyLinks || [],
      };
    });
    res.json({ looks });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/looks/:id', async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const id = String(req.params.id);
    const look = await p.look.findUnique({ where: { id } });
    if (!look) return res.status(404).json({ error: 'Not found' });
    if (!look.isPublic && req.auth?.userId !== look.userId) return res.status(403).json({ error: 'Forbidden' });
    const author = await getPublicUserById(look.userId);
    res.json({
      look: {
        id: look.id,
        userId: look.userId,
        title: look.title,
        items: look.itemIds,
        resultImageUrl: look.resultImageKey ? `/media/${look.resultImageKey}` : '',
        isPublic: look.isPublic,
        likes: look.likesCount,
        comments: look.commentsCount,
        createdAt: look.createdAt,
        authorName: author?.username || 'user',
        authorAvatar: author?.avatarUrl || '',
        userDescription: look.userDescription || '',
        aiDescription: look.aiDescription || '',
        priceBuyNowRUB: look.priceBuyNowRUB,
        buyLinks: look.buyLinks || [],
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch('/api/looks/:id/visibility', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const id = String(req.params.id);
    const { isPublic } = req.body || {};
    const look = await p.look.findUnique({ where: { id } });
    if (!look) return res.status(404).json({ error: 'Not found' });
    if (look.userId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
    const updated = await p.look.update({ where: { id }, data: { isPublic: !!isPublic } });
    res.json({ ok: true, isPublic: updated.isPublic });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/looks/:id/like', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const lookId = String(req.params.id);
    const userId = req.auth.userId;
    const existing = await p.like.findUnique({ where: { userId_lookId: { userId, lookId } } }).catch(() => null);
    let liked = false;
    if (existing) {
      await p.like.delete({ where: { id: existing.id } });
      await p.look.update({ where: { id: lookId }, data: { likesCount: { decrement: 1 } } });
      liked = false;
    } else {
      await p.like.create({ data: { id: `like-${Date.now()}-${Math.random().toString(16).slice(2)}`, userId, lookId } });
      await p.look.update({ where: { id: lookId }, data: { likesCount: { increment: 1 } } });
      liked = true;
    }
    const look = await p.look.findUnique({ where: { id: lookId }, select: { likesCount: true } });
    res.json({ liked, likes: look?.likesCount || 0 });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/looks/:id/comments', async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.json({ comments: [] });
    const lookId = String(req.params.id);
    const rows = await p.comment.findMany({ where: { lookId }, orderBy: { createdAt: 'asc' }, take: 200 });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await p.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, avatarUrl: true } });
    const map = new Map(users.map((u) => [u.id, u]));
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        lookId: c.lookId,
        userId: c.userId,
        text: c.text,
        createdAt: c.createdAt,
        authorName: map.get(c.userId)?.username || 'user',
        authorAvatar: map.get(c.userId)?.avatarUrl || '',
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/looks/:id/comments', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const lookId = String(req.params.id);
    const userId = req.auth.userId;
    const { text } = req.body || {};
    if (!text || String(text).trim().length < 1) return res.status(400).json({ error: 'text is required' });
    const id = `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await p.comment.create({ data: { id, lookId, userId, text: String(text).trim() } });
    await p.look.update({ where: { id: lookId }, data: { commentsCount: { increment: 1 } } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.status(500).json({ error: 'Database is not configured' });
    const followingId = String(req.params.id);
    const followerId = req.auth.userId;
    if (followingId === followerId) return res.status(400).json({ error: 'Cannot follow yourself' });
    const existing = await p.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } }).catch(() => null);
    let following = false;
    if (existing) {
      await p.follow.delete({ where: { id: existing.id } });
      following = false;
    } else {
      await p.follow.create({ data: { id: `f-${Date.now()}-${Math.random().toString(16).slice(2)}`, followerId, followingId } });
      following = true;
    }
    res.json({ following });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/feed/following', requireAuth, async (req, res) => {
  try {
    const p = getPrisma();
    if (!p) return res.json({ looks: [] });
    const followerId = req.auth.userId;
    const follows = await p.follow.findMany({ where: { followerId }, select: { followingId: true } });
    const ids = follows.map((f) => f.followingId);
    if (!ids.length) return res.json({ looks: [] });
    const rows = await p.look.findMany({ where: { isPublic: true, userId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const users = await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatarUrl: true } });
    const map = new Map(users.map((u) => [u.id, u]));
    res.json({
      looks: rows.map((look) => ({
        id: look.id,
        userId: look.userId,
        title: look.title,
        items: look.itemIds,
        resultImageUrl: look.resultImageKey ? `/media/${look.resultImageKey}` : '',
        isPublic: look.isPublic,
        likes: look.likesCount,
        comments: look.commentsCount,
        createdAt: look.createdAt,
        authorName: map.get(look.userId)?.username || 'user',
        authorAvatar: map.get(look.userId)?.avatarUrl || '',
        userDescription: look.userDescription || '',
        aiDescription: look.aiDescription || '',
        priceBuyNowRUB: look.priceBuyNowRUB,
        buyLinks: look.buyLinks || [],
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "toptry-api" });
});
app.listen(PORT, () => {
  console.log(`[toptry] AI server running on http://localhost:${PORT}`);
});
process.on("SIGINT", async () => { await prisma.$disconnect(); process.exit(0); });
process.on("SIGTERM", async () => { await prisma.$disconnect(); process.exit(0); });
