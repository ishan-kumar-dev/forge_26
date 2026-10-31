import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeReport } from './services/triage.js';
import { notifyStatusChange } from './services/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
export const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'civic-resolve.db'));
db.pragma('journal_mode = WAL');
db.exec(`
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','supervisor','worker')), department TEXT, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT NOT NULL, suggested_category TEXT, ai_confidence REAL, ai_reasoning TEXT, analysis_source TEXT, severity INTEGER NOT NULL, status TEXT NOT NULL, department TEXT NOT NULL, address TEXT, ward TEXT, latitude REAL, longitude REAL, observed_at TEXT NOT NULL, reporter_name TEXT, reporter_contact TEXT, is_anonymous INTEGER NOT NULL DEFAULT 0, media_json TEXT NOT NULL DEFAULT '[]', duplicate_of TEXT, duplicate_count INTEGER NOT NULL DEFAULT 0, sla_due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, FOREIGN KEY(report_id) REFERENCES reports(id));
 CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, department TEXT NOT NULL, assignee TEXT, instructions TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(report_id) REFERENCES reports(id));
 CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);
 CREATE INDEX IF NOT EXISTS reports_geo_idx ON reports(latitude, longitude);
`);

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 15 * 1024 * 1024, files: 3 }, fileFilter: (_r, f, cb) => cb(null, /^(image|video|audio)\//.test(f.mimetype)) });

const now = () => new Date().toISOString();
const reportRef = () => `CR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const safeJson = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };
const publicReport = (r) => ({ ...r, reporter_name: undefined, reporter_contact: undefined, media_json: undefined });
function audit(reportId, actor, action, note = '') { db.prepare('INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), reportId, actor, action, note, now()); }
function sign(user) { return jwt.sign({ sub: user.id, role: user.role, name: user.name, department: user.department }, process.env.JWT_SECRET, { expiresIn: '8h' }); }
function auth(req, res, next) { try { const token = req.headers.authorization?.replace(/^Bearer /, ''); req.user = jwt.verify(token, process.env.JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Authentication required.' }); } }
function staff(req, res, next) { if (!['admin', 'supervisor', 'worker'].includes(req.user.role)) return res.status(403).json({ error: 'Staff access required.' }); next(); }
function validateReport(body) {
 const errors = [];
 if (!body.title || body.title.trim().length < 4) errors.push('A title of at least 4 characters is required.');
 if (!['Road damage','Water supply','Drainage','Sanitation','Streetlight','Public safety','Parks','Other'].includes(body.category)) errors.push('Select a valid issue category.');
 if (!body.address && (body.latitude === undefined || body.latitude === '' || body.longitude === undefined || body.longitude === '')) errors.push('Provide an address or map coordinates.');
 if (body.latitude && (!Number.isFinite(+body.latitude) || +body.latitude < -90 || +body.latitude > 90)) errors.push('Latitude must be between -90 and 90.');
 if (body.longitude && (!Number.isFinite(+body.longitude) || +body.longitude < -180 || +body.longitude > 180)) errors.push('Longitude must be between -180 and 180.');
 if (body.description?.length > 2000) errors.push('Description must be 2,000 characters or fewer.');
 return errors;
}

// Bootstrap only a password from environment; no public default credential exists.
const adminEmail = process.env.ADMIN_EMAIL;
if (adminEmail && process.env.ADMIN_PASSWORD && !db.prepare('SELECT 1 FROM users WHERE email=?').get(adminEmail)) {
 db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), 'Municipal Administrator', adminEmail.toLowerCase(), bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12), 'admin', 'Municipal Operations', now());
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: now() }));
app.post('/api/auth/login', (req, res) => {
 const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase());
 if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
 res.json({ token: sign(user), user: { name: user.name, role: user.role, department: user.department } });
});

app.post('/api/reports', upload.array('media', 3), async (req, res, next) => {
 try {
  const fields = req.body; const errors = validateReport(fields); if (errors.length) return res.status(422).json({ errors });
  const media = (req.files || []).map(f => ({ id: f.filename, name: f.originalname, mime: f.mimetype, size: f.size, filePath: f.path }));
  const potentialDuplicate = fields.latitude && fields.longitude ? db.prepare(`SELECT id, reference, title FROM reports WHERE status NOT IN ('Closed') AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1`).get(+fields.latitude - .003, +fields.latitude + .003, +fields.longitude - .003, +fields.longitude + .003) : null;
  const triage = await analyzeReport({ ...fields, media, potentialDuplicate });
  const id = randomUUID(), reference = reportRef(), timestamp = now();
  db.prepare(`INSERT INTO reports (id,reference,title,description,category,suggested_category,ai_confidence,ai_reasoning,analysis_source,severity,status,department,address,ward,latitude,longitude,observed_at,reporter_name,reporter_contact,is_anonymous,media_json,duplicate_of,duplicate_count,sla_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
   id, reference, fields.title.trim(), fields.description?.trim() || '', fields.category, triage.category, triage.confidence, triage.reasoning, triage.source, triage.severity, 'Submitted', triage.department, fields.address?.trim() || null, fields.ward || null, fields.latitude ? +fields.latitude : null, fields.longitude ? +fields.longitude : null, fields.observed_at || timestamp, fields.is_anonymous === 'true' ? null : fields.reporter_name?.trim() || null, fields.is_anonymous === 'true' ? null : fields.reporter_contact?.trim() || null, fields.is_anonymous === 'true' ? 1 : 0, JSON.stringify(media.map(({ filePath, ...stored }) => stored)), potentialDuplicate?.id || null, potentialDuplicate ? 1 : 0, new Date(Date.now() + triage.slaHours * 3600000).toISOString(), timestamp, timestamp);
  audit(id, 'Citizen', 'Submitted', potentialDuplicate ? `Potential duplicate of ${potentialDuplicate.reference}; staff review required.` : 'Submitted via citizen portal.');
  res.status(201).json({ reference, severity: triage.severity, department: triage.department, duplicateHint: potentialDuplicate ? potentialDuplicate.reference : null, message: 'Your report was received and is awaiting municipal review.' });
 } catch (e) { next(e); }
});

app.get('/api/reports/:reference', (req, res) => {
 const report = db.prepare('SELECT * FROM reports WHERE reference=?').get(req.params.reference.toUpperCase());
 if (!report) return res.status(404).json({ error: 'Report not found.' });
 const activities = db.prepare('SELECT actor,action,note,created_at FROM activities WHERE report_id=? ORDER BY created_at').all(report.id);
 res.json({ report: { ...publicReport(report), media: safeJson(report.media_json) }, activities });
});
app.get('/api/public/reports', (req, res) => {
 const rows = db.prepare(`SELECT id,reference,title,category,severity,status,department,address,ward,latitude,longitude,observed_at,duplicate_count,created_at,updated_at FROM reports WHERE latitude IS NOT NULL ORDER BY created_at DESC LIMIT 200`).all();
 res.json(rows);
});
app.get('/api/public/dashboard', (_req, res) => {
 const totals = db.prepare(`SELECT COUNT(*) total, SUM(status IN ('Resolved','Closed')) resolved, SUM(status NOT IN ('Resolved','Closed')) pending, ROUND(AVG(severity),1) avgSeverity FROM reports`).get();
 const byCategory = db.prepare('SELECT category name, COUNT(*) value FROM reports GROUP BY category ORDER BY value DESC').all();
 const byStatus = db.prepare('SELECT status name, COUNT(*) value FROM reports GROUP BY status').all();
 const byDepartment = db.prepare(`SELECT department name, COUNT(*) total, SUM(status IN ('Resolved','Closed')) resolved FROM reports GROUP BY department ORDER BY total DESC`).all();
 const hotspots = db.prepare(`SELECT ward, ROUND(latitude,3) latitude, ROUND(longitude,3) longitude, COUNT(*) reports, ROUND(AVG(severity),1) severity FROM reports WHERE latitude IS NOT NULL GROUP BY ward, ROUND(latitude,3), ROUND(longitude,3) HAVING COUNT(*) > 1 ORDER BY reports DESC LIMIT 12`).all();
 res.json({ totals: { ...totals, total: totals.total || 0, resolved: totals.resolved || 0, pending: totals.pending || 0 }, byCategory, byStatus, byDepartment, hotspots });
});

app.get('/api/admin/reports', auth, staff, (req, res) => {
 const status = req.query.status; const department = req.query.department;
 let sql = 'SELECT * FROM reports WHERE 1=1'; const params = [];
 if (req.user.role !== 'admin') { sql += ' AND department=?'; params.push(req.user.department); }
 if (status) { sql += ' AND status=?'; params.push(status); }
 if (department && req.user.role === 'admin') { sql += ' AND department=?'; params.push(department); }
 sql += ' ORDER BY severity DESC, created_at DESC LIMIT 250';
 res.json(db.prepare(sql).all(...params).map(r => ({ ...r, media: safeJson(r.media_json) })));
});
app.patch('/api/admin/reports/:id', auth, staff, async (req, res) => {
 const report = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id); if (!report) return res.status(404).json({ error: 'Report not found.' });
 if (req.user.role !== 'admin' && report.department !== req.user.department) return res.status(403).json({ error: 'You may only manage reports assigned to your department.' });
 const allowedStatuses = ['Submitted','Under Review','Verified','Assigned','In Progress','Resolved','Closed'];
 const { status, category, department, severity, note, mergeInto, sla_due_at } = req.body;
 if (status && !allowedStatuses.includes(status)) return res.status(422).json({ error: 'Invalid status.' });
 if (severity && (!Number.isInteger(+severity) || +severity < 1 || +severity > 5)) return res.status(422).json({ error: 'Severity must be 1–5.' });
 if (category && !['Road damage','Water supply','Drainage','Sanitation','Streetlight','Public safety','Parks','Other'].includes(category)) return res.status(422).json({ error: 'Invalid category.' });
 if (department && !['Roads & Public Works','Water Supply','Drainage','Sanitation','Electrical Maintenance','Emergency Response','Parks & Urban Forestry','Municipal Operations'].includes(department)) return res.status(422).json({ error: 'Invalid department.' });
 if (req.user.role !== 'admin' && department && department !== req.user.department) return res.status(403).json({ error: 'Only administrators can reassign a report.' });
 const next = { status: status || report.status, category: category || report.category, department: department || report.department, severity: severity ? +severity : report.severity, duplicate_of: mergeInto || report.duplicate_of, sla_due_at: sla_due_at || report.sla_due_at };
 db.prepare('UPDATE reports SET status=?,category=?,department=?,severity=?,duplicate_of=?,sla_due_at=?,updated_at=? WHERE id=?').run(next.status,next.category,next.department,next.severity,next.duplicate_of,next.sla_due_at,now(),report.id);
 if (status === 'Assigned' && report.status !== 'Assigned') db.prepare('INSERT INTO work_orders VALUES (?,?,?,?,?,?,?)').run(randomUUID(), report.id, next.department, null, `Inspect and resolve ${report.title}.`, 'Open', now());
 audit(report.id, req.user.name, status ? `Changed status to ${status}` : 'Updated report', note || '');
 if (status && status !== report.status) {
  const delivery = await notifyStatusChange({ reference: report.reference, title: report.title, contact: report.reporter_contact }, status, note);
  if (delivery.attempted) audit(report.id, 'Notification service', delivery.delivered ? 'Sent status email' : 'Status email could not be delivered', delivery.detail);
 }
 res.json({ ok: true });
});
app.get('/api/admin/reports/:id/activities', auth, staff, (req,res) => res.json(db.prepare('SELECT * FROM activities WHERE report_id=? ORDER BY created_at DESC').all(req.params.id)));
app.get('/api/media/:id', auth, staff, (req, res) => { const f = path.join(UPLOAD_DIR, path.basename(req.params.id)); if (!fs.existsSync(f)) return res.sendStatus(404); res.sendFile(f); });
app.use((err, _req, res, _next) => { console.error(err); if (err instanceof multer.MulterError) return res.status(422).json({ error: err.message }); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); });
export { app };
if (process.env.NODE_ENV !== 'test') app.listen(process.env.PORT || 5000, () => console.log(`Civic Resolve API listening on ${process.env.PORT || 5000}`));
