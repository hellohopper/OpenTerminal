"use client";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {useEffect,useState} from "react";
import {apiGet,apiDelete} from "../lib/api";
import {useI18n} from "../lib/use-i18n";
type Device={id:string;name:string;created_at:string;expires_at:string;revoked_at:string|null};
export default function DeviceSettings(){
 const {t}=useI18n(),qc=useQueryClient(),q=useQuery({queryKey:["mobile-devices"],queryFn:()=>apiGet<Device[]>("/api/mobile/devices")}),remove=useMutation({mutationFn:(id:string)=>apiDelete(`/api/mobile/devices/${id}`),onSuccess:()=>qc.invalidateQueries({queryKey:["mobile-devices"]})});
 const [origin,setOrigin]=useState("");useEffect(()=>setOrigin(window.location.origin),[]);
 return <section className="space-y-3"><h3 className="amber">{t("Paired phones")}</h3><p>{t("Revoke a phone to stop API access and native notifications. Password or session-secret changes invalidate all phone credentials.")}</p>{origin&&<p className="break-all">{origin} · <a className="amber" href={`openterminal://connect?server=${encodeURIComponent(origin)}`}>{t("Open this server in the iOS app")}</a></p>}{q.data?.map(d=><div key={d.id} className="ui-visibility-row"><span>{d.name}<span className="dim block">{d.revoked_at?t("Revoked"):`${t("Expires")} ${new Date(d.expires_at).toLocaleDateString()}`}</span></span><button className="term-btn" disabled={!!d.revoked_at||remove.isPending} onClick={()=>remove.mutate(d.id)}>{t("Revoke device")}</button></div>)}{q.data?.length===0&&<p>{t("No phones paired yet.")}</p>}{(q.error||remove.error)&&<p role="alert">{q.error?.message||remove.error?.message}</p>}</section>;
}
