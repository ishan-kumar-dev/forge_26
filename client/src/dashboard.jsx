import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import toast from 'react-hot-toast';
import api from './api';
import { Layout } from './layout';

function Metric({ label, value }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
export default function Dashboard() {
 const [data, setData] = useState(null), [reports, setReports] = useState([]);
 useEffect(() => { Promise.all([api.get('/api/public/dashboard'), api.get('/api/public/reports')]).then(([a, b]) => { setData(a.data); setReports(b.data); }).catch(() => toast.error('Dashboard data is unavailable.')); }, []);
 const mapReports = useMemo(() => reports.filter(r => r.latitude && r.longitude), [reports]);
 return <Layout><section className="pageIntro"><p className="eyebrow">PUBLIC TRANSPARENCY</p><h1>Citywide service pulse</h1><p>Aggregated, anonymized data. Personal contact details and private media are never displayed.</p></section>{data && <><section className="metrics"><Metric label="Total reports" value={data.totals.total}/><Metric label="Resolved / closed" value={data.totals.resolved}/><Metric label="Open cases" value={data.totals.pending}/><Metric label="Average priority" value={`${data.totals.avgSeverity || 0} / 5`}/></section><section className="dashboardGrid"><article className="chart"><h2>Reports by category</h2><ResponsiveContainer width="100%" height={260}><BarChart data={data.byCategory}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="value" fill="#16776b" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></article><article className="performance"><h2>Department performance</h2>{data.byDepartment.length ? data.byDepartment.map(d => <div key={d.name}><span>{d.name}</span><b>{d.resolved}/{d.total} resolved</b><div><i style={{ width: `${Math.round(d.resolved / d.total * 100)}%` }}/></div></div>) : <p>No reports published yet.</p>}</article></section><section className="mapCard"><h2>Reported locations</h2>{mapReports.length ? <MapContainer center={[mapReports[0].latitude, mapReports[0].longitude]} zoom={13} scrollWheelZoom={false}><TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{mapReports.map(r => <Marker key={r.id} position={[r.latitude, r.longitude]}><Popup><b>{r.category}</b><br/>{r.status} · Priority {r.severity}/5<br/>{r.ward || r.address || 'Location reported'}</Popup></Marker>)}</MapContainer> : <p>No location-enabled reports have been published.</p>}</section></>}</Layout>;
}
