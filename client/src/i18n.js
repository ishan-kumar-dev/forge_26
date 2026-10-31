// Citizen-facing strings. Staff screens stay in English for now.
// Add a language by adding a column here; missing keys fall back to English.
const strings = {
 en: {
  navReport: 'Report an issue', navTrack: 'Track report', navDashboard: 'Public dashboard', navStaff: 'Staff login', navOps: 'Operations', navOut: 'Sign out',
  reportEyebrow: 'CITIZEN PORTAL', reportTitle: 'Report a civic issue', reportIntro: 'Fields marked * are required. Avoid including private information in your description.',
  fTitle: 'What did you notice?*', fTitlePh: 'e.g. Deep pothole near the school gate', fCategory: 'Issue category*', fObserved: 'Observed date & time*',
  fDesc: 'Describe the issue', fDescPh: 'Size, obstruction, safety risk, or other useful details', fMedia: 'Photo, short video, or audio',
  fMediaHint: 'Up to 3 files, 15 MB each. Media is visible only to authorized municipal staff.', fFiles: 'file(s) selected',
  fLocation: 'Location*', fAddress: 'Address or landmark', fAddressPh: 'Street, landmark, or locality', fWard: 'Ward (optional)',
  fGps: 'Use my GPS location', fLocating: 'Locating…', fPinHint: 'Or tap the map to drop a pin.', fCoords: 'Coordinates added:', fClearPin: 'Clear pin',
  fUpdates: 'Updates (optional)', fAnon: 'Report anonymously', fName: 'Your name', fContact: 'Email or phone',
  fContactHint: 'Contact details are protected and only used for clarification or status updates.', fSubmit: 'Submit report securely →',
  okEyebrow: 'REPORT RECEIVED', okRef: 'Your reference is', okRouted: 'Your report was routed to', okPriority: 'with assistive priority level',
  okSave: 'Save this reference to track progress.', okDup: 'A nearby report may describe the same issue:', okDupTail: 'Staff will review before merging anything.', okTrack: 'Track this report →',
  trEyebrow: 'TRANSPARENT TRACKING', trTitle: 'Follow your report', trIntro: 'Enter the reference you received when the report was submitted.',
  trFind: 'Find report', trMissing: 'We couldn’t find that reference. Check the code and try again.', trPriority: 'Priority',
  trAi: 'AI recommendation', trAiTail: 'This is assistive information, reviewed by municipal staff.',
  trClarify: 'The municipal team asked a question about this report', trReply: 'Your reply', trSend: 'Send reply', trSent: 'Reply sent. Thank you.',
  trEvidence: 'Photos from the municipal team', trBefore: 'Before', trAfter: 'After', trMerged: 'This report was merged into',
  ok: 'Report submitted.', geoNone: 'Geolocation is unavailable in this browser.', geoOk: 'Current location added.', geoDenied: 'Location permission was not granted.', failed: 'Submission failed.'
 },
 hi: {
  navReport: 'समस्या दर्ज करें', navTrack: 'शिकायत की स्थिति', navDashboard: 'सार्वजनिक डैशबोर्ड', navStaff: 'कर्मचारी लॉगिन', navOps: 'संचालन', navOut: 'साइन आउट',
  reportEyebrow: 'नागरिक पोर्टल', reportTitle: 'नागरिक समस्या दर्ज करें', reportIntro: '* वाले फ़ील्ड ज़रूरी हैं। विवरण में निजी जानकारी न लिखें।',
  fTitle: 'आपने क्या देखा?*', fTitlePh: 'जैसे: स्कूल गेट के पास गहरा गड्ढा', fCategory: 'समस्या का प्रकार*', fObserved: 'देखने की तारीख और समय*',
  fDesc: 'समस्या का विवरण', fDescPh: 'आकार, रुकावट, सुरक्षा खतरा या अन्य उपयोगी जानकारी', fMedia: 'फ़ोटो, छोटा वीडियो या ऑडियो',
  fMediaHint: 'अधिकतम 3 फ़ाइलें, हर एक 15 MB तक। मीडिया केवल अधिकृत नगर कर्मचारी देख सकते हैं।', fFiles: 'फ़ाइल चुनी गई',
  fLocation: 'स्थान*', fAddress: 'पता या पहचान स्थल', fAddressPh: 'गली, पहचान स्थल या मोहल्ला', fWard: 'वार्ड (वैकल्पिक)',
  fGps: 'मेरी GPS लोकेशन लें', fLocating: 'लोकेशन ढूँढ रहे हैं…', fPinHint: 'या नक्शे पर टैप करके पिन लगाएँ।', fCoords: 'निर्देशांक जोड़े गए:', fClearPin: 'पिन हटाएँ',
  fUpdates: 'सूचनाएँ (वैकल्पिक)', fAnon: 'गुमनाम रूप से दर्ज करें', fName: 'आपका नाम', fContact: 'ईमेल या फ़ोन',
  fContactHint: 'संपर्क जानकारी सुरक्षित रहती है और केवल स्पष्टीकरण या स्थिति अपडेट के लिए उपयोग होती है।', fSubmit: 'सुरक्षित रूप से जमा करें →',
  okEyebrow: 'शिकायत प्राप्त हुई', okRef: 'आपका संदर्भ नंबर है', okRouted: 'आपकी शिकायत भेजी गई है:', okPriority: 'सहायक प्राथमिकता स्तर',
  okSave: 'स्थिति देखने के लिए यह नंबर सँभाल कर रखें।', okDup: 'पास की एक शिकायत शायद यही समस्या बताती है:', okDupTail: 'जोड़ने से पहले कर्मचारी जाँच करेंगे।', okTrack: 'इस शिकायत की स्थिति देखें →',
  trEyebrow: 'पारदर्शी ट्रैकिंग', trTitle: 'अपनी शिकायत देखें', trIntro: 'शिकायत दर्ज करते समय मिला संदर्भ नंबर डालें।',
  trFind: 'शिकायत खोजें', trMissing: 'यह संदर्भ नंबर नहीं मिला। कृपया जाँच कर दोबारा कोशिश करें।', trPriority: 'प्राथमिकता',
  trAi: 'AI सुझाव', trAiTail: 'यह केवल सहायक जानकारी है, जिसकी जाँच नगर कर्मचारी करते हैं।',
  trClarify: 'नगर टीम ने इस शिकायत के बारे में एक सवाल पूछा है', trReply: 'आपका जवाब', trSend: 'जवाब भेजें', trSent: 'जवाब भेज दिया गया। धन्यवाद।',
  trEvidence: 'नगर टीम की फ़ोटो', trBefore: 'पहले', trAfter: 'बाद में', trMerged: 'यह शिकायत इसमें जोड़ दी गई है:',
  ok: 'शिकायत जमा हो गई।', geoNone: 'इस ब्राउज़र में लोकेशन उपलब्ध नहीं है।', geoOk: 'मौजूदा लोकेशन जोड़ दी गई।', geoDenied: 'लोकेशन की अनुमति नहीं मिली।', failed: 'जमा नहीं हो सका।'
 }
};
export const languages = { en: 'English', hi: 'हिन्दी' };
const read = () => { try { return localStorage.getItem('civic_lang') || 'en'; } catch { return 'en'; } };
export const lang = strings[read()] ? read() : 'en';
document.documentElement.lang = lang;
export const t = key => strings[lang][key] ?? strings.en[key] ?? key;
// Reload is the simplest way to re-render everything in the new language.
export function setLang(code) { try { localStorage.setItem('civic_lang', code); } catch {} location.reload(); }
