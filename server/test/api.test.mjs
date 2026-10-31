import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import request from 'supertest';

const testDb = path.join(process.cwd(), 'test', 'api-test.db');
fs.rmSync(testDb, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = testDb;
process.env.JWT_SECRET = 'test-only-secret';
process.env.ADMIN_EMAIL = 'admin@city.test';
process.env.ADMIN_PASSWORD = 'Temporary-Test-Only-Password-42';
process.env.GEMINI_API_KEY = '';
const { app, db } = await import('../index.js');

test('citizen report can be submitted, publicly tracked, and routed by a staff member', async () => {
 const created = await request(app).post('/api/reports').send({ title: 'Large pothole near hospital entrance', category: 'Road damage', description: 'Cars are swerving around a deep pothole near the hospital.', address: 'North Gate Road', ward: 'Ward 7', observed_at: '2026-11-01T10:00:00Z' }).expect(201);
 assert.match(created.body.reference, /^CR-\d{4}-[A-Z0-9]{6}$/);
 assert.equal(created.body.department, 'Roads & Public Works');
 const tracked = await request(app).get(`/api/reports/${created.body.reference}`).expect(200);
 assert.equal(tracked.body.report.reporter_contact, undefined);
 assert.equal(tracked.body.activities[0].action, 'Submitted');

 const login = await request(app).post('/api/auth/login').send({ email: 'admin@city.test', password: 'Temporary-Test-Only-Password-42' }).expect(200);
 const queue = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${login.body.token}`).expect(200);
 assert.equal(queue.body.length, 1);
 await request(app).patch(`/api/admin/reports/${queue.body[0].id}`).set('Authorization', `Bearer ${login.body.token}`).send({ status: 'Assigned', note: 'Crew scheduled for inspection.' }).expect(200);
 const after = await request(app).get(`/api/reports/${created.body.reference}`).expect(200);
 assert.equal(after.body.report.status, 'Assigned');
});

test.after(() => { db.close(); fs.rmSync(testDb, { force: true }); });
