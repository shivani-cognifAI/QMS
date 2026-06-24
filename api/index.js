import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// ── Documents ──────────────────────────────────────────────────────────────
export const getDocuments  = (params) => api.get('/documents', { params }).then(r => r.data);
export const getDocumentTypesInUse = () => api.get('/documents/types-in-use').then(r => r.data);
export const getDocument   = (id)     => api.get(`/documents/${encodeURIComponent(id)}`).then(r => r.data);
export const createDocument= (data)   => api.post('/documents', data).then(r => r.data);
export const updateDocument= (id, data) => api.put(`/documents/${encodeURIComponent(id)}`, data).then(r => r.data);
export const deleteDocument= (id)     => api.delete(`/documents/${encodeURIComponent(id)}`).then(r => r.data);
export const getDocHistory = (id)     => api.get(`/documents/${encodeURIComponent(id)}/history`).then(r => r.data);

// ── Workflows ──────────────────────────────────────────────────────────────
export const getWorkflows       = (params) => api.get('/workflows', { params }).then(r => r.data);
export const getWorkflow        = (id)     => api.get(`/workflows/${id}`).then(r => r.data);
export const getDocWorkflow     = (docId)  => api.get(`/workflows/document/${encodeURIComponent(docId)}`).then(r => r.data);
export const submitWorkflow     = (data)   => api.post('/workflows', data).then(r => r.data);
export const approveStep        = (wfId, stepId, data) => api.post(`/workflows/${wfId}/steps/${stepId}/approve`, data).then(r => r.data);
export const rejectStep         = (wfId, stepId, data) => api.post(`/workflows/${wfId}/steps/${stepId}/reject`, data).then(r => r.data);
export const cancelWorkflow     = (id)     => api.delete(`/workflows/${id}`).then(r => r.data);
export const getPendingForUser  = (userId) => api.get(`/workflows/pending/${userId}`).then(r => r.data);

// ── CAPAs ──────────────────────────────────────────────────────────────────
export const getCapas   = (params) => api.get('/capas', { params }).then(r => r.data);
export const getCapa    = (id)     => api.get(`/capas/${encodeURIComponent(id)}`).then(r => r.data);
export const createCapa = (data)   => api.post('/capas', data).then(r => r.data);
export const updateCapa = (id, data) => api.put(`/capas/${encodeURIComponent(id)}`, data).then(r => r.data);
export const deleteCapa = (id)     => api.delete(`/capas/${encodeURIComponent(id)}`).then(r => r.data);
export const getNextCapaId = (type) => api.get(`/capas/next-id/${encodeURIComponent(type)}`).then(r => r.data);

// ── CAPA Approval Workflows ──────────────────────────────────────────────────
export const getCapaWorkflows      = (params) => api.get('/capa-workflows', { params }).then(r => r.data);
export const getCapaWorkflow       = (id)     => api.get(`/capa-workflows/${id}`).then(r => r.data);
export const getCapaRecordWorkflow = (capaId) => api.get(`/capa-workflows/capa/${encodeURIComponent(capaId)}`).then(r => r.data);
export const submitCapaWorkflow    = (data)   => api.post('/capa-workflows', data).then(r => r.data);
export const approveCapaStep       = (wfId, stepId, data) => api.post(`/capa-workflows/${wfId}/steps/${stepId}/approve`, data).then(r => r.data);
export const rejectCapaStep        = (wfId, stepId, data) => api.post(`/capa-workflows/${wfId}/steps/${stepId}/reject`, data).then(r => r.data);
export const cancelCapaWorkflow    = (id)     => api.delete(`/capa-workflows/${id}`).then(r => r.data);
export const getPendingCapasForUser= (userId) => api.get(`/capa-workflows/pending/${userId}`).then(r => r.data);

// ── CAPA Evidence Attachments ────────────────────────────────────────────────
export const getCapaFiles = (capaId) => api.get(`/files/capa/${encodeURIComponent(capaId)}`).then(r => r.data);
export const uploadCapaFile = (capaId, formData) => api.post(`/files/capa-upload/${encodeURIComponent(capaId)}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
export const createCapaAttachment = (capaId, data) => api.post(`/files/capa-create-document/${encodeURIComponent(capaId)}`, data).then(r => r.data);

// ── Users ──────────────────────────────────────────────────────────────────
export const getUsers   = ()       => api.get('/users').then(r => r.data);
export const createUser = (data)   => api.post('/users', data).then(r => r.data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data).then(r => r.data);
export const deleteUser = (id)     => api.delete(`/users/${id}`).then(r => r.data);

// ── Stats ──────────────────────────────────────────────────────────────────
export const getStats = () => api.get('/stats').then(r => r.data);

// ── Files ──────────────────────────────────────────────────────────────────
export const getDocFiles       = (docId)          => api.get(`/files/${encodeURIComponent(docId)}`).then(r => r.data);
export const uploadFile        = (docId, formData) => api.post(`/files/${encodeURIComponent(docId)}`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data);
export const checkFileChanged  = (fileId, formData) => api.post(`/files/check-changes/${fileId}`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data);
export const confirmFileChange = (fileId, formData) => api.post(`/files/confirm-change/${fileId}`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data);
export const dismissFileChange = (fileId, formData) => api.post(`/files/dismiss-change/${fileId}`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data);
export const downloadFile      = (fileId, name)    => api.get(`/files/download/${fileId}`, { responseType:'blob' }).then(r => {
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
});
export const fetchFileBytes    = (fileId)           => api.get(`/files/download/${fileId}`, { responseType:'arraybuffer' }).then(r => r.data);
export const fileViewUrl        = (fileId)           => `/api/files/view/${fileId}`;
export const fixPrimary        = (docId)           => api.post(`/files/fix-primary/${encodeURIComponent(docId)}`).then(r => r.data);
export const getWordContent    = (fileId)          => api.get(`/files/word-content/${fileId}`).then(r => r.data);
export const deleteFile        = (fileId)          => api.delete(`/files/${fileId}`).then(r => r.data);

// ── Access control ─────────────────────────────────────────────────────────
export const getDocAccess     = (docId)           => api.get(`/access/${encodeURIComponent(docId)}`).then(r => r.data);
export const grantAccess      = (docId, data)     => api.post(`/access/${encodeURIComponent(docId)}`, data).then(r => r.data);
export const revokeAccess     = (docId, userId)   => api.delete(`/access/${encodeURIComponent(docId)}/${userId}`).then(r => r.data);
export const checkAccess      = (docId, userId)   => api.get(`/access/check/${encodeURIComponent(docId)}/${userId}`).then(r => r.data);
export const updateSystemRole = (userId, role)    => api.put(`/access/users/${userId}/role`, { system_role: role }).then(r => r.data);

// ── Archive ────────────────────────────────────────────────────────────────
export const getArchive        = (params) => api.get('/archive', { params }).then(r => r.data);
export const getArchivedDoc    = (id)     => api.get(`/archive/${id}`).then(r => r.data);
export const getDocArchive     = (docId)  => api.get(`/archive/document/${encodeURIComponent(docId)}`).then(r => r.data);
export const deleteArchived    = (id)     => api.delete(`/archive/${id}`).then(r => r.data);

// ── Export ─────────────────────────────────────────────────────────────────
export const exportExcel = () => api.get('/export/excel', { responseType: 'blob' }).then(r => {
  const url = URL.createObjectURL(r.data);
  const a   = document.createElement('a');
  a.href    = url; a.download = 'QMS_DocControl_Export.xlsx'; a.click();
  URL.revokeObjectURL(url);
});
export const getPdfData = () => api.get('/export/pdf-data').then(r => r.data);

// ── Settings ───────────────────────────────────────────────────────────────
export const getSettings    = ()        => api.get('/settings').then(r => r.data);
export const setSetting     = (key, value) => api.put(`/settings/${key}`, { value }).then(r => r.data);
export const deleteSetting  = (key)     => api.delete(`/settings/${key}`).then(r => r.data);

// ── Created document attachments (rich-text supporting docs / evidence) ─────
export const createDocAttachment = (docId, data) => api.post(`/files/create-document/${encodeURIComponent(docId)}`, data).then(r => r.data);
export const updateDocAttachment = (fileId, data) => api.put(`/files/content/${fileId}`, data).then(r => r.data);

// ── Notifications ─────────────────────────────────────────────────────────
export const getNotifications      = (userId) => api.get(`/notifications/${userId}`).then(r => r.data);
export const getUnreadCount        = (userId) => api.get(`/notifications/${userId}/unread-count`).then(r => r.data);
export const markNotificationRead  = (id)     => api.put(`/notifications/${id}/read`).then(r => r.data);
export const markAllNotificationsRead = (userId) => api.put(`/notifications/${userId}/read-all`).then(r => r.data);
