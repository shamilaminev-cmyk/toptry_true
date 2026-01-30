// server/auth.mjs
import jwt from 'jsonwebtoken';

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'toptry_session';

function isTrue(v) {
  return String(v || '').toLowerCase() === 'true' || String(v || '') === '1';
}

export function getAuthConfig() {
  const secure = isTrue(process.env.COOKIE_SECURE) || process.env.NODE_ENV === 'production';

  return {
    cookieName: COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      secure,
      // ✅ критично для Chromium/Яндекс на XHR: SameSite=None требует Secure=true
      sameSite: secure ? 'none' : 'lax',
      path: '/',
      maxAge: 20 * 60 * 1000, // 20 minutes
    },
  };
}

export function signSession(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');

  // keep payload small
  const payload = {
    sub: user.id,
    username: user.username,
    email: user.email,
  };

  // 20 minutes
  return jwt.sign(payload, secret, { expiresIn: '20m' });
}

export function authMiddleware(req, _res, next) {
  try {
    const { cookieName } = getAuthConfig();
    const token = req.cookies?.[cookieName];
    if (!token) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret) return next();

    const decoded = jwt.verify(token, secret);
    req.auth = { userId: decoded?.sub };
    return next();
  } catch (_e) {
    // invalid/expired token — treat as unauthenticated
    return next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.auth?.userId) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}
