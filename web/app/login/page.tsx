"use client";
import { useI18n } from "../../lib/use-i18n";

import {useState} from 'react';
export default function Login(){
  const { t: ui } = useI18n();

 const [password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <main className="max-w-md mx-auto mt-24 p-6 border border-[var(--border)]"><h1 className="amber text-xl">OpenTerminal</h1><p className="dim my-4">{ui("Sign in to access your private terminal.")}</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});if(!r.ok)throw new Error((await r.json()).error??'Sign-in failed');window.location.assign('/');}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}}><label>{ui("Password")}<input type="password" aria-label={ui("Terminal password")} autoComplete="current-password" required className="block w-full my-3" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="term-btn" disabled={busy}>{ui("Sign in")}</button></form>{message&&<p role="alert" className="amber mt-4">{message}</p>}<p className="dim text-xs mt-6">{ui("Use the configured WEB_PASSWORD. By default the owner’s API key is used; local installations keep it in data/.api-key.")}</p></main>;
}
