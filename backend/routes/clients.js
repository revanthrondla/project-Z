const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// GET /api/clients
// Admin: all clients | Client: their own record | Candidate: their assigned client only
router.get('/', authenticate, injectTenantDb, (req, res) => {
  if (req.user.role === 'admin') {
    const clients = req.db.prepare(`
      SELECT c.*, COUNT(ca.id) as candidate_count
      FROM clients c
      LEFT JOIN candidates ca ON ca.client_id = c.id AND ca.status = 'active'
      GROUP BY c.id
      ORDER BY c.name
    `).all();
    return res.json(clients);
  }

  if (req.user.role === 'client') {
    const client = req.db.prepare(`
      SELECT c.*, COUNT(ca.id) as candidate_count
      FROM clients c
      LEFT JOIN candidates ca ON ca.client_id = c.id AND ca.status = 'active'
      WHERE c.id = ?
      GROUP BY c.id
    `).get(req.user.clientId);
    return res.json(client ? [client] : []);
  }

  // Candidate: only their assigned client
  if (req.user.role === 'candidate') {
    const cand = req.db.prepare('SELECT client_id FROM candidates WHERE id = ?').get(req.user.candidateId);
    if (!cand || !cand.client_id) return res.json([]);
    const client = req.db.prepare('SELECT id, name, contact_name, contact_email FROM clients WHERE id = ?').get(cand.client_id);
    return res.json(client ? [client] : []);
  }

  return res.status(403).json({ error: 'Access denied' });
});

// GET /api/clients/:id
// Admin: any | Client: own only | Candidate: their assigned client only
router.get('/:id', authenticate, injectTenantDb, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid client ID' });

  if (req.user.role === 'client' && req.user.clientId !== id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (req.user.role === 'candidate') {
    const cand = req.db.prepare('SELECT client_id FROM candidates WHERE id = ?').get(req.user.candidateId);
    if (!cand || cand.client_id !== id) return res.status(403).json({ error: 'Access denied' });
  }

  const client = req.db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

// POST /api/clients — Admin only
router.post('/', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { name, contact_name, contact_email, address, billing_currency } = req.body;
  if (!name) return res.status(400).json({ error: 'Client name is required' });

  const result = req.db.prepare(
    'INSERT INTO clients (name, contact_name, contact_email, address, billing_currency) VALUES (?, ?, ?, ?, ?)'
  ).run(name, contact_name || null, contact_email || null, address || null, billing_currency || 'USD');

  const newClient = req.db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(newClient);
});

// PUT /api/clients/:id — Admin only
router.put('/:id', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { name, contact_name, contact_email, address, billing_currency } = req.body;
  const client = req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  req.db.prepare(`
    UPDATE clients SET name = ?, contact_name = ?, contact_email = ?, address = ?, billing_currency = ?
    WHERE id = ?
  `).run(
    name || client.name,
    contact_name !== undefined ? contact_name : client.contact_name,
    contact_email !== undefined ? contact_email : client.contact_email,
    address !== undefined ? address : client.address,
    billing_currency || client.billing_currency,
    req.params.id
  );

  res.json(req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
});

// DELETE /api/clients/:id — Admin only
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const client = req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  req.db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ message: 'Client deleted successfully' });
});

module.exports = router;
