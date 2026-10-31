import React, { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from './api';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { Layout } from './layout';
import { Report, Track } from './citizen';
import Admin from './admin';

const LazyDashboard = lazy(() => import('./dashboard'));

function Home() { return <Layout><section className="hero"><div><p className="eyebrow">ONE PORTAL. CLEAR ACCOUNTABILITY.</p><h1>See a problem?<br/><em>Start the fix.</em></h1><p>Report infrastructure issues with a location and evidence. Follow each step from acknowledgement to resolution.</p><div className="actions"><Link className="button" to="/report">Report an issue →</Link><Link className="textLink" to="/track">Track an existing report</Link></div></div><aside className="heroCard"><span className="pulse"></span><b>Critical issues get priority</b><p>Safety, health, traffic impact, location, and recurrence guide assistive triage—never replace municipal judgment.</p><div className="statusSteps">{['Submitted','Review','Assigned','Resolved'].map((s,i)=><span key={s}><i>{i+1}</i>{s}</span>)}</div></aside></section><section className="featureGrid"><article><b>01</b><h3>Document it</h3><p>Share a photo, video, location, and detail. You may report anonymously.</p></article><article><b>02</b><h3>Review it</h3><p>AI assists with routing and severity; municipal teams verify every decision.</p></article><article><b>03</b><h3>Resolve it</h3><p>Track updates, assignments, and resolution evidence through closure.</p></article></section></Layout>; }
function Login() { const navigate=useNavigate(),[email,setEmail]=useState(''),[password,setPassword]=useState(''); const submit=async e=>{e.preventDefault();try{const {data}=await api.post('/api/auth/login',{email,password});localStorage.setItem('civic_token',data.token);toast.success(`Welcome, ${data.user.name}`);navigate('/admin');}catch(err){toast.error(err.response?.data?.error||'Unable to sign in.')}}; return <Layout><form className="login" onSubmit={submit}><p className="eyebrow">MUNICIPAL STAFF</p><h1>Operations sign-in</h1><label>Work email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button">Sign in</button></form></Layout>; }
function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/report" element={<Report/>}/><Route path="/track" element={<Track/>}/><Route path="/dashboard" element={<Suspense fallback={<Layout><p className="empty">Loading dashboard…</p></Layout>}><LazyDashboard/></Suspense>}/><Route path="/staff-login" element={<Login/>}/><Route path="/admin" element={<Admin/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes>}; createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
