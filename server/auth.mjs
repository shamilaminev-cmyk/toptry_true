import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPrisma } from './db.mjs';

const JWT_SECRET = process.env.JWT_SECRET || '';
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'toptry_session';

export function getAuthConfig() {
  return {
    jwtSecret: JWT_SECRET,
    cookieName: COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: (process.env.NODE_ENV !== 'development'), // true on staging/prod (HTTPS)
      path: '/',
      maxAge: 60 * 60 * 24 * 14, // 14 days
    },
  };
}

export function requireJwtSecret() {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
}

export function signSession(user) {
  requireJwtSecret();
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '14d' }
  );
}

export function parseSessionToken(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, _res, next) {
  const { cookieName } = getAuthConfig();
  const token = req.cookies?.[cookieName];
  const payload = parseSessionToken(token);
  req.auth = payload ? { userId: payload.sub } : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.auth?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export async function registerUser({ email, password, username }) {
  const p = getPrisma();
  if (!p) throw new Error('Database is not configured');
  requireJwtSecret();

  const passwordHash = await bcrypt.hash(String(password), 10);
  const id = `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await p.user.create({
    data: {
      id,
      email: String(email).toLowerCase(),
      username: String(username),
      passwordHash,
      isPublic: true,
    },
    select: { id: true, email: true, username: true, avatarUrl: true, isPublic: true, createdAt: true },
  });
  return user;
}

export async function loginUser({ emailOrUsername, password }) {
  const p = getPrisma();
  if (!p) throw new Error('Database is not configured');
  requireJwtSecret();

  const q = String(emailOrUsername).toLowerCase();
  const user = await p.user.findFirst({
    where: {
      OR: [{ email: q }, { username: String(emailOrUsername) }],
    },
    select: { id: true, email: true, username: true, passwordHash: true, avatarUrl: true, isPublic: true, createdAt: true },
  });
  if (!user) return null;
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}
