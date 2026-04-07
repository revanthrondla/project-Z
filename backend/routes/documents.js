const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// ── File storage ──────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../uploads/documents');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

// Allowed MIME types and their expected magic bytes (first few bytes)
const ALLOWED_TYPES = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],                // %PDF
  'application/msword': [0xD0, 0xCF, 0x11, 0xE0],              // OLE2 header
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    [0x50, 0x4B, 0x03, 0x04],                                  // PK (ZIP)
  'image/png':  [0x89, 0x50, 0x4E, 0x47],                      // PNG
  'image/jpeg': [0xFF, 0xD8, 0xFF],                             // JPEG
  'image/jpg':  [0xFF, 0xD8, 0xFF],                             // JPEG
  'text/plain': null,                                           // No magic bytes (text)
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB (reduced from 20 MB)
  fileFilter: (_req, file, cb) => {
    if (Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only PDF, Word, PNG, JPEG, and plain text files are allowed'));
  },
});

/** Verify file magic bytes match the declared MIME type */
function verifyFileMagicBytes(filePath, mimetype) {
  const magic = ALLOWED_TYPES[mimetype];
  if (!magic) return true; // text/plain — no magic bytes to check
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(magic.length);
    fs.readSync(fd, buf, 0, magic.length, 0);
    fs.closeSync(fd);
    return magic.every((byte, i) => buf[i] === byte);
  } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve which roles must sign for a given signature_type */
function resolveRequiredSigners(signatureType, signers) {
  // signers is an array like ['candidate'], ['candidate','client'], etc.
  if (signatureType === 'none') return '';
  return signers.join(',');
}

/** After a new signature is saved, recalculate document status */
function recalcDocumentStatus(db, documentId) {
  const doc = db.prepare('SELECT required_signers FROM documents WHERE id = ?').get(documentId);
  if (!doc) return;

  const required = doc.required_signers ? doc.required_signers.split(',') : [];
  if (required.length === 0) {
    db.prepare("UPDATE documents SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(documentId);
    return;
  }

  const sigs = db.prepare(
    "SELECT signer_role, status FROM document_signatures WHERE document_id = ?"
  ).all(documentId);

  const signedRoles = sigs.filter(s => s.status === 'signed').map(s => s.signer_role);
  const allSigned = required.every(r => signedRoles.includes(r));
  const anySigned = required.some(r => signedRoles.includes(r));

  const newStatus = allSigned ? 'completed' : anySigned ? 'partial' : 'pending';
  db.prepare('UPDATE documents SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newStatus, documentId);
}

/** Check if current user is allowed to access a document */
function canAccess(user, doc) {
  if (user.role === 'admin') return true;
  if (user.role === 'candidate' && doc.candidate_id === user.candidateId) return true;
  if (user.role === 'client' && doc.client_id === user.clientId) return true;
  return false;
}

// ── GET /api/documents — list documents visible to the current user ────────────
router.get('/', authenticate, injectTenantDb, (req, res) => {
  const { candidate_id, client_id, status } = req.query;
  const user = req.user;

  let sql = `
    SELECT d.*,
      u.name  AS uploaded_by_name,
      c.name  AS candidate_name,
      cl.name AS client_name,
      (SELECT COUNT(*) FROM document_signatures ds
        WHERE ds.document_id = d.id AND ds.status = 'signed') AS signed_count,
      (SELECT COUNT(*) FROM document_signatures ds
        WHERE ds.document_id = d.id) AS total_signers
    FROM documents d
    LEFT JOIN users      u  ON u.id  = d.uploaded_by
    LEFT JOIN candidates c  ON c.id  = d.candidate_id
    LEFT JOIN clients    cl ON cl.id = d.client_id
    WHERE 1=1
  `;
  const params = [];

  // Scope by role
  if (user.role === 'candidate') {
    sql += ' AND d.candidate_id = ?'; params.push(user.candidateId);
  } else if (user.role === 'client') {
    sql += ' AND d.client_id = ?'; params.push(user.clientId);
  } else {
    // admin: optional filters
    if (candidate_id) { sql += ' AND d.candidate_id = ?'; params.push(parseInt(candidate_id, 10)); }
    if (client_id)    { sql += ' AND d.client_id = ?';    params.push(parseInt(client_id, 10)); }
  }

  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.created_at DESC';

  const docs = req.db.prepare(sql).all(...params);
  res.json(docs);
});

// ── POST /api/documents — upload a new document ───────────────────────────────
router.post('/', authenticate, injectTenantDb, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });

  // Validate magic bytes to prevent MIME-type spoofing
  if (!verifyFileMagicBytes(req.file.path, req.file.mimetype)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'File content does not match its declared type. Upload rejected.' });
  }

  const {
    title, description,
    signature_type = 'none',
    required_signers = '',   // comma-separated: candidate,client,admin
    candidate_id, client_id,
  } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (title.length > 255) return res.status(400).json({ error: 'Title must be 255 characters or fewer' });
  if (description && description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });

  const user = req.user;

  // Candidates can only upload to their own profile
  let resolvedCandidateId = candidate_id || null;
  let resolvedClientId    = client_id    || null;

  if (user.role === 'candidate') {
    resolvedCandidateId = user.candidateId;
    resolvedClientId    = null;
  }

  // Validate signature_type
  const validTypes = ['none', 'single', 'two_way', 'three_way'];
  if (!validTypes.includes(signature_type)) {
    return res.status(400).json({ error: 'Invalid signature_type' });
  }

  // required_signers validation
  const signerList = required_signers
    ? required_signers.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const validRoles = ['candidate', 'client', 'admin'];
  for (const s of signerList) {
    if (!validRoles.includes(s)) {
      return res.status(400).json({ error: `Invalid signer role: ${s}` });
    }
  }

  // Enforce signer counts per type
  if (signature_type === 'single'    && signerList.length !== 1) return res.status(400).json({ error: 'single requires exactly 1 signer' });
  if (signature_type === 'two_way'   && signerList.length !== 2) return res.status(400).json({ error: 'two_way requires exactly 2 signers' });
  if (signature_type === 'three_way' && signerList.length !== 3) return res.status(400).json({ error: 'three_way requires exactly 3 signers' });

  const result = req.db.prepare(`
    INSERT INTO documents
      (title, description, file_name, file_path, file_size, mime_type,
       uploaded_by, candidate_id, client_id, signature_type, required_signers, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    title,
    description || null,
    req.file.originalname,
    req.file.filename,
    req.file.size,
    req.file.mimetype,
    user.id,
    resolvedCandidateId,
    resolvedClientId,
    signature_type,
    signerList.join(','),
    signature_type === 'none' ? 'completed' : 'pending',
  );

  const docId = result.lastInsertRowid;

  // Create pending signature records for each required signer
  if (signerList.length > 0) {
    const insertSig = req.db.prepare(`
      INSERT INTO document_signatures (document_id, signer_role, status)
      VALUES (?, ?, 'pending')
    `);
    for (const role of signerList) {
      insertSig.run(docId, role);
    }
  }

  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  res.status(201).json(doc);
});

// ── GET /api/documents/:id — document detail with signatures ──────────────────
router.get('/:id', authenticate, injectTenantDb, (req, res) => {
  const doc = req.db.prepare(`
    SELECT d.*,
      u.name  AS uploaded_by_name,
      c.name  AS candidate_name, c.email AS candidate_email,
      cl.name AS client_name,   cl.contact_email AS client_email
    FROM documents d
    LEFT JOIN users      u  ON u.id  = d.uploaded_by
    LEFT JOIN candidates c  ON c.id  = d.candidate_id
    LEFT JOIN clients    cl ON cl.id = d.client_id
    WHERE d.id = ?
  `).get(req.params.id);

  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canAccess(req.user, doc)) return res.status(403).json({ error: 'Access denied' });

  const signatures = req.db.prepare(`
    SELECT ds.*, u.name AS user_name, u.email AS user_email
    FROM document_signatures ds
    LEFT JOIN users u ON u.id = ds.signer_user_id
    WHERE ds.document_id = ?
    ORDER BY ds.id
  `).all(doc.id);

  res.json({ ...doc, signatures });
});

// ── GET /api/documents/:id/file — serve the actual file ──────────────────────
router.get('/:id/file', authenticate, injectTenantDb, (req, res) => {
  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canAccess(req.user, doc)) return res.status(403).json({ error: 'Access denied' });

  const filePath = path.join(UPLOAD_DIR, doc.file_path);
  // Guard against path traversal: verify the resolved path is inside UPLOAD_DIR
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) &&
      resolvedPath !== path.resolve(UPLOAD_DIR)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  // Sanitize filename for Content-Disposition to prevent header injection
  const safeFilename = (doc.file_name || 'document').replace(/["\r\n;]/g, '_');
  const allowedMimes = [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg', 'text/plain',
  ];
  const contentType = allowedMimes.includes(doc.mime_type) ? doc.mime_type : 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.sendFile(filePath);
});

// ── POST /api/documents/:id/sign — submit a signature ────────────────────────
router.post('/:id/sign', authenticate, injectTenantDb, (req, res) => {
  const { signature_data } = req.body;
  if (!signature_data) return res.status(400).json({ error: 'signature_data is required' });
  // Validate signature_data is a data-URL and within a reasonable size (max ~2MB base64)
  if (typeof signature_data !== 'string' || !signature_data.startsWith('data:image/')) {
    return res.status(400).json({ error: 'signature_data must be a valid image data URL' });
  }
  if (signature_data.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'Signature image is too large (max 2MB)' });
  }

  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'completed') return res.status(409).json({ error: 'Document is already fully signed' });
  if (doc.status === 'voided')    return res.status(400).json({ error: 'Document has been voided' });

  const user = req.user;

  // Determine signer role
  const roleMap = { admin: 'admin', candidate: 'candidate', client: 'client' };
  const signerRole = roleMap[user.role];
  if (!signerRole) return res.status(403).json({ error: 'Your role cannot sign documents' });

  // Check access
  if (!canAccess(user, doc)) return res.status(403).json({ error: 'Access denied' });

  // Find the pending signature slot for this role
  const sigSlot = req.db.prepare(`
    SELECT * FROM document_signatures
    WHERE document_id = ? AND signer_role = ? AND status = 'pending'
    LIMIT 1
  `).get(doc.id, signerRole);

  if (!sigSlot) {
    // Check if already signed
    const already = req.db.prepare(`
      SELECT * FROM document_signatures
      WHERE document_id = ? AND signer_role = ? AND status = 'signed'
    `).get(doc.id, signerRole);
    if (already) return res.status(409).json({ error: 'You have already signed this document' });
    return res.status(400).json({ error: 'Your role is not required to sign this document' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

  req.db.prepare(`
    UPDATE document_signatures
    SET signer_user_id = ?, signer_name = ?, signer_email = ?,
        signature_data = ?, signed_at = CURRENT_TIMESTAMP,
        status = 'signed', ip_address = ?
    WHERE id = ?
  `).run(user.id, user.name, user.email, signature_data, ip, sigSlot.id);

  recalcDocumentStatus(req.db, doc.id);

  const updated = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
  const signatures = req.db.prepare(
    'SELECT * FROM document_signatures WHERE document_id = ? ORDER BY id'
  ).all(doc.id);

  res.json({ message: 'Document signed successfully', document: updated, signatures });
});

// ── POST /api/documents/:id/reject — reject signing ──────────────────────────
router.post('/:id/reject', authenticate, injectTenantDb, (req, res) => {
  const { reason } = req.body;

  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.status === 'voided') return res.status(400).json({ error: 'Document already voided' });

  const user = req.user;
  const signerRole = user.role;

  if (!canAccess(user, doc)) return res.status(403).json({ error: 'Access denied' });

  const sigSlot = req.db.prepare(`
    SELECT * FROM document_signatures
    WHERE document_id = ? AND signer_role = ? AND status = 'pending'
    LIMIT 1
  `).get(doc.id, signerRole);

  if (!sigSlot) return res.status(400).json({ error: 'No pending signature slot for your role' });

  req.db.prepare(`
    UPDATE document_signatures
    SET signer_user_id = ?, signer_name = ?, status = 'rejected', signed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(user.id, user.name, sigSlot.id);

  // Void the document when anyone rejects
  req.db.prepare("UPDATE documents SET status='voided', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);

  const updatedDoc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
  res.json({ message: 'Document signing rejected', reason: reason || null, document: updatedDoc });
});

// ── DELETE /api/documents/:id — admin or uploader can delete ─────────────────
router.delete('/:id', authenticate, injectTenantDb, (req, res) => {
  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const user = req.user;
  if (user.role !== 'admin' && doc.uploaded_by !== user.id) {
    return res.status(403).json({ error: 'Only admin or the uploader can delete this document' });
  }

  // Delete physical file
  const filePath = path.join(UPLOAD_DIR, doc.file_path);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }

  req.db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.json({ message: 'Document deleted' });
});

// ── PATCH /api/documents/:id/void — admin can void a document ────────────────
router.patch('/:id/void', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  req.db.prepare("UPDATE documents SET status='voided', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
  res.json({ message: 'Document voided' });
});

// ── GET /api/documents/:id/audit — full audit trail ──────────────────────────
router.get('/:id/audit', authenticate, injectTenantDb, (req, res) => {
  const doc = req.db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canAccess(req.user, doc)) return res.status(403).json({ error: 'Access denied' });

  const signatures = req.db.prepare(`
    SELECT ds.*, u.name AS user_name, u.email AS user_email
    FROM document_signatures ds
    LEFT JOIN users u ON u.id = ds.signer_user_id
    WHERE ds.document_id = ?
    ORDER BY ds.created_at
  `).all(doc.id);

  res.json({
    document: doc,
    audit_trail: signatures.map(s => ({
      role:       s.signer_role,
      name:       s.signer_name || s.user_name || '—',
      email:      s.signer_email || s.user_email || '—',
      status:     s.status,
      signed_at:  s.signed_at,
      ip_address: s.ip_address,
    })),
  });
});

module.exports = router;
