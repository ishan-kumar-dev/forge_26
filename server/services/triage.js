import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const rules = {
 'Road damage': ['Roads & Public Works', 4], 'Water supply': ['Water Supply', 4], Drainage: ['Drainage', 4], Sanitation: ['Sanitation', 3], Streetlight: ['Electrical Maintenance', 3], 'Public safety': ['Emergency Response', 5], Parks: ['Parks & Urban Forestry', 3], Other: ['Municipal Operations', 2]
};
const keywords = [['pothole','Road damage'],['road','Road damage'],['leak','Water supply'],['waterlogging','Drainage'],['sewage','Drainage'],['garbage','Sanitation'],['waste','Sanitation'],['streetlight','Streetlight'],['tree','Parks'],['fallen','Public safety'],['fire','Public safety'],['danger','Public safety']];
function fallback(input) {
 const text = `${input.title || ''} ${input.description || ''}`.toLowerCase(); let category = input.category || 'Other';
 if (category === 'Other') category = keywords.find(([key]) => text.includes(key))?.[1] || 'Other';
 let [department, severity] = rules[category] || rules.Other;
 if (/school|hospital|accident|blocked|overflow|live wire|injur/.test(text)) severity = Math.min(5, severity + 1);
 if (input.potentialDuplicate) severity = Math.min(5, severity + 1);
 return { category, department, severity, confidence: .58, reasoning: 'Rule-based assistive triage from the selected category and submitted description. A municipal reviewer must verify this recommendation.', source: 'Rule-based fallback', slaHours: severity >= 5 ? 4 : severity === 4 ? 24 : 72 };
}
export async function analyzeReport(input) {
 const base = fallback(input); const key = process.env.GEMINI_API_KEY;
 if (!key || key === 'your_gemini_api_key_here') return base;
 try {
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash', generationConfig: { responseMimeType: 'application/json', temperature: .1 } });
  const images = (input.media || []).filter(m => m.mime?.startsWith('image/') && m.filePath && m.size <= 4 * 1024 * 1024 && fs.existsSync(m.filePath)).slice(0, 2).map(m => ({ inlineData: { data: fs.readFileSync(m.filePath).toString('base64'), mimeType: m.mime } }));
  const prompt = `You are an assistive municipal complaint triage system. Analyze this report${images.length ? ' and the attached photos' : ''}; never make a final authority decision. Return JSON only with category (one of ${Object.keys(rules).join(', ')}), department (one of ${[...new Set(Object.values(rules).map(x=>x[0]))].join(', ')}), severity integer 1-5, confidence number 0-1, reasoning max 250 chars, slaHours (4,24,72). Report: ${JSON.stringify({ title: input.title, description: input.description, category: input.category, address: input.address, ward: input.ward, hasMedia: input.media?.length > 0, potentialDuplicate: !!input.potentialDuplicate })}`;
  const parsed = JSON.parse((await model.generateContent([prompt, ...images])).response.text());
  if (!rules[parsed.category] || !Number.isInteger(parsed.severity) || parsed.severity < 1 || parsed.severity > 5) throw new Error('Malformed AI response');
  return { ...base, ...parsed, confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || base.confidence)), reasoning: `${String(parsed.reasoning || '').slice(0,250)} Municipal staff must review before action.`, source: images.length ? 'Gemini assistive vision and text analysis' : 'Gemini assistive text analysis' };
 } catch (error) { console.warn('AI analysis unavailable:', error.message); return { ...base, reasoning: `${base.reasoning} AI service was unavailable for this submission.` }; }
}
