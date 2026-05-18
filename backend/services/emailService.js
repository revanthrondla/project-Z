/**
 * Flow — Email Service
 *
 * Sends transactional emails using:
 *  1. Platform SMTP configured via environment variables (preferred)
 *  2. Logs to console in development when SMTP is not configured (failsafe)
 *
 * REQUIRED ENV VARS for production:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

const nodemailer = require('nodemailer');

/** Build a nodemailer transporter from env vars, or null if not configured. */
function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@flowapp.io';

/**
 * Send an email.
 * Falls back to console.log in development if SMTP is not configured.
 */
async function sendEmail({ to, subject, html, text, attachments }) {
  const transporter = createTransporter();

  if (!transporter) {
    // Dev mode fallback — print to console so devs can see the OTP
    console.log('\n📧 [EMAIL SERVICE — no SMTP configured]');
    console.log(`   To:      ${to}`);
    console.log(`   Subject: ${subject}`);
    if (attachments?.length) console.log(`   Attachments: ${attachments.map(a => a.filename).join(', ')}`);
    console.log(`   Body:    ${text || '(html only)'}`);
    console.log('');
    return { messageId: 'dev-console' };
  }

  const mailOpts = { from: `"HireIQ" <${FROM_ADDRESS}>`, to, subject, html, text };
  if (attachments?.length) mailOpts.attachments = attachments;

  const result = await transporter.sendMail(mailOpts);
  return result;
}

/**
 * Send an MFA one-time code to a user's email.
 */
async function sendMfaOtpEmail({ to, name, code, expiresInMinutes = 10 }) {
  const subject = `Your Flow verification code: ${code}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px;">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="display:inline-block;background:#059669;color:#fff;font-weight:800;font-size:20px;padding:10px 22px;border-radius:8px;letter-spacing:-.3px;">Flow</div>
        </div>
        <h2 style="margin:0 0 8px;font-size:22px;color:#111827;">Your sign-in code</h2>
        <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
          Hi ${name || 'there'}, here is your one-time verification code:
        </p>
        <div style="background:#f3f4f6;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#111827;">${code}</span>
        </div>
        <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">
          This code expires in <strong>${expiresInMinutes} minutes</strong>. Do not share it with anyone.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="margin:0;color:#9ca3af;font-size:12px;">
          If you did not attempt to sign in, you can safely ignore this email.
        </p>
      </div>
    </body>
    </html>
  `;

  const text = `Your Flow sign-in code is: ${code}\nThis code expires in ${expiresInMinutes} minutes. Do not share it with anyone.`;

  return sendEmail({ to, subject, html, text });
}

module.exports = { sendEmail, sendMfaOtpEmail };
