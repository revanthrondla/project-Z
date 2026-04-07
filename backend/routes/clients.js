const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// GET /api/clients
// Admin: all clients | Client: their own record | Candidate: their assigned client only
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const clients = await req.db.prepare(`
        SELECT c.*, COUNT(ca.id) as candidate_count
        FROM clients c
        LEFT JOIN candidates ca ON ca.client_id = c.id AND ca.status = 'active'
        GROUP BY c.id
        ORDER BY c.name
      `).all();
      return res.json(clients);
    }

    if (req.user.role === 'client') {
      const client = await req.db.prepare(`
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
      const cand = await req.db.prepare('SELECT client_id FROM candidates WHERE id = ?').get(req.user.candidateId);
      if (!cand || !cand.client_id) return res.json([]);
      const client = await req.db.prepare('SELECT id, name, contact_name, contact_email FROM clients WHERE id = ?').get(cand.client_id);
      return res.json(client ? [client] : []);
    }

    return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id
// Admin: any | Client: own only | Candidate: their assigned client only
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid client ID' });

    if (req.user.role === 'client' && req.user.clientId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'candidate') {
      const cand = await req.db.prepare('SELECT client_id FROM candidates WHERE id = ?').get(req.user.candidateId);
      if (!cand || cand.client_id !== id) return res.status(403).json({ error: 'Access denied' });
    }

    const client = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients — Admin only
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { name, contact_name, contact_email, address, billing_currency } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });

    const result = await req.db.prepare(
      'INSERT INTO clients (name, contact_name, contact_email, address, billing_currency) VALUES (?, ?, ?, ?, ?)'
    ).run(name, contact_name || null, contact_email || null, address || null, billing_currency || 'USD');

    const newClient = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newClient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id — Admin only
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { name, contact_name, contact_email, address, billing_currency } = req.body;
    const client = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await req.db.prepare(`
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

    res.json(await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id — Admin only
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const client = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await req.db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ message: 'Client deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
