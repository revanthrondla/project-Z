const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// GET /api/clients
// Admin: all clients | Client: their own record | Candidate: their assigned client only
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const result = await req.db.query(`
        SELECT c.*, COUNT(ca.id) as candidate_count
        FROM clients c
        LEFT JOIN employees ca ON ca.client_id = c.id AND ca.status = 'active'
        GROUP BY c.id
        ORDER BY c.name
      `);
      return res.json(result.rows);
    }

    if (req.user.role === 'client') {
      const result = await req.db.query(`
        SELECT c.*, COUNT(ca.id) as candidate_count
        FROM clients c
        LEFT JOIN employees ca ON ca.client_id = c.id AND ca.status = 'active'
        WHERE c.id = $1
        GROUP BY c.id
      `, [req.user.clientId]);
      const client = result.rows[0];
      return res.json(client ? [client] : []);
    }

    // Candidate: only their assigned client
    if (req.user.role === 'candidate') {
      const candResult = await req.db.query('SELECT client_id FROM employees WHERE id = $1', [req.user.employeeId]);
      const cand = candResult.rows[0];
      if (!cand || !cand.client_id) return res.json([]);
      const clientResult = await req.db.query('SELECT id, name, contact_name, contact_email FROM clients WHERE id = $1', [cand.client_id]);
      const client = clientResult.rows[0];
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
      const candResult = await req.db.query('SELECT client_id FROM employees WHERE id = $1', [req.user.employeeId]);
      const cand = candResult.rows[0];
      if (!cand || cand.client_id !== id) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await req.db.query('SELECT * FROM clients WHERE id = $1', [id]);
    const client = result.rows[0];
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

    const result = await req.db.query(
      'INSERT INTO clients (name, contact_name, contact_email, address, billing_currency) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, contact_name || null, contact_email || null, address || null, billing_currency || 'USD']
    );

    const newId = result.rows[0].id;
    const newClientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [newId]);
    const newClient = newClientResult.rows[0];
    res.status(201).json(newClient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id — Admin only
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { name, contact_name, contact_email, address, billing_currency } = req.body;
    const clientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await req.db.query(`
      UPDATE clients SET name = $1, contact_name = $2, contact_email = $3, address = $4, billing_currency = $5
      WHERE id = $6
    `, [
      name || client.name,
      contact_name !== undefined ? contact_name : client.contact_name,
      contact_email !== undefined ? contact_email : client.contact_email,
      address !== undefined ? address : client.address,
      billing_currency || client.billing_currency,
      req.params.id
    ]);

    const updatedResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    res.json(updatedResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id — Admin only
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const clientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await req.db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ message: 'Client deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
