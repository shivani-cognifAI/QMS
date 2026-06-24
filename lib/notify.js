/**
 * createNotification — insert a notification row for a user.
 * db must already be an open CompatDb instance (call getDb() before this).
 */
function createNotification(db, { userId, type, title, message, link, createdBy }) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, type || 'general', title, message || null, link || null, createdBy || 'System');
  } catch (err) {
    console.error('[notify] Failed to create notification:', err.message);
  }
}

module.exports = { createNotification };
