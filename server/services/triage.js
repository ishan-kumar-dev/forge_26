import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';

const rules = {
 'Road damage': ['Roads & Public Works', 4], 'Water supply': ['Water Supply', 4], Drainage: ['Drainage', 4], Sanitation: ['Sanitation', 3], Streetlight: ['Electrical Maintenance', 3], 'Public safety': ['Emergency Response', 5], Parks: ['Parks & Urban Forestry', 3], Other: ['Municipal Operations', 2]
};
export const CATEGORIES = Object.keys(rules);
export const DEPARTMENTS = [...new Set(Object.values(rules).map(x => x[0]))];
const keywords = [['pothole','Road damage'],['road','Road damage'],['leak','Water supply'],['waterlogging','Drainage'],['sewage','Drainage'],['garbage','Sanitation'],['waste','Sanitation'],['streetlight','Streetlight'],['tree','Parks'],['fallen','Public safety'],['fire','Public safety'],['danger','Public safety']];
function fallback(input) {
 const text = `${input.title || ''} ${input.description || ''}`.toLowerCase(); let category = input.category || 'Other';
 if (category === 'Other') category = keywords.find(([key]) => text.includes(key))?.[1] || 'Other';
 let [department, severity] = rules[category] || rules.Other;
 if (/school|hospital|accident|blocked|overflow|live wire|injur/.test(text)) severity = Math.min(5, severity + 1);
 if (input.potentialDuplicate) severity = Math.min(5, severity + 1);
 return { category, department, severity, confidence: .58, reasoning: 'Rule-based assistive triage from the selected category and submitted description. A municipal reviewer must verify this recommendation.', source: 'Rule-based fallback', slaHours: slaFor(severity) };
}
export const slaFor = severity => severity >= 5 ? 4 : severity === 4 ? 24 : 72;
export const geminiKey = () => { const key = process.env.GEMINI_API_KEY; return key && key !== 'your_gemini_api_key_here' ? key : null; };
const geminiModel = key => new GoogleGenerativeAI(key).getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json', temperature: .1 } });
export async function analyzeReport(input) {
 const base = fallback(input); const key = geminiKey();
 if (!key) return base;
 try {
  const model = geminiModel(key);
  const images = (input.media || []).filter(m => m.mime?.startsWith('image/') && m.filePath && m.size <= 4 * 1024 * 1024 && fs.existsSync(m.filePath)).slice(0, 2).map(m => ({ inlineData: { data: fs.readFileSync(m.filePath).toString('base64'), mimeType: m.mime } }));
  const prompt = `You are an assistive municipal complaint triage system. Analyze this report${images.length ? ' and the attached photos' : ''}; never make a final authority decision. Return JSON only with category (one of ${CATEGORIES.join(', ')}), department (one of ${DEPARTMENTS.join(', ')}), severity integer 1-5, confidence number 0-1, reasoning max 250 chars. Report: ${JSON.stringify({ title: input.title, description: input.description, category: input.category, address: input.address, ward: input.ward, hasMedia: input.media?.length > 0, potentialDuplicate: !!input.potentialDuplicate })}`;
  const parsed = JSON.parse((await model.generateContent([prompt, ...images])).response.text());
  if (!rules[parsed.category] || !DEPARTMENTS.includes(parsed.department) || !Number.isInteger(parsed.severity) || parsed.severity < 1 || parsed.severity > 5) throw new Error('Malformed AI response');
  return { ...base, ...parsed, slaHours: slaFor(parsed.severity), confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || base.confidence)), reasoning: `${String(parsed.reasoning || '').slice(0,250)} Municipal staff must review before action.`, source: images.length ? 'Gemini assistive vision and text analysis' : 'Gemini assistive text analysis' };
 } catch (error) { console.warn('AI analysis unavailable:', error.message); return { ...base, reasoning: `${base.reasoning} AI service was unavailable for this submission.` }; }
}

// Audio and video go through Gemini's file API: a 15 MB upload is ~20 MB once base64'd, past the inline request limit,
// and videos need a processing step on Google's side before they can be read.
export const isTimeMedia = m => /^(audio|video)\//.test(m.mime || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function uploadForAnalysis(files, m) {
 const up = await files.uploadFile(m.filePath, { mimeType: m.mime, displayName: m.id });
 let file = up.file;
 for (let i = 0; file.state === 'PROCESSING' && i < 40; i++) { await sleep(3000); file = await files.getFile(file.name); }
 if (file.state !== 'ACTIVE') { files.deleteFile(file.name).catch(() => {}); throw new Error(`Gemini could not process ${m.mime} (${file.state})`); }
 return file;
}
// Validates the model's JSON so a bad answer can't put an unknown category or department on a report.
export function parseMediaResult(text) {
 const p = JSON.parse(text);
 const transcript = String(p.transcript ?? '').trim().slice(0, 4000);
 const observations = String(p.observations ?? '').trim().slice(0, 1000);
 if (!rules[p.category] || !DEPARTMENTS.includes(p.department) || !Number.isInteger(p.severity) || p.severity < 1 || p.severity > 5) throw new Error('Malformed AI response');
 return { transcript, observations, language: String(p.language || '').slice(0, 40), category: p.category, department: p.department, severity: p.severity, confidence: Math.max(0, Math.min(1, Number(p.confidence) || .5)), reasoning: `${String(p.reasoning || '').slice(0, 250)} Municipal staff must review before action.`, slaHours: slaFor(p.severity) };
}
// Transcribes speech and describes visible defects in a report's audio/video files. Returns null without a key.
export async function analyzeMedia(input) {
 const key = geminiKey(); if (!key) return null;
 const media = (input.media || []).filter(m => isTimeMedia(m) && m.filePath && fs.existsSync(m.filePath));
 if (!media.length) return null;
 const files = new GoogleAIFileManager(key); const uploaded = [];
 try {
  for (const m of media) uploaded.push(await uploadForAnalysis(files, m));
  const kinds = [...new Set(media.map(m => m.mime.split('/')[0]))].join(' and ');
  const prompt = `You are an assistive municipal complaint triage system; never make a final authority decision. The citizen attached ${kinds}. 1) Transcribe everything said, word for word, in the original language; if not English, add an English translation in brackets after it. Use an empty string if nobody speaks. 2) In observations, describe only infrastructure problems actually visible or audible (e.g. pothole size, standing water, sparking wire, overflowing drain). Do not describe or identify people, faces, vehicles' number plates, or voices. 3) Suggest triage. Return JSON only with transcript, language, observations (max 600 chars), category (one of ${CATEGORIES.join(', ')}), department (one of ${DEPARTMENTS.join(', ')}), severity integer 1-5, confidence number 0-1, reasoning max 250 chars. Written report: ${JSON.stringify({ title: input.title, description: input.description, category: input.category })}`;
  const res = await geminiModel(key).generateContent([prompt, ...uploaded.map(f => ({ fileData: { fileUri: f.uri, mimeType: f.mimeType } }))]);
  return { ...parseMediaResult(res.response.text()), source: `Gemini assistive ${kinds} analysis` };
 } finally { for (const f of uploaded) files.deleteFile(f.name).catch(() => {}); }
}
