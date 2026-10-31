import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeReport, CATEGORIES, DEPARTMENTS } from './services/triage.js';
import { notifyCitizen, notifyStatusChange } from './services/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
export const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(__dirname, 'civic-resolve.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','supervisor','worker')), department TEXT, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT NOT NULL, suggested_category TEXT, ai_confidence REAL, ai_reasoning TEXT, analysis_source TEXT, severity INTEGER NOT NULL, status TEXT NOT NULL, department TEXT NOT NULL, address TEXT, ward TEXT, latitude REAL, longitude REAL, observed_at TEXT NOT NULL, reporter_name TEXT, reporter_contact TEXT, is_anonymous INTEGER NOT NULL DEFAULT 0, media_json TEXT NOT NULL DEFAULT '[]', duplicate_of TEXT, duplicate_count INTEGER NOT NULL DEFAULT 0, sla_due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, FOREIGN KEY(report_id) REFERENCES reports(id));
 CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, department TEXT NOT NULL, assignee TEXT, instructions TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(report_id) REFERENCES reports(id));
 CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);
 CREATE INDEX IF NOT EXISTS reports_geo_idx ON reports(latitude, longitude);
 CREATE INDEX IF NOT EXISTS activities_report_idx ON activities(report_id);
`);
// No migration tool, so add columns that older local databases are missing.
if (!db.prepare('PRAGMA table_info(reports)').all().some(c => c.name === 'evidence_json')) db.exec(`ALTER TABLE reports ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]'`);
// First staff touch and first resolution per report. Used by the dashboard, exports and performance report.
db.exec(`CREATE VIEW IF NOT EXISTS report_timing AS SELECT r.id, r.department, r.ward, r.status, r.created_at, r.sla_due_at,
 (SELECT MIN(a.created_at) FROM activities a WHERE a.report_id=r.id AND a.actor NOT IN ('Citizen','Notification service')) responded_at,
 (SELECT MIN(a.created_at) FROM activities a WHERE a.report_id=r.id AND a.action='Changed status to Resolved') resolved_at FROM reports r`);
const STATUSES = ['Submitted','Under Review','Verified','Assigned','In Progress','Resolved','Closed'];
const ROLES = ['admin','supervisor','worker'];
const WORK_ORDER_STATUSES = ['Open','In Progress','Done'];
const OPEN = `status NOT IN ('Resolved','Closed')`;
const hours = (from, to) => `ROUND(AVG((julianday(${to})-julianday(${from}))*24),1)`;

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 15 * 1024 * 1024, files: 3 }, fileFilter: (_r, f, cb) => cb(null, /^(image|video|audio)\//.test(f.mimetype)) });
const evidenceUpload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 10 * 1024 * 1024, files: 4 }, fileFilter: (_r, f, cb) => cb(null, f.mimetype.startsWith('image/')) });
// Citizens get a tighter budget than the global limiter so one device can't flood the queue.
const citizenLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many reports from this connection. Please try again later.' } });

const now = () => new Date().toISOString();
const reportRef = () => `CR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const safeJson = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };
const publicReport = (r) => ({ ...r, reporter_name: undefined, reporter_contact: undefined, media_json: undefined, evidence_json: undefined });
// Quote cells and defuse spreadsheet formulas, since titles are citizen input.
const csvCell = v => { if (v == null) return ''; let s = String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
function sendRows(res, format, name, cols, rows) { if (format !== 'csv') return res.json(rows); res.type('text/csv').attachment(`${name}.csv`).send(toCsv(cols, rows)); }
async function notifyAndLog(report, headline, message) { const d = await notifyCitizen({ reference: report.reference, contact: report.reporter_contact }, headline, message); if (d.attempted) audit(report.id, 'Notification service', d.delivered ? `Sent email: ${headline}` : 'Email could not be delivered', d.detail); }
function looksLikeSpam(b) { const text = `${b.title || ''} ${b.description || ''}`; return (text.match(/https?:\/\/|www\./gi) || []).length > 2 || /(.)\1{11,}/.test(text); }
function adminOnly(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' }); next(); }
function audit(reportId, actor, action, note = '') { db.prepare('INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), reportId, actor, action, note, now()); }
function sign(user) { return jwt.sign({ sub: user.id, role: user.role, name: user.name, department: user.department }, process.env.JWT_SECRET, { expiresIn: '8h' }); }
function auth(req, res, next) { try { const token = req.headers.authorization?.replace(/^Bearer /, ''); req.user = jwt.verify(token, process.env.JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Authentication required.' }); } }
function staff(req, res, next) { if (!['admin', 'supervisor', 'worker'].includes(req.user.role)) return res.status(403).json({ error: 'Staff access required.' }); next(); }
function validateReport(body) {
 const errors = [];
 if (!body.title || body.title.trim().length < 4) errors.push('A title of at least 4 characters is required.');
 if (!CATEGORIES.includes(body.category)) errors.push('Select a valid issue category.');
 if (!body.address && (body.latitude === undefined || body.latitude === '' || body.longitude === undefined || body.longitude === '')) errors.push('Provide an address or map coordinates.');
 if (body.latitude && (!Number.isFinite(+body.latitude) || +body.latitude < -90 || +body.latitude > 90)) errors.push('Latitude must be between -90 and 90.');
 if (body.longitude && (!Number.isFinite(+body.longitude) || +body.longitude < -180 || +body.longitude > 180)) errors.push('Longitude must be between -180 and 180.');
 if (body.description?.length > 2000) errors.push('Description must be 2,000 characters or fewer.');
 if (looksLikeSpam(body)) errors.push('This report looks like spam. Remove links or repeated characters and try again.');
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

// Same category, still open, and either within ~300 m or at the same typed address.
function findDuplicate(f) {
 if (f.latitude && f.longitude) return db.prepare(`SELECT id, reference, title FROM reports WHERE status != 'Closed' AND category=? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1`).get(f.category, +f.latitude - .003, +f.latitude + .003, +f.longitude - .003, +f.longitude + .003);
 if (f.address?.trim()) return db.prepare(`SELECT id, reference, title FROM reports WHERE status != 'Closed' AND category=? AND lower(trim(address))=lower(trim(?)) ORDER BY created_at DESC LIMIT 1`).get(f.category, f.address);
 return null;
}
app.post('/api/reports', citizenLimit, upload.array('media', 3), async (req, res, next) => {
 try {
  const fields = req.body; const errors = validateReport(fields); if (errors.length) return res.status(422).json({ errors });
  const media = (req.files || []).map(f => ({ id: f.filename, name: f.originalname, mime: f.mimetype, size: f.size, filePath: f.path }));
  const potentialDuplicate = findDuplicate(fields);
  const triage = await analyzeReport({ ...fields, media, potentialDuplicate });
  const id = randomUUID(), reference = reportRef(), timestamp = now();
  db.prepare(`INSERT INTO reports (id,reference,title,description,category,suggested_category,ai_confidence,ai_reasoning,analysis_source,severity,status,department,address,ward,latitude,longitude,observed_at,reporter_name,reporter_contact,is_anonymous,media_json,duplicate_of,duplicate_count,sla_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
   id, reference, fields.title.trim(), fields.description?.trim() || '', fields.category, triage.category, triage.confidence, triage.reasoning, triage.source, triage.severity, 'Submitted', triage.department, fields.address?.trim() || null, fields.ward || null, fields.latitude ? +fields.latitude : null, fields.longitude ? +fields.longitude : null, fields.observed_at || timestamp, fields.is_anonymous === 'true' ? null : fields.reporter_name?.trim() || null, fields.is_anonymous === 'true' ? null : fields.reporter_contact?.trim() || null, fields.is_anonymous === 'true' ? 1 : 0, JSON.stringify(media.map(({ filePath, ...stored }) => stored)), potentialDuplicate?.reference || null, 0, new Date(Date.now() + triage.slaHours * 3600000).toISOString(), timestamp, timestamp);
  if (potentialDuplicate) db.prepare('UPDATE reports SET duplicate_count=duplicate_count+1 WHERE id=?').run(potentialDuplicate.id);
  audit(id, 'Citizen', 'Submitted', potentialDuplicate ? `Potential duplicate of ${potentialDuplicate.reference}; staff review required.` : 'Submitted via citizen portal.');
  res.status(201).json({ reference, severity: triage.severity, department: triage.department, duplicateHint: potentialDuplicate ? potentialDuplicate.reference : null, message: 'Your report was received and is awaiting municipal review.' });
 } catch (e) { next(e); }
});

app.get('/api/reports/:reference', (req, res) => {
 const report = db.prepare('SELECT * FROM reports WHERE reference=?').get(req.params.reference.toUpperCase());
 if (!report) return res.status(404).json({ error: 'Report not found.' });
 const activities = db.prepare('SELECT actor,action,note,created_at FROM activities WHERE report_id=? ORDER BY created_at').all(report.id);
 const evidence = safeJson(report.evidence_json).map(({ id, stage, at }) => ({ id, stage, at }));
 res.json({ report: { ...publicReport(report), media: safeJson(report.media_json) }, activities, evidence, awaitingClarification: awaitingClarification(report.id) });
});
// True when the latest clarification event is a staff question the citizen hasn't answered.
function awaitingClarification(reportId) { return db.prepare(`SELECT action FROM activities WHERE report_id=? AND action IN ('Clarification requested','Clarification provided') ORDER BY created_at DESC LIMIT 1`).get(reportId)?.action === 'Clarification requested'; }
app.post('/api/reports/:reference/clarification', citizenLimit, (req, res) => {
 const report = db.prepare('SELECT id FROM reports WHERE reference=?').get(req.params.reference.toUpperCase());
 if (!report) return res.status(404).json({ error: 'Report not found.' });
 const note = String(req.body.note || '').trim();
 if (note.length < 2 || note.length > 1000) return res.status(422).json({ error: 'Reply must be 2 to 1,000 characters.' });
 if (!awaitingClarification(report.id)) return res.status(409).json({ error: 'No clarification has been requested for this report.' });
 audit(report.id, 'Citizen', 'Clarification provided', note);
 db.prepare('UPDATE reports SET updated_at=? WHERE id=?').run(now(), report.id);
 res.status(201).json({ ok: true });
});
// Staff before/after photos are of public infrastructure, so trackers may see them. Citizen media stays staff-only.
app.get('/api/reports/:reference/evidence/:id', (req, res) => {
 const report = db.prepare('SELECT evidence_json FROM reports WHERE reference=?').get(req.params.reference.toUpperCase());
 const item = report && safeJson(report.evidence_json).find(e => e.id === req.params.id);
 if (!item) return res.sendStatus(404);
 res.type(item.mime).sendFile(path.join(UPLOAD_DIR, path.basename(item.id)));
});
app.get('/api/public/reports', (req, res) => {
 const rows = db.prepare(`SELECT id,reference,category,severity,status,department,address,ward,latitude,longitude,observed_at,duplicate_count,created_at,updated_at FROM reports WHERE latitude IS NOT NULL ORDER BY created_at DESC LIMIT 200`).all();
 res.json(rows);
});
app.get('/api/public/dashboard', (_req, res) => {
 const totals = db.prepare(`SELECT COUNT(*) total, SUM(status IN ('Resolved','Closed')) resolved, SUM(status NOT IN ('Resolved','Closed')) pending, ROUND(AVG(severity),1) avgSeverity FROM reports`).get();
 const byCategory = db.prepare('SELECT category name, COUNT(*) value FROM reports GROUP BY category ORDER BY value DESC').all();
 const byStatus = db.prepare('SELECT status name, COUNT(*) value FROM reports GROUP BY status').all();
 const timing = db.prepare(`SELECT ${hours('created_at','responded_at')} avgResponseHours, ${hours('created_at','resolved_at')} avgResolutionHours, SUM(${OPEN} AND sla_due_at < ?) overdue FROM report_timing`).get(now());
 const byDepartment = db.prepare(`SELECT department name, COUNT(*) total, SUM(status IN ('Resolved','Closed')) resolved, ${hours('created_at','resolved_at')} avgResolutionHours FROM report_timing GROUP BY department ORDER BY total DESC`).all();
 // Per-ward view so quieter wards with severe open issues stay visible next to busy ones.
 const byWard = db.prepare(`SELECT COALESCE(NULLIF(trim(ward),''),'Not given') ward, COUNT(*) total, SUM(${OPEN}) open, ROUND(AVG(severity),1) severity FROM reports GROUP BY 1 ORDER BY open DESC, severity DESC LIMIT 15`).all();
 const hotspots = db.prepare(`SELECT ward, ROUND(latitude,3) latitude, ROUND(longitude,3) longitude, COUNT(*) reports, ROUND(AVG(severity),1) severity FROM reports WHERE latitude IS NOT NULL GROUP BY ward, ROUND(latitude,3), ROUND(longitude,3) HAVING COUNT(*) > 1 ORDER BY reports DESC LIMIT 12`).all();
 res.json({ totals: { ...totals, ...timing, total: totals.total || 0, resolved: totals.resolved || 0, pending: totals.pending || 0, overdue: timing.overdue || 0 }, byCategory, byStatus, byDepartment, byWard, hotspots });
});
// Open data. No titles, addresses or free text (they can carry personal details); coordinates rounded to ~100 m.
const exportCols = ['reference','category','status','severity','department','ward','latitude','longitude','duplicate_count','created_at','responded_at','resolved_at'];
app.get('/api/public/export', (req, res) => {
 const rows = db.prepare(`SELECT r.reference, r.category, r.status, r.severity, r.department, r.ward, ROUND(r.latitude,3) latitude, ROUND(r.longitude,3) longitude, r.duplicate_count, r.created_at, t.responded_at, t.resolved_at FROM reports r JOIN report_timing t ON t.id=r.id ORDER BY r.created_at DESC`).all();
 sendRows(res, req.query.format, 'civic-resolve-open-data', exportCols, rows);
});

app.get('/api/admin/reports', auth, staff, (req, res) => {
 const status = req.query.status; const department = req.query.department;
 let sql = 'SELECT * FROM reports WHERE 1=1'; const params = [];
 if (req.user.role !== 'admin') { sql += ' AND department=?'; params.push(req.user.department); }
 if (status) { sql += ' AND status=?'; params.push(status); }
 if (department && req.user.role === 'admin') { sql += ' AND department=?'; params.push(department); }
 sql += ' ORDER BY severity DESC, created_at DESC LIMIT 250';
 res.json(db.prepare(sql).all(...params).map(r => ({ ...r, media: safeJson(r.media_json), evidence: safeJson(r.evidence_json) })));
});
app.patch('/api/admin/reports/:id', auth, staff, async (req, res) => {
 const report = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id); if (!report) return res.status(404).json({ error: 'Report not found.' });
 if (req.user.role !== 'admin' && report.department !== req.user.department) return res.status(403).json({ error: 'You may only manage reports assigned to your department.' });
 const { category, department, severity, note, mergeInto, sla_due_at, clarification } = req.body; let { status } = req.body;
 if (status && !STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid status.' });
 if (severity && (!Number.isInteger(+severity) || +severity < 1 || +severity > 5)) return res.status(422).json({ error: 'Severity must be 1–5.' });
 if (category && !CATEGORIES.includes(category)) return res.status(422).json({ error: 'Invalid category.' });
 if (department && !DEPARTMENTS.includes(department)) return res.status(422).json({ error: 'Invalid department.' });
 if (sla_due_at && Number.isNaN(Date.parse(sla_due_at))) return res.status(422).json({ error: 'SLA deadline must be a valid date.' });
 if (clarification !== undefined && (String(clarification).trim().length < 4 || String(clarification).length > 500)) return res.status(422).json({ error: 'Clarification question must be 4 to 500 characters.' });
 if (req.user.role !== 'admin' && department && department !== req.user.department) return res.status(403).json({ error: 'Only administrators can reassign a report.' });
 let target = null;
 if (mergeInto) {
  target = db.prepare('SELECT id, reference FROM reports WHERE reference=?').get(String(mergeInto).trim().toUpperCase());
  if (!target || target.id === report.id) return res.status(422).json({ error: 'Merge target must be another existing report reference.' });
  status = status || 'Closed';
 }
 const next = { status: status || report.status, category: category || report.category, department: department || report.department, severity: severity ? +severity : report.severity, duplicate_of: target?.reference || report.duplicate_of, sla_due_at: sla_due_at ? new Date(sla_due_at).toISOString() : report.sla_due_at };
 db.prepare('UPDATE reports SET status=?,category=?,department=?,severity=?,duplicate_of=?,sla_due_at=?,updated_at=? WHERE id=?').run(next.status,next.category,next.department,next.severity,next.duplicate_of,next.sla_due_at,now(),report.id);
 if (status === 'Assigned' && report.status !== 'Assigned') db.prepare('INSERT INTO work_orders VALUES (?,?,?,?,?,?,?)').run(randomUUID(), report.id, next.department, null, `Inspect and resolve ${report.title}.`, 'Open', now());
 if (target) {
  db.prepare('UPDATE reports SET duplicate_count=duplicate_count+1, updated_at=? WHERE id=?').run(now(), target.id);
  audit(target.id, req.user.name, 'Duplicate merged in', `${report.reference} was merged into this report.`);
  audit(report.id, req.user.name, `Merged into ${target.reference}`, note || 'Closed as a duplicate.');
 }
 const changes = [category && category !== report.category && `category → ${category}`, department && department !== report.department && `department → ${department}`, severity && +severity !== report.severity && `priority → ${severity}`, sla_due_at && `SLA → ${next.sla_due_at.slice(0, 16).replace('T', ' ')}`].filter(Boolean).join(', ');
 if (status || changes) audit(report.id, req.user.name, status ? `Changed status to ${status}` : 'Updated report', [changes, note].filter(Boolean).join('. '));
 if (clarification !== undefined) {
  const question = String(clarification).trim();
  audit(report.id, req.user.name, 'Clarification requested', question);
  await notifyAndLog(report, 'Clarification needed', `Municipal staff need more information about “${report.title}”:\n\n${question}\n\nYou can reply from the tracking page.`);
 }
 if (status && status !== report.status) {
  const delivery = await notifyStatusChange({ reference: report.reference, title: report.title, contact: report.reporter_contact }, status, note);
  if (delivery.attempted) audit(report.id, 'Notification service', delivery.delivered ? 'Sent status email' : 'Status email could not be delivered', delivery.detail);
 }
 res.json({ ok: true });
});
app.post('/api/admin/reports/:id/evidence', auth, staff, evidenceUpload.array('evidence', 4), async (req, res) => {
 const report = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id); if (!report) return res.status(404).json({ error: 'Report not found.' });
 if (req.user.role !== 'admin' && report.department !== req.user.department) return res.status(403).json({ error: 'You may only manage reports assigned to your department.' });
 const stage = req.body.stage === 'before' ? 'before' : 'after';
 if (!req.files?.length) return res.status(422).json({ error: 'Attach at least one image.' });
 const added = req.files.map(f => ({ id: f.filename, name: f.originalname, mime: f.mimetype, size: f.size, stage, by: req.user.name, at: now() }));
 db.prepare('UPDATE reports SET evidence_json=?, updated_at=? WHERE id=?').run(JSON.stringify([...safeJson(report.evidence_json), ...added]), now(), report.id);
 audit(report.id, req.user.name, `Uploaded ${stage} evidence`, `${added.length} photo(s).`);
 if (stage === 'after') await notifyAndLog(report, 'Resolution evidence uploaded', `Municipal staff uploaded photos showing the work done on “${report.title}”. You can view them on the tracking page.`);
 res.status(201).json({ evidence: added });
});
app.get('/api/admin/work-orders', auth, staff, (req, res) => {
 let sql = 'SELECT w.*, r.reference, r.title, r.severity, r.status report_status, r.sla_due_at FROM work_orders w JOIN reports r ON r.id=w.report_id'; const params = [];
 if (req.user.role !== 'admin') { sql += ' WHERE w.department=?'; params.push(req.user.department); }
 res.json(db.prepare(`${sql} ORDER BY w.status='Done', r.severity DESC, w.created_at DESC LIMIT 250`).all(...params));
});
app.patch('/api/admin/work-orders/:id', auth, staff, (req, res) => {
 const order = db.prepare('SELECT * FROM work_orders WHERE id=?').get(req.params.id); if (!order) return res.status(404).json({ error: 'Work order not found.' });
 if (req.user.role !== 'admin' && order.department !== req.user.department) return res.status(403).json({ error: 'You may only manage your department’s work orders.' });
 const { assignee, status } = req.body;
 if (status && !WORK_ORDER_STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid work order status.' });
 if (assignee !== undefined && String(assignee).length > 100) return res.status(422).json({ error: 'Assignee name is too long.' });
 db.prepare('UPDATE work_orders SET assignee=?, status=? WHERE id=?').run(assignee !== undefined ? String(assignee).trim() || null : order.assignee, status || order.status, order.id);
 audit(order.report_id, req.user.name, 'Work order updated', [assignee !== undefined && `assignee: ${String(assignee).trim() || 'none'}`, status && `status: ${status}`].filter(Boolean).join(', '));
 res.json({ ok: true });
});
const perfCols = ['department','total','open','resolved','overdue','sla_met_pct','avg_response_hours','avg_resolution_hours'];
app.get('/api/admin/performance', auth, staff, (req, res) => {
 const scoped = req.user.role !== 'admin';
 const rows = db.prepare(`SELECT department, COUNT(*) total, SUM(${OPEN}) open, SUM(resolved_at IS NOT NULL) resolved, SUM(${OPEN} AND sla_due_at < ?) overdue,
  ROUND(100.0 * SUM(resolved_at IS NOT NULL AND resolved_at <= sla_due_at) / NULLIF(SUM(resolved_at IS NOT NULL), 0)) sla_met_pct,
  ${hours('created_at','responded_at')} avg_response_hours, ${hours('created_at','resolved_at')} avg_resolution_hours FROM report_timing ${scoped ? 'WHERE department=?' : ''} GROUP BY department ORDER BY overdue DESC, total DESC`).all(...[now(), ...(scoped ? [req.user.department] : [])]);
 sendRows(res, req.query.format, 'civic-resolve-performance', perfCols, rows);
});
app.get('/api/admin/users', auth, staff, adminOnly, (_req, res) => res.json(db.prepare('SELECT id,name,email,role,department,created_at FROM users ORDER BY created_at').all()));
app.post('/api/admin/users', auth, staff, adminOnly, (req, res) => {
 const { name, email, password, role, department } = req.body;
 if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) return res.status(422).json({ error: 'Name and a valid email are required.' });
 if (String(password || '').length < 12) return res.status(422).json({ error: 'Password must be at least 12 characters.' });
 if (!ROLES.includes(role)) return res.status(422).json({ error: 'Invalid role.' });
 if (role !== 'admin' && !DEPARTMENTS.includes(department)) return res.status(422).json({ error: 'Supervisors and field workers need a department.' });
 if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return res.status(409).json({ error: 'A user with that email already exists.' });
 const id = randomUUID();
 db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 12), role, role === 'admin' ? 'Municipal Operations' : department, now());
 res.status(201).json({ id });
});
app.get('/api/admin/reports/:id/activities', auth, staff, (req,res) => res.json(db.prepare('SELECT * FROM activities WHERE report_id=? ORDER BY created_at DESC').all(req.params.id)));
app.get('/api/media/:id', auth, staff, (req, res) => { const f = path.join(UPLOAD_DIR, path.basename(req.params.id)); if (!fs.existsSync(f)) return res.sendStatus(404); res.sendFile(f); });
app.use((err, _req, res, _next) => { console.error(err); if (err instanceof multer.MulterError) return res.status(422).json({ error: err.message }); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); });
export { app };
if (process.env.NODE_ENV !== 'test') app.listen(process.env.PORT || 5000, () => console.log(`Civic Resolve API listening on ${process.env.PORT || 5000}`));
