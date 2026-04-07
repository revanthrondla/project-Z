/**
 * Integration tests — routes/timeEntries.js
 *
 * Covers:
 *   POST /  — field validation (hours > 24, hours = 0, bad date, duplicate date → 409)
 *             candidate creates own entry, admin creates for any candidate
 *   PUT /:id  — candidate cannot edit approved entry (400)
 *               admin can approve/reject and notification is created
 *               candidate cannot edit another candidate's entry (403)
 *   POST /:id/client-approve — client can approve their candidate's admin-approved entry
 *                              client cannot approve entries belonging to another client
 *   DELETE /:id — candidate can delete own pending entry; cannot delete approved entry
 */
'use strict';

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');

const { createTestDb, seedTenantData } = require('../helpers/db');
const {
  makeAdminToken,
  makeCandidateToken,
  makeClientToken,
} = require('../helpers/tokens');

// ── Module mocks ──────────────────────────────────────────────────────────────
let mockTenantDb;
const mockGetTenantDb = jest.fn(() => mockTenantDb);

jest.mock('../../database', () => ({
  get db() { return mockTenantDb; },
  getTenantDb: (...args) => mockGetTenantDb(...args),
}));

// ── App factory ───────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/time-entries', require('../../routes/timeEntries'));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
let app, ids;

function insertEntry(db, candidateId, { date = '2025-03-10', hours = 8, status = 'pending' } = {}) {
  const r = db.prepare(
    `INSERT INTO time_entries (candidate_id, date, hours, status) VALUES (?, ?, ?, ?)`
  ).run(candidateId, date, hours, status);
  return r.lastInsertRowid;
}

beforeAll(() => {
  mockTenantDb = createTestDb();
  ids       = seedTenantData(mockTenantDb);
  app       = buildApp();
});

afterEach(() => {
  mockGetTenantDb.mockClear();
  mockTenantDb.exec('DELETE FROM notifications');
  mockTenantDb.exec('DELETE FROM time_entries');
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST / — create time entry
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST / — create time entry', () => {
  describe('validation', () => {
    it('returns 400 when hours > 24', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '2025-03-10', hours: 25 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/hours must be between/i);
    });

    it('returns 400 when hours = 0 (caught by falsy check)', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '2025-03-10', hours: 0 });

      // hours=0 is falsy, caught by "date and hours are required" check
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns 400 when hours is negative', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '2025-03-10', hours: -1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when date is missing', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, hours: 8 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/date/i);
    });

    it('returns 400 for a badly formatted date (not YYYY-MM-DD)', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '10/03/2025', hours: 8 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/i);
    });

    it('returns 409 when a duplicate date entry exists for the same candidate', async () => {
      insertEntry(mockTenantDb, ids.cand1Id, { date: '2025-03-10' });

      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '2025-03-10', hours: 4 });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('allows two candidates to log on the same date (no conflict)', async () => {
      const token = makeAdminToken({ id: ids.adminId });

      await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand1Id, date: '2025-03-11', hours: 8 });

      const res = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand2Id, date: '2025-03-11', hours: 8 });

      expect(res.status).toBe(201);
    });
  });

  describe('role behaviour', () => {
    it('candidate creates their own entry (candidateId taken from JWT)', async () => {
      const token = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2025-03-12', hours: 7.5, description: 'API work' });

      expect(res.status).toBe(201);
      expect(res.body.candidate_id).toBe(ids.cand1Id);
      expect(res.body.hours).toBe(7.5);
      expect(res.body.status).toBe('pending');
    });

    it('admin creates an entry for a specific candidate', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ candidate_id: ids.cand2Id, date: '2025-03-13', hours: 6 });

      expect(res.status).toBe(201);
      expect(res.body.candidate_id).toBe(ids.cand2Id);
    });

    it('returns 400 when admin submits without candidate_id', async () => {
      const token = makeAdminToken({ id: ids.adminId });
      const res   = await request(app)
        .post('/api/time-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2025-03-14', hours: 4 }); // missing candidate_id

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/candidate/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /:id — update / approve / reject
// ═══════════════════════════════════════════════════════════════════════════════

describe('PUT /:id — approval flow', () => {
  it('admin can approve a pending entry and a notification is created', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending' });
    const token   = makeAdminToken({ id: ids.adminId });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    // Notification should have been created for the candidate's user
    const notif = mockTenantDb.prepare(
      'SELECT * FROM notifications WHERE reference_id = ? AND reference_type = ?'
    ).get(entryId, 'time_entry');
    expect(notif).toBeDefined();
    expect(notif.title).toMatch(/approved/i);
  });

  it('admin can reject a pending entry and a notification is created', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending' });
    const token   = makeAdminToken({ id: ids.adminId });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const notif = mockTenantDb.prepare(
      'SELECT * FROM notifications WHERE reference_id = ? AND reference_type = ?'
    ).get(entryId, 'time_entry');
    expect(notif).toBeDefined();
    expect(notif.title).toMatch(/rejected/i);
  });

  it('candidate cannot edit an approved entry (returns 400)', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'approved' });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: 6 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot edit approved/i);
  });

  it('candidate cannot edit another candidate\'s entry (returns 403)', async () => {
    // Entry belongs to cand2
    const entryId = insertEntry(mockTenantDb, ids.cand2Id, { status: 'pending' });
    // cand1 (alice) tries to edit it
    const token = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: 5 });

    expect(res.status).toBe(403);
  });

  it('candidate can edit their own pending entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending', hours: 4 });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: 6 });

    expect(res.status).toBe(200);
    expect(res.body.hours).toBe(6);
  });

  it('returns 400 when hours > 24 on update', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending' });
    const token   = makeAdminToken({ id: ids.adminId });

    const res = await request(app)
      .put(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: 25 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent entry id', async () => {
    const token = makeAdminToken({ id: ids.adminId });

    const res = await request(app)
      .put('/api/time-entries/99999')
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: 5 });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/client-approve
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/client-approve', () => {
  it('client can approve an admin-approved entry for their candidate', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'approved' });
    const token   = makeClientToken({ id: ids.clientUser1Id, clientId: ids.client1Id });

    const res = await request(app)
      .post(`/api/time-entries/${entryId}/client-approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    const updated = mockTenantDb.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    expect(updated.client_approval_status).toBe('approved');
  });

  it('client cannot approve a still-pending entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending' });
    const token   = makeClientToken({ id: ids.clientUser1Id, clientId: ids.client1Id });

    const res = await request(app)
      .post(`/api/time-entries/${entryId}/client-approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/admin-approved/i);
  });

  it('client cannot approve an entry belonging to a different client\'s candidate', async () => {
    // cand2 belongs to client2; clientUser1 is linked to client1
    const entryId = insertEntry(mockTenantDb, ids.cand2Id, { status: 'approved' });
    const token   = makeClientToken({ id: ids.clientUser1Id, clientId: ids.client1Id });

    const res = await request(app)
      .post(`/api/time-entries/${entryId}/client-approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('returns 403 when a candidate tries to use the client-approve endpoint', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'approved' });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .post(`/api/time-entries/${entryId}/client-approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /:id
// ═══════════════════════════════════════════════════════════════════════════════

describe('DELETE /:id', () => {
  it('candidate can delete their own pending entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'pending' });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .delete(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const gone = mockTenantDb.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    expect(gone).toBeUndefined();
  });

  it('candidate cannot delete an approved entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand1Id, { status: 'approved' });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .delete(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete approved/i);
  });

  it('candidate cannot delete another candidate\'s entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand2Id, { status: 'pending' });
    const token   = makeCandidateToken({ id: ids.candUser1Id, candidateId: ids.cand1Id });

    const res = await request(app)
      .delete(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('admin can delete any entry', async () => {
    const entryId = insertEntry(mockTenantDb, ids.cand2Id, { status: 'pending' });
    const token   = makeAdminToken({ id: ids.adminId });

    const res = await request(app)
      .delete(`/api/time-entries/${entryId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
