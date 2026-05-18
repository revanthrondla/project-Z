/**
 * Scheduled Report Runner
 *
 * Handles:
 *   1. Generating CSV report data for a given schedule config
 *   2. Sending the CSV as an email attachment via the existing emailService
 *   3. Updating last_sent_at and next_run_at after a successful send
 *
 * Called from:
 *   - The node-cron job in server.js (every 15 min tick)
 *   - POST /api/scheduled-reports/:id/run (manual trigger)
 */

const { sendEmail } = require('./emailService');

/* ─── Period helpers ─────────────────────────────────────────────────────── */
function getPeriodDates(period) {
  const today = new Date();
  const pad   = n => String(n).padStart(2, '0');
  const iso   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  switch (period) {
    case 'last_week': {
      const end   = new Date(today); end.setDate(today.getDate() - today.getDay() - 1);
      const start = new Date(end);   start.setDate(end.getDate() - 6);
      return { start: iso(start), end: iso(end) };
    }
    case 'last_month': {
      const end   = new Date(today.getFullYear(), today.getMonth(), 0);
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: iso(start), end: iso(end) };
    }
    case 'last_quarter': {
      const q     = Math.floor(today.getMonth() / 3);
      const qStart = new Date(today.getFullYear(), (q - 1) * 3, 1);
      const qEnd   = new Date(today.getFullYear(), q * 3, 0);
      return { start: iso(qStart), end: iso(qEnd) };
    }
    case 'last_year': {
      const y = today.getFullYear() - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    default: { // 'last_period' — same span as frequency implies
      const end   = new Date(today); end.setDate(today.getDate() - 1);
      const start = new Date(end);   start.setDate(end.getDate() - 27); // last ~4 weeks
      return { start: iso(start), end: iso(end) };
    }
  }
}

/* ─── Compute next_run_at ────────────────────────────────────────────────── */
function computeNextRun(frequency, dayOfWeek, dayOfMonth) {
  const now  = new Date();
  let   next = new Date(now);

  if (frequency === 'daily') {
    next.setDate(now.getDate() + 1);
    next.setHours(7, 0, 0, 0);
  } else if (frequency === 'weekly') {
    const dow  = Number(dayOfWeek) || 1;
    const diff = (dow - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + diff);
    next.setHours(7, 0, 0, 0);
  } else if (frequency === 'monthly') {
    const dom = Number(dayOfMonth) || 1;
    next = new Date(now.getFullYear(), now.getMonth() + 1, dom, 7, 0, 0, 0);
  }
  return next;
}

/* ─── CSV generators ─────────────────────────────────────────────────────── */
function toCSV(rows) {
  if (!rows || !rows.length) return 'No data for this period.\n';
  const headers = Object.keys(rows[0]);
  const lines   = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h] ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}

async function generateCSV(db, reportType, startDate, endDate) {
  const p = [startDate, endDate];

  switch (reportType) {
    case 'hours': {
      const { rows } = await db.query(`
        SELECT
          e.name          AS employee,
          cl.name         AS client,
          e.hourly_rate   AS rate,
          ROUND(SUM(te.hours)::numeric, 2)                                  AS total_hours,
          ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END)::numeric,2) AS approved_hours,
          ROUND(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END)::numeric,2) AS pending_hours,
          ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours*e.hourly_rate ELSE 0 END)::numeric,2) AS approved_amount
        FROM   time_entries te
        JOIN   employees    e  ON te.candidate_id = e.id
        LEFT JOIN clients   cl ON e.client_id     = cl.id
        WHERE  te.date BETWEEN $1 AND $2
        GROUP  BY e.id, e.name, cl.name, e.hourly_rate
        ORDER  BY e.name
      `, p);
      return toCSV(rows);
    }

    case 'absences': {
      const { rows } = await db.query(`
        SELECT
          e.name        AS employee,
          a.type,
          a.start_date,
          a.end_date,
          (a.end_date - a.start_date + 1) AS days,
          a.status,
          a.notes
        FROM   absences  a
        JOIN   employees e ON a.candidate_id = e.id
        WHERE  a.start_date >= $1 AND a.end_date <= $2
        ORDER  BY a.start_date DESC
      `, p);
      return toCSV(rows);
    }

    case 'revenue': {
      const { rows } = await db.query(`
        SELECT
          e.name          AS employee,
          i.invoice_number,
          i.issue_date,
          i.due_date,
          i.hours_billed,
          i.total_amount,
          i.status
        FROM   invoices  i
        JOIN   employees e ON i.candidate_id = e.id
        WHERE  i.issue_date BETWEEN $1 AND $2
        ORDER  BY i.issue_date DESC
      `, p);
      return toCSV(rows);
    }

    case 'labor_cost': {
      const { rows } = await db.query(`
        SELECT
          COALESCE(p.name, 'General')           AS project,
          COALESCE(cl.name, 'Unassigned')       AS client,
          ROUND(SUM(te.hours)::numeric,2)       AS total_hours,
          ROUND(SUM(te.hours * e.hourly_rate)::numeric,2) AS labor_cost
        FROM   time_entries te
        JOIN   employees    e  ON te.candidate_id = e.id
        LEFT JOIN projects  p  ON te.project_id   = p.id
        LEFT JOIN clients   cl ON e.client_id     = cl.id
        WHERE  te.date BETWEEN $1 AND $2 AND te.status = 'approved'
        GROUP  BY p.name, cl.name
        ORDER  BY labor_cost DESC
      `, p);
      return toCSV(rows);
    }

    case 'utilization': {
      const { rows } = await db.query(`
        SELECT
          e.name                                AS employee,
          e.role,
          ROUND(SUM(te.hours)::numeric,2)       AS total_hours,
          ROUND(SUM(CASE WHEN te.billable THEN te.hours ELSE 0 END)::numeric,2) AS billable_hours,
          CASE WHEN SUM(te.hours) > 0
            THEN ROUND((SUM(CASE WHEN te.billable THEN te.hours ELSE 0 END) / SUM(te.hours) * 100)::numeric,1)
            ELSE 0 END                           AS utilization_pct
        FROM   time_entries te
        JOIN   employees    e ON te.candidate_id = e.id
        WHERE  te.date BETWEEN $1 AND $2 AND te.status = 'approved'
        GROUP  BY e.id, e.name, e.role
        ORDER  BY utilization_pct DESC
      `, p);
      return toCSV(rows);
    }

    case 'payroll': {
      const { rows } = await db.query(`
        SELECT
          e.name                                AS employee,
          e.hourly_rate                         AS rate,
          ROUND(SUM(te.hours)::numeric,2)       AS total_hours,
          ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours*e.hourly_rate ELSE 0 END)::numeric,2) AS gross_pay
        FROM   time_entries te
        JOIN   employees    e ON te.candidate_id = e.id
        WHERE  te.date BETWEEN $1 AND $2
        GROUP  BY e.id, e.name, e.hourly_rate
        ORDER  BY e.name
      `, p);
      return toCSV(rows);
    }

    default:
      return `Report type "${reportType}" not supported for CSV generation.\n`;
  }
}

/* ─── Main entry point ───────────────────────────────────────────────────── */
async function sendScheduledReport(db, schedule) {
  const { start, end } = getPeriodDates(schedule.period);
  const csv            = await generateCSV(db, schedule.report_type, start, end);
  const filename       = `${schedule.report_type}_report_${start}_${end}.csv`;
  const label          = schedule.name || schedule.report_type;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#10b981;margin-bottom:4px">📊 ${label}</h2>
      <p style="color:#6b7280;font-size:14px">
        Scheduled report for period <strong>${start}</strong> to <strong>${end}</strong>
      </p>
      <p style="font-size:14px;color:#374151">
        Your report is attached as a CSV file (<code>${filename}</code>).
        Open it in Excel, Google Sheets, or any spreadsheet application.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        This is an automated report from HireIQ.
        To manage your scheduled reports, log in and visit Reports → Schedule.
      </p>
    </div>
  `;

  const recipients = Array.isArray(schedule.recipients)
    ? schedule.recipients.join(', ')
    : schedule.recipients;

  await sendEmail({
    to:      recipients,
    subject: `[HireIQ] ${label} — ${start} to ${end}`,
    html,
    text: `Scheduled report "${label}" for ${start} to ${end} is attached.`,
    attachments: [
      {
        filename,
        content:     Buffer.from(csv, 'utf8'),
        contentType: 'text/csv',
      },
    ],
  });

  // Update last_sent_at and compute next_run_at
  const nextRun = computeNextRun(schedule.frequency, schedule.day_of_week, schedule.day_of_month);
  await db.query(
    'UPDATE scheduled_reports SET last_sent_at = NOW(), next_run_at = $1 WHERE id = $2',
    [nextRun, schedule.id],
  );

  console.log(`[ScheduledReports] Sent "${label}" to ${recipients}`);
}

/* ─── Cron tick — called every 15 min from server.js ────────────────────── */
async function runDueReports(getAllTenantDbs) {
  let tenantDbs;
  try {
    tenantDbs = await getAllTenantDbs();
  } catch (err) {
    console.error('[ScheduledReports] Failed to enumerate tenant DBs:', err.message);
    return;
  }

  for (const { slug, db } of tenantDbs) {
    try {
      const { rows: due } = await db.query(`
        SELECT * FROM scheduled_reports
        WHERE  is_active = TRUE
          AND  next_run_at IS NOT NULL
          AND  next_run_at <= NOW()
        ORDER  BY next_run_at
      `);
      for (const schedule of due) {
        await sendScheduledReport(db, schedule).catch(err =>
          console.error(`[ScheduledReports] Failed for tenant=${slug} id=${schedule.id}:`, err.message),
        );
      }
    } catch (err) {
      // Tenant schema may be incomplete (e.g. missing scheduled_reports table) — skip it
      console.error(`[ScheduledReports] Skipping tenant ${slug || '?'}: ${err.message}`);
    }
  }
}

module.exports = { sendScheduledReport, runDueReports };
