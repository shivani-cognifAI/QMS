const DEFAULT_DOCUMENT_TYPES = ['SOP', 'Policy', 'Evidence', 'Work Instruction', 'Form/Template', 'Record'];

function getDocumentTypes(db) {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key='document_types'`).get();
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return DEFAULT_DOCUMENT_TYPES;
}

module.exports = { DEFAULT_DOCUMENT_TYPES, getDocumentTypes };
