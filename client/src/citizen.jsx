import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from './api';
import { Layout } from './layout';
import { t } from './i18n';
import { categories, formatDate } from './constants';

const MapPicker = lazy(() => import('./mappicker'));

export function Report() {
 // datetime-local wants local wall-clock time, toISOString alone would give UTC.
 const [form, setForm] = useState({ category: 'Other', observed_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), is_anonymous: false }); const [files, setFiles] = useState([]); const [locating, setLocating] = useState(false); const [submitted, setSubmitted] = useState(null); const [busy, setBusy] = useState(false);
 const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
 const pin = (latitude, longitude) => setForm(f => ({ ...f, latitude, longitude }));
 const locate = () => { if (!navigator.geolocation) return toast.error(t('geoNone')); setLocating(true); navigator.geolocation.getCurrentPosition(p => { pin(p.coords.latitude.toFixed(6), p.coords.longitude.toFixed(6)); setLocating(false); toast.success(t('geoOk')); }, () => { setLocating(false); toast.error(t('geoDenied')); }, { enableHighAccuracy: true, timeout: 10000 }); };
 const submit = async e => { e.preventDefault(); if (busy) return; setBusy(true); const data = new FormData(); Object.entries(form).forEach(([k, v]) => v !== undefined && v !== '' && data.append(k, String(v))); files.forEach(f => data.append('media', f)); try { const { data: result } = await api.post('/api/reports', data); setSubmitted(result); toast.success(t('ok')); } catch (err) { toast.error(err.response?.data?.errors?.[0] || err.response?.data?.error || t('failed')); } finally { setBusy(false); } };
 if (submitted) return <Layout><section className="confirmation"><p className="eyebrow">{t('okEyebrow')}</p><h1>{t('okRef')} <em>{submitted.reference}</em></h1><p>{t('okRouted')} <b>{submitted.department}</b> · {t('okPriority')} <b>{submitted.severity}/5</b>. {t('okSave')}</p>{submitted.duplicateHint && <p className="notice">{t('okDup')} {submitted.duplicateHint}. {t('okDupTail')}</p>}<Link className="button" to={`/track?ref=${submitted.reference}`}>{t('okTrack')}</Link></section></Layout>;
 return <Layout><section className="pageIntro"><p className="eyebrow">{t('reportEyebrow')}</p><h1>{t('reportTitle')}</h1><p>{t('reportIntro')}</p></section><form className="reportForm" onSubmit={submit}>
  <label>{t('fTitle')}<input required name="title" maxLength="160" placeholder={t('fTitlePh')} onChange={update}/></label>
  <div className="two"><label>{t('fCategory')}<select name="category" value={form.category} onChange={update}>{categories.map(x => <option key={x}>{x}</option>)}</select></label><label>{t('fObserved')}<input required type="datetime-local" name="observed_at" value={form.observed_at} onChange={update}/></label></div>
  <label>{t('fDesc')}<textarea name="description" maxLength="2000" rows="4" placeholder={t('fDescPh')} onChange={update}/></label>
  <label>{t('fMedia')} <input aria-label={t('fMedia')} type="file" multiple accept="image/*,video/*,audio/*" onChange={e => setFiles([...e.target.files].slice(0, 3))}/><small>{files.length ? `${files.length} ${t('fFiles')}` : t('fMediaHint')}</small></label>
  <fieldset><legend>{t('fLocation')}</legend><label>{t('fAddress')}<input name="address" maxLength="300" placeholder={t('fAddressPh')} onChange={update}/></label><div className="two"><label>{t('fWard')}<input name="ward" maxLength="80" onChange={update}/></label><button type="button" className="secondary" onClick={locate}>{locating ? t('fLocating') : t('fGps')}</button></div>
   <small>{t('fPinHint')}</small><Suspense fallback={<div className="pickerMap"/>}><MapPicker latitude={form.latitude} longitude={form.longitude} onPick={pin}/></Suspense>
   {form.latitude && <p className="locationSet">✓ {t('fCoords')} {form.latitude}, {form.longitude} <button type="button" className="linkBtn" onClick={() => pin(undefined, undefined)}>{t('fClearPin')}</button></p>}</fieldset>
  <fieldset><legend>{t('fUpdates')}</legend><label className="check"><input type="checkbox" name="is_anonymous" checked={form.is_anonymous} onChange={update}/> {t('fAnon')}</label>{!form.is_anonymous && <div className="two"><label>{t('fName')}<input name="reporter_name" maxLength="100" onChange={update}/></label><label>{t('fContact')}<input name="reporter_contact" maxLength="150" onChange={update}/></label></div>}<small>{t('fContactHint')}</small></fieldset>
  <button className="button" type="submit" disabled={busy}>{t('fSubmit')}</button></form></Layout>;
}

export function Track() {
 const [ref, setRef] = useState(new URLSearchParams(location.search).get('ref') || ''); const [result, setResult] = useState(null); const [reply, setReply] = useState('');
 const fetchReport = async code => { try { setResult((await api.get(`/api/reports/${code.trim()}`)).data); } catch { setResult('missing'); } };
 const lookup = e => { e.preventDefault(); fetchReport(ref); };
 useEffect(() => { if (ref) fetchReport(ref); }, []);
 const sendReply = async e => { e.preventDefault(); try { await api.post(`/api/reports/${result.report.reference}/clarification`, { note: reply }); setReply(''); toast.success(t('trSent')); fetchReport(result.report.reference); } catch (err) { toast.error(err.response?.data?.error || t('failed')); } };
 const r = result && result !== 'missing' ? result.report : null;
 return <Layout><section className="trackWrap"><div className="pageIntro"><p className="eyebrow">{t('trEyebrow')}</p><h1>{t('trTitle')}</h1><p>{t('trIntro')}</p></div><form className="lookup" onSubmit={lookup}><input value={ref} onChange={e => setRef(e.target.value.toUpperCase())} placeholder="CR-2026-XXXXXX" required/><button className="button">{t('trFind')}</button></form>
  {result === 'missing' && <p className="notice">{t('trMissing')}</p>}
  {r && <article className="reportDetail"><div className="detailHead"><div><span className="badge">{r.status}</span><h2>{r.title}</h2><p>{r.reference} · {r.category} · {t('trPriority')} {r.severity}/5</p></div><p>{formatDate(r.created_at)}</p></div>
   {r.status === 'Closed' && r.duplicate_of && <p className="notice">{t('trMerged')} <a href={`/track?ref=${r.duplicate_of}`}>{r.duplicate_of}</a></p>}
   {result.awaitingClarification && <form className="clarify" onSubmit={sendReply}><b>{t('trClarify')}:</b><p>{[...result.activities].reverse().find(a => a.action === 'Clarification requested')?.note}</p><label>{t('trReply')}<textarea required minLength="2" maxLength="1000" rows="3" value={reply} onChange={e => setReply(e.target.value)}/></label><button className="button">{t('trSend')}</button></form>}
   <div className="timeline">{result.activities.map((a, i) => <div key={i}><i></i><b>{a.action}</b><time>{formatDate(a.created_at)}</time>{a.note && <p>{a.note}</p>}</div>)}</div>
   {result.evidence.length > 0 && <div className="evidence"><h3>{t('trEvidence')}</h3><div>{result.evidence.map(e => <figure key={e.id}><img loading="lazy" src={`/api/reports/${r.reference}/evidence/${e.id}`} alt={`${e.stage} photo`}/><figcaption>{e.stage === 'before' ? t('trBefore') : t('trAfter')} · {formatDate(e.at)}</figcaption></figure>)}</div></div>}
   <p className="assistive">{t('trAi')}: {r.suggested_category || r.category} ({r.analysis_source}). {t('trAiTail')}</p></article>}</section></Layout>;
}
