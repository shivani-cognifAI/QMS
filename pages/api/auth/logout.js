const { clearCookieHeader } = require('../../../lib/auth');

export default function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookieHeader());
  res.json({ message: 'Logged out' });
}
