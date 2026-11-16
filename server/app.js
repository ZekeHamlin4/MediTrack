// Builds the MediTrack web app: pages, sign-in, and the API with permission checks (M2 + M3).
// index.js starts it; the tests use it directly.
const express = require('express');
const path = require('path');
const auth = require('./auth');
const care = require('./care');
const email = require('./email');
const supplies = require('./supplies');

const app = express();
app.disable('x-powered-by');
// No cors(): other websites can't read MediTrack's data (removed in M3).
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// Every API call: same-origin check for changes, then read the session cookie.
app.use('/api', auth.sameOrigin, auth.loadSession);

// Open to everyone who can reach MediTrack: first-run setup (needs the setup code) and sign-in.
app.use('/api', auth.setupRouter);
app.use('/api', auth.authRouter);

// Everything below needs a signed-in account that has picked its own password.
app.use('/api', auth.requireAuth, auth.requireReady);
app.use('/api/admin', auth.requireHomeAdmin, auth.adminRouter);
app.use('/api', care.router, email.router);

// Patient data: only members of that patient.
app.use('/api/patients/:pid', auth.requirePatientMember, care.patientRouter, email.patientRouter, supplies.patientRouter);

// Phase 1a: the AI assistant stays off (it shares patient data without the consent switches and $10 limit).
// It comes back with M12. server/assistant.js is kept but not connected.

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

module.exports = app;
