import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { lang, languages, setLang, t } from './i18n';

function Nav() {
 const [staff, setStaff] = useState(!!localStorage.getItem('civic_token'));
 const out = () => { localStorage.removeItem('civic_token'); setStaff(false); toast.success('Signed out'); };
 return <header><Link className="brand" to="/">Civic<span>Resolve</span></Link><nav><Link to="/report">{t('navReport')}</Link><Link to="/track">{t('navTrack')}</Link><Link to="/dashboard">{t('navDashboard')}</Link>{staff ? <><Link to="/admin">{t('navOps')}</Link><button className="linkBtn" onClick={out}>{t('navOut')}</button></> : <Link to="/staff-login">{t('navStaff')}</Link>}<select className="langPick" aria-label="Language" value={lang} onChange={e => setLang(e.target.value)}>{Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></nav></header>;
}
export function Layout({ children }) { return <><Nav/><main>{children}</main><footer>Transparent civic service delivery · AI recommendations are reviewed by municipal staff.</footer><Toaster position="top-right"/></>; }
