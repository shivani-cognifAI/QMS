const jwt = require('jsonwebtoken');

const SECRET = process.env.AUTH_SECRET || 'qms_dev_secret_change_in_prod_2024';
const COOKIE = 'qms_session';
const WEIGHT = { viewer: 1, editor: 2, admin: 3 };

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

function getTokenFromReq(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

function getUser(req) {
  const token = getTokenFromReq(req);
  if (!token) return null;
  return verifyToken(token);
}

function setCookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`;
}

function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

// Wraps an API handler, injects req.user, enforces minimum role if given
function requireAuth(handler, { role } = {}) {
  return async function (req, res) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (role && (WEIGHT[user.system_role] || 0) < (WEIGHT[role] || 0)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.user = user;
    return handler(req, res);
  };
}

module.exports = { signToken, verifyToken, getUser, setCookieHeader, clearCookieHeader, requireAuth };
