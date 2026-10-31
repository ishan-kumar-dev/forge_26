import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReport } from '../services/triage.js';

test('raises severity for safety-critical drainage report', async () => {
 const triage = await analyzeReport({ title: 'Sewage overflow near hospital', description: 'Overflow is blocking the road and dangerous for pedestrians', category: 'Drainage', media: [] });
 assert.equal(triage.category, 'Drainage');
 assert.equal(triage.department, 'Drainage');
 assert.equal(triage.severity, 5);
 assert.equal(triage.source, 'Rule-based fallback');
});

test('detects a road issue when the citizen is unsure of category', async () => {
 const triage = await analyzeReport({ title: 'Large pothole causes traffic', description: 'Cars are swerving around the pothole', category: 'Other', media: [] });
 assert.equal(triage.category, 'Road damage');
 assert.equal(triage.department, 'Roads & Public Works');
 assert.ok(triage.slaHours <= 24);
});
