import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import request from 'supertest';

const testDb = path.join(process.cwd(), 'test', 'features-test.db');
fs.rmSync(testDb, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = testDb;
process.env.JWT_SECRET = 'test-only-secret';
process.env.ADMIN_EMAIL = 'admin@city.test';
process.env.ADMIN_PASSWORD = 'Temporary-Test-Only-Password-42';
process.env.GEMINI_API_KEY = '';
const { app, db } = await import('../index.js');

// 1x1 PNG, enough for multer's mimetype check.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const pothole = { title: 'Pothole outside bus depot', category: 'Road damage', description: 'Deep hole in the left lane.', latitude: '12.9716', longitude: '77.5946', ward: 'Ward 3' };
const login = async (email, password) => (await request(app).post('/api/auth/login').send({ email, password }).expect(200)).body.token;
const as = token => ({ Authorization: `Bearer ${token}` });
let admin, first, second;

test('nearby report of the same kind is flagged and counted against the original', async () => {
 admin = await login('admin@city.test', 'Temporary-Test-Only-Password-42');
 first = (await request(app).post('/api/reports').send(pothole).expect(201)).body.reference;
 const dup = await request(app).post('/api/reports').send({ ...pothole, title: 'Same pothole again', latitude: '12.9720' }).expect(201);
 second = dup.body.reference;
 assert.equal(dup.body.duplicateHint, first);
 // A streetlight at the same spot is a different problem, not a duplicate.
 const light = await request(app).post('/api/reports').send({ ...pothole, title: 'Streetlight out', category: 'Streetlight' }).expect(201);
 assert.equal(light.body.duplicateHint, null);
 assert.equal(db.prepare('SELECT duplicate_count FROM reports WHERE reference=?').get(first).duplicate_count, 1);
});

test('link-stuffed reports are rejected', async () => {
 const res = await request(app).post('/api/reports').send({ ...pothole, description: 'http://a.io http://b.io http://c.io buy now' }).expect(422);
 assert.match(res.body.errors[0], /spam/);
});

test('staff can merge a duplicate into the original', async () => {
 const id = db.prepare('SELECT id FROM reports WHERE reference=?').get(second).id;
 await request(app).patch(`/api/admin/reports/${id}`).set(as(admin)).send({ mergeInto: 'CR-0000-NOPE00' }).expect(422);
 await request(app).patch(`/api/admin/reports/${id}`).set(as(admin)).send({ mergeInto: first }).expect(200);
 const merged = (await request(app).get(`/api/reports/${second}`).expect(200)).body.report;
 assert.equal(merged.status, 'Closed');
 assert.equal(merged.duplicate_of, first);
 assert.equal(db.prepare('SELECT duplicate_count FROM reports WHERE reference=?').get(first).duplicate_count, 2);
});

test('clarification round trip between staff and citizen', async () => {
 const id = db.prepare('SELECT id FROM reports WHERE reference=?').get(first).id;
 await request(app).post(`/api/reports/${first}/clarification`).send({ note: 'Unprompted reply' }).expect(409);
 await request(app).patch(`/api/admin/reports/${id}`).set(as(admin)).send({ clarification: 'Which lane is the pothole in?' }).expect(200);
 assert.equal((await request(app).get(`/api/reports/${first}`)).body.awaitingClarification, true);
 await request(app).post(`/api/reports/${first}/clarification`).send({ note: 'Left lane, heading north.' }).expect(201);
 const tracked = (await request(app).get(`/api/reports/${first}`)).body;
 assert.equal(tracked.awaitingClarification, false);
 assert.ok(tracked.activities.some(a => a.action === 'Clarification provided' && a.actor === 'Citizen'));
});

test('department supervisor only sees and edits their own department', async () => {
 await request(app).post('/api/admin/users').set(as(admin)).send({ name: 'Drain Lead', email: 'drain@city.test', password: 'short', role: 'supervisor', department: 'Drainage' }).expect(422);
 await request(app).post('/api/admin/users').set(as(admin)).send({ name: 'Drain Lead', email: 'drain@city.test', password: 'Drainage-Lead-Pass-1', role: 'supervisor', department: 'Drainage' }).expect(201);
 const sup = await login('drain@city.test', 'Drainage-Lead-Pass-1');
 await request(app).get('/api/admin/users').set(as(sup)).expect(403);
 assert.equal((await request(app).get('/api/admin/reports').set(as(sup)).expect(200)).body.length, 0);
 const id = db.prepare('SELECT id FROM reports WHERE reference=?').get(first).id;
 await request(app).patch(`/api/admin/reports/${id}`).set(as(sup)).send({ status: 'Verified' }).expect(403);
});

test('assignment creates a work order that can be given to a crew', async () => {
 const id = db.prepare('SELECT id FROM reports WHERE reference=?').get(first).id;
 await request(app).patch(`/api/admin/reports/${id}`).set(as(admin)).send({ status: 'Assigned' }).expect(200);
 const orders = (await request(app).get('/api/admin/work-orders').set(as(admin)).expect(200)).body;
 assert.equal(orders.length, 1);
 assert.equal(orders[0].reference, first);
 await request(app).patch(`/api/admin/work-orders/${orders[0].id}`).set(as(admin)).send({ assignee: 'Crew 4', status: 'In Progress' }).expect(200);
 assert.equal(db.prepare('SELECT assignee FROM work_orders WHERE id=?').get(orders[0].id).assignee, 'Crew 4');
});

test('after-photos are visible to the citizen and resolution time shows on the dashboard', async () => {
 const id = db.prepare('SELECT id FROM reports WHERE reference=?').get(first).id;
 await request(app).post(`/api/admin/reports/${id}/evidence`).set(as(admin)).field('stage', 'after').attach('evidence', png, { filename: 'fixed.png', contentType: 'image/png' }).expect(201);
 await request(app).patch(`/api/admin/reports/${id}`).set(as(admin)).send({ status: 'Resolved' }).expect(200);
 const tracked = (await request(app).get(`/api/reports/${first}`)).body;
 assert.equal(tracked.evidence.length, 1);
 assert.equal(tracked.evidence[0].stage, 'after');
 await request(app).get(`/api/reports/${first}/evidence/${tracked.evidence[0].id}`).expect(200).expect('Content-Type', /image\/png/);
 await request(app).get(`/api/reports/${second}/evidence/${tracked.evidence[0].id}`).expect(404);
 const dash = (await request(app).get('/api/public/dashboard')).body;
 assert.equal(typeof dash.totals.avgResolutionHours, 'number');
 assert.ok(dash.byWard.some(w => w.ward === 'Ward 3'));
});

test('exports are anonymized CSV', async () => {
 const open = await request(app).get('/api/public/export?format=csv').expect(200).expect('Content-Type', /text\/csv/);
 const [header] = open.text.split('\n');
 assert.ok(header.startsWith('reference,category,status'));
 assert.ok(!/title|address|contact|reporter/.test(header));
 const perf = await request(app).get('/api/admin/performance?format=csv').set(as(admin)).expect(200);
 assert.match(perf.text, /^department,total,open,resolved,overdue/);
 await request(app).get('/api/admin/performance').expect(401);
});

test.after(() => {
 for (const r of db.prepare('SELECT evidence_json FROM reports').all()) for (const e of JSON.parse(r.evidence_json)) fs.rmSync(path.join(process.cwd(), 'uploads', e.id), { force: true });
 db.close(); for (const f of [testDb, `${testDb}-wal`, `${testDb}-shm`]) fs.rmSync(f, { force: true });
});
