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

test('media analysis result is validated before it can touch a report', async () => {
 const { parseMediaResult, analyzeMedia } = await import('../services/triage.js');
 const ok = parseMediaResult(JSON.stringify({ transcript: 'Naali band hai [The drain is blocked]', language: 'Hindi', observations: 'Overflowing drain across the lane', category: 'Drainage', department: 'Drainage', severity: 4, confidence: 0.8, reasoning: 'Blocked drain' }));
 assert.equal(ok.severity, 4);
 assert.equal(ok.slaHours, 24);
 assert.match(ok.reasoning, /staff must review/);
 assert.throws(() => parseMediaResult(JSON.stringify({ transcript: 'x', category: 'Aliens', department: 'Drainage', severity: 3 })), /Malformed/);
 assert.throws(() => parseMediaResult(JSON.stringify({ category: 'Drainage', department: 'Drainage', severity: 9 })), /Malformed/);
 assert.equal(await analyzeMedia({ media: [{ mime: 'audio/mpeg', filePath: 'x' }] }), null);
});
