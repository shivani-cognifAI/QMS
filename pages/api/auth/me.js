const { getUser } = require('../../../lib/auth');

export default function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, system_role: user.system_role });
}
