import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

function Nav() {
 const [staff, setStaff] = useState(!!localStorage.getItem('civic_token'));
 const out = () => { localStorage.removeItem('civic_token'); setStaff(false); toast.success('Signed out'); };
 return <header><Link className="brand" to="/">Civic<span>Resolve</span></Link><nav><Link to="/report">Report an issue</Link><Link to="/track">Track report</Link><Link to="/dashboard">Public dashboard</Link>{staff ? <><Link to="/admin">Operations</Link><button className="linkBtn" onClick={out}>Sign out</button></> : <Link to="/staff-login">Staff login</Link>}</nav></header>;
}
export function Layout({ children }) { return <><Nav/><main>{children}</main><footer>Transparent civic service delivery · AI recommendations are reviewed by municipal staff.</footer><Toaster position="top-right"/></>; }
