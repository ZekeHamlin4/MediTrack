// Email: SMTP for sending approved drafts, IMAP for reading the inbox.
// Configure in server/.env (see .env.example). Gmail users: create an App Password
// (Google Account > Security > 2-Step Verification > App passwords).
const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./db');
const care = require('./care');

const env = k => (process.env[k] || '').trim();

function smtpConfigured() { return !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')); }
function imapConfigured() { return !!(env('IMAP_HOST') && env('IMAP_USER') && env('IMAP_PASS')); }

function status() {
  return {
    send_enabled: smtpConfigured(),
    read_enabled: imapConfigured(),
    from: env('SMTP_FROM') || env('SMTP_USER') || null,
  };
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = Number(env('SMTP_PORT') || 465);
    transporter = nodemailer.createTransport({
      host: env('SMTP_HOST'), port, secure: port === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    });
  }
  return transporter;
}

async function sendDraft(pid, id) {
  const d = care.getDraft(pid, id);
  if (!d) { const e = new Error('Draft not found'); e.status = 404; throw e; }
  if (d.status === 'sent') { const e = new Error('Already sent'); e.status = 400; throw e; }
  if (!d.to_email) { const e = new Error('This draft has no recipient email address'); e.status = 400; throw e; }
  if (!smtpConfigured()) { const e = new Error('Email sending is not set up. Add SMTP settings to server/.env'); e.status = 400; throw e; }
  try {
    await getTransporter().sendMail({
      from: env('SMTP_FROM') || env('SMTP_USER'),
      to: d.to_email, subject: d.subject, text: d.body,
    });
    db.prepare("UPDATE outbox SET status='sent', sent_at=CURRENT_TIMESTAMP, error=NULL, version=version+1 WHERE id=? AND patient_id=?").run(id, pid);
  } catch (e) {
    db.prepare("UPDATE outbox SET status='failed', error=?, version=version+1 WHERE id=? AND patient_id=?").run(e.message, id, pid);
    throw e;
  }
  return care.getDraft(pid, id);
}

// Returns the most recent messages from the inbox. `query` filters on from/subject text.
async function readInbox({ limit = 15, query } = {}) {
  if (!imapConfigured()) { const e = new Error('Email reading is not set up. Add IMAP settings to server/.env'); e.status = 400; throw e; }
  const client = new ImapFlow({
    host: env('IMAP_HOST'), port: Number(env('IMAP_PORT') || 993), secure: true,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASS') }, logger: false,
  });
  await client.connect();
  const out = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      let uids;
      if (query) uids = await client.search({ or: [{ from: query }, { subject: query }, { body: query }] }, { uid: true });
      else uids = await client.search({ all: true }, { uid: true });
      const n = Math.min(Number(limit) || 15, 30);
      const pick = (uids || []).slice(-n).reverse();
      for (const uid of pick) {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg) continue;
        const parsed = await simpleParser(msg.source);
        out.push({
          uid,
          from: parsed.from?.text || '',
          subject: parsed.subject || '(no subject)',
          date: parsed.date ? parsed.date.toISOString() : null,
          text: (parsed.text || '').replace(/\s+\n/g, '\n').slice(0, 4000),
          attachments: (parsed.attachments || []).map(a => a.filename).filter(Boolean),
        });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return out;
}

const router = express.Router();
router.get('/email/status', (req, res) => res.json(status()));
router.get('/email/inbox', async (req, res) => {
  try { res.json(await readInbox(req.query)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
// Patient data: mounted at /api/patients/:pid (see index.js).
// Only this endpoint sends mail, and only when the user taps "Send" in the app.
const patientRouter = express.Router();
patientRouter.post('/outbox/:id/send', async (req, res) => {
  try {
    const sent = await sendDraft(req.patientId, req.params.id);
    db.audit('email_sent', { userId: req.user.id, patientId: req.patientId, details: { outbox_id: sent.id } });
    res.json(sent);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = { router, patientRouter, status, readInbox, sendDraft };
