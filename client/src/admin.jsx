import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from './api';
import { Layout } from './layout';
import { departments, formatDate, statuses } from './constants';

const me = () => { try { return JSON.parse(atob(localStorage.getItem('civic_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
const failed = (err, fallback) => { if (err.response?.status === 401) { localStorage.removeItem('civic_token'); location.href = '/staff-login'; } else toast.error(err.response?.data?.error || fallback); };
const isOverdue = r => r.sla_due_at && !['Resolved', 'Closed'].includes(r.status) && new Date(r.sla_due_at) < new Date();
const toLocalInput = iso => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
// Staff files need the bearer token, so they can't be plain <img src> links.
async function openFile(url) { try { const { data } = await api.get(url, { responseType: 'blob' }); window.open(URL.createObjectURL(data), '_blank'); } catch (e) { failed(e, 'Could not open file.'); } }
async function download(url, name) { try { const { data } = await api.get(url, { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = name; a.click(); } catch (e) { failed(e, 'Download failed.'); } }

function ReportCard({ r, update, reload }) {
 const [open, setOpen] = useState(false), [history, setHistory] = useState([]), [sla, setSla] = useState(toLocalInput(r.sla_due_at)), [merge, setMerge] = useState(''), [question, setQuestion] = useState(''), [stage, setStage] = useState('after');
 useEffect(() => { if (open) api.get(`/api/admin/reports/${r.id}/activities`).then(x => setHistory(x.data)).catch(e => failed(e, 'Could not load history.')); }, [open, r.updated_at]);
 const upload = async e => { const files = [...e.target.files]; if (!files.length) return; const data = new FormData(); data.append('stage', stage); files.forEach(f => data.append('evidence', f)); try { await api.post(`/api/admin/reports/${r.id}/evidence`, data); toast.success('Evidence uploaded.'); reload(); } catch (err) { failed(err, 'Upload failed.'); } e.target.value = ''; };
 return <article className={isOverdue(r) ? 'overdue' : ''}><div><span className={`severity s${r.severity}`}>P{r.severity}</span><span className="badge">{r.status}</span>{isOverdue(r) && <span className="badge late">SLA overdue</span>}{r.duplicate_count > 0 && <span className="badge">{r.duplicate_count} duplicate{r.duplicate_count > 1 ? 's' : ''}</span>}<h2>{r.title}</h2><p>{r.reference} · {r.category} · {r.ward || r.address || 'No address'} · {formatDate(r.created_at)}</p><p>SLA due {formatDate(r.sla_due_at)}{r.reporter_contact ? ' · citizen contact on file' : r.is_anonymous ? ' · anonymous' : ''}</p><p className="aiNote">Assistive triage: {r.suggested_category} · {r.department} · {r.analysis_source} · confidence {Math.round((r.ai_confidence || 0) * 100)}%</p>{r.ai_reasoning && <p className="aiNote">{r.ai_reasoning}</p>}{r.duplicate_of && <p className="notice">{r.status === 'Closed' ? 'Merged into' : 'Possible duplicate of'} {r.duplicate_of}</p>}<button className="linkBtn" onClick={() => setOpen(!open)}>{open ? 'Hide details ▲' : 'Details, evidence & history ▼'}</button></div>
  <div className="queueControls"><select aria-label="Status" value={r.status} onChange={e => update(r.id, { status: e.target.value })}>{statuses.map(s => <option key={s}>{s}</option>)}</select><select aria-label="Department" value={r.department} onChange={e => update(r.id, { department: e.target.value })}>{departments.map(d => <option key={d}>{d}</option>)}</select><select aria-label="Priority" value={r.severity} onChange={e => update(r.id, { severity: +e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Priority {n}</option>)}</select></div>
  {open && <div className="cardMore">
   {r.description && <p>{r.description}</p>}
   {r.media.length > 0 && <p>Citizen media: {r.media.map(m => <button key={m.id} className="linkBtn" onClick={() => openFile(`/api/media/${m.id}`)}>{m.name}</button>)}</p>}
   {r.evidence.length > 0 && <p>Staff evidence: {r.evidence.map(m => <button key={m.id} className="linkBtn" onClick={() => openFile(`/api/media/${m.id}`)}>{m.stage}: {m.name}</button>)}</p>}
   <div className="miniForms">
    <form onSubmit={e => { e.preventDefault(); update(r.id, { sla_due_at: new Date(sla).toISOString() }); }}><label>SLA deadline<input type="datetime-local" value={sla} onChange={e => setSla(e.target.value)} required/></label><button className="secondary">Set</button></form>
    <form onSubmit={e => { e.preventDefault(); update(r.id, { mergeInto: merge.trim().toUpperCase() }).then(ok => ok && setMerge('')); }}><label>Merge into reference<input value={merge} onChange={e => setMerge(e.target.value)} placeholder="CR-2026-XXXXXX" required/></label><button className="secondary">Merge</button></form>
    <form onSubmit={e => { e.preventDefault(); update(r.id, { clarification: question }).then(ok => ok && setQuestion('')); }}><label>Ask the citizen{!r.reporter_contact && ' (shown on tracking page only)'}<input value={question} onChange={e => setQuestion(e.target.value)} minLength="4" maxLength="500" placeholder="e.g. Which side of the road?" required/></label><button className="secondary">Send</button></form>
    <div><label>Upload evidence photos<select value={stage} onChange={e => setStage(e.target.value)}><option value="before">Before work</option><option value="after">After work</option></select><input type="file" accept="image/*" multiple onChange={upload}/></label></div>
   </div>
   <div className="timeline">{history.map(a => <div key={a.id}><i></i><b>{a.action}</b> <small>by {a.actor}</small><time>{formatDate(a.created_at)}</time>{a.note && <p>{a.note}</p>}</div>)}</div>
  </div>}</article>;
}

function Queue() {
 const [reports, setReports] = useState([]), [filter, setFilter] = useState(''), [search, setSearch] = useState('');
 const load = () => api.get('/api/admin/reports', { params: filter ? { status: filter } : {} }).then(r => setReports(r.data)).catch(err => failed(err, 'Could not load operations queue.'));
 useEffect(() => { load(); }, [filter]);
 const update = async (id, patch) => { try { await api.patch(`/api/admin/reports/${id}`, patch); toast.success('Report updated.'); load(); return true; } catch (e) { failed(e, 'Update failed.'); return false; } };
 const q = search.trim().toLowerCase(); const shown = q ? reports.filter(r => `${r.reference} ${r.title} ${r.ward || ''} ${r.address || ''}`.toLowerCase().includes(q)) : reports;
 return <><div className="toolbar"><input placeholder="Search reference, title, ward" value={search} onChange={e => setSearch(e.target.value)}/><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</select><span>{shown.length} report(s) · {shown.filter(isOverdue).length} overdue</span></div><section className="adminQueue">{shown.map(r => <ReportCard key={r.id} r={r} update={update} reload={load}/>)}{!shown.length && <p className="empty">No reports match this filter.</p>}</section></>;
}

function WorkOrders() {
 const [orders, setOrders] = useState([]);
 const load = () => api.get('/api/admin/work-orders').then(r => setOrders(r.data)).catch(e => failed(e, 'Could not load work orders.'));
 useEffect(() => { load(); }, []);
 const save = async (id, patch) => { try { await api.patch(`/api/admin/work-orders/${id}`, patch); toast.success('Work order updated.'); load(); } catch (e) { failed(e, 'Update failed.'); } };
 if (!orders.length) return <p className="empty">No work orders yet. One is created when a report is set to Assigned.</p>;
 return <table className="dataTable"><thead><tr><th>Report</th><th>Department</th><th>Instructions</th><th>Crew / assignee</th><th>Status</th><th>Created</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><b>{o.reference}</b><br/><small>P{o.severity} · {o.report_status}</small></td><td>{o.department}</td><td>{o.instructions}</td><td><input defaultValue={o.assignee || ''} placeholder="Unassigned" onBlur={e => e.target.value !== (o.assignee || '') && save(o.id, { assignee: e.target.value })}/></td><td><select value={o.status} onChange={e => save(o.id, { status: e.target.value })}>{['Open', 'In Progress', 'Done'].map(s => <option key={s}>{s}</option>)}</select></td><td>{formatDate(o.created_at)}</td></tr>)}</tbody></table>;
}

function Performance() {
 const [rows, setRows] = useState([]);
 useEffect(() => { api.get('/api/admin/performance').then(r => setRows(r.data)).catch(e => failed(e, 'Could not load performance.')); }, []);
 const n = v => v ?? '—';
 return <><div className="toolbar"><span>Response = first staff action. Resolution = first time marked Resolved.</span><button className="secondary" onClick={() => download('/api/admin/performance?format=csv', 'performance.csv')}>Download CSV</button></div><table className="dataTable"><thead><tr><th>Department</th><th>Total</th><th>Open</th><th>Resolved</th><th>Overdue</th><th>SLA met</th><th>Avg response (h)</th><th>Avg resolution (h)</th></tr></thead><tbody>{rows.map(d => <tr key={d.department}><td>{d.department}</td><td>{d.total}</td><td>{d.open}</td><td>{d.resolved}</td><td className={d.overdue ? 'lateText' : ''}>{d.overdue}</td><td>{d.sla_met_pct == null ? '—' : `${d.sla_met_pct}%`}</td><td>{n(d.avg_response_hours)}</td><td>{n(d.avg_resolution_hours)}</td></tr>)}</tbody></table>{!rows.length && <p className="empty">No reports yet.</p>}</>;
}

function Staff() {
 const [users, setUsers] = useState([]), [form, setForm] = useState({ role: 'supervisor', department: departments[0] });
 const load = () => api.get('/api/admin/users').then(r => setUsers(r.data)).catch(e => failed(e, 'Could not load staff.'));
 useEffect(() => { load(); }, []);
 const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
 const add = async e => { e.preventDefault(); try { await api.post('/api/admin/users', form); toast.success('Staff account created.'); setForm({ role: 'supervisor', department: departments[0] }); e.target.reset(); load(); } catch (err) { failed(err, 'Could not create account.'); } };
 return <><form className="staffForm" onSubmit={add}><input name="name" placeholder="Full name" required onChange={set}/><input name="email" type="email" placeholder="Work email" required onChange={set}/><input name="password" type="password" placeholder="Temporary password (12+ chars)" minLength="12" required onChange={set}/><select name="role" value={form.role} onChange={set}><option value="supervisor">Department supervisor</option><option value="worker">Field worker</option><option value="admin">Administrator</option></select>{form.role !== 'admin' && <select name="department" value={form.department} onChange={set}>{departments.map(d => <option key={d}>{d}</option>)}</select>}<button className="button">Add staff</button></form><table className="dataTable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Since</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.department}</td><td>{formatDate(u.created_at)}</td></tr>)}</tbody></table></>;
}

export default function Admin() {
 const user = me(); const [tab, setTab] = useState('Queue');
 if (!user) { location.href = '/staff-login'; return null; }
 const tabs = { Queue, 'Work orders': WorkOrders, Performance, ...(user.role === 'admin' ? { Staff } : {}) }; const View = tabs[tab];
 return <Layout><section className="pageIntro inlineIntro"><div><p className="eyebrow">MUNICIPAL OPERATIONS · {user.name} · {user.role}{user.role !== 'admin' ? ` · ${user.department}` : ''}</p><h1>Review & route reports</h1></div></section><nav className="tabs">{Object.keys(tabs).map(k => <button key={k} className={k === tab ? 'active' : ''} onClick={() => setTab(k)}>{k}</button>)}</nav><View/></Layout>;
}
