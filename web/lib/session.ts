import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {getApiKey} from './api-key';
export const SESSION_COOKIE='openterminal_session';
export type AuthConfig={disabled:boolean;password:string;secret:string};
export function authConfig():AuthConfig{
 const key=getApiKey()??'';
 const password=process.env.WEB_PASSWORD||key,secret=process.env.WEB_SESSION_SECRET||key;
 if(process.env.WEB_AUTH_DISABLED==='1')return {disabled:true,password:'',secret:''};
 if(password.length<12||secret.length<32)throw new Error('Configure WEB_PASSWORD (12+ characters) and WEB_SESSION_SECRET (32+ characters), or a strong API_KEY.');
 return {disabled:false,password,secret};
}
const digest=(s:string)=>createHash('sha256').update(s).digest();
export const passwordMatches=(candidate:string,config:AuthConfig)=>timingSafeEqual(digest(candidate),digest(config.password));
const signingKey=(config:AuthConfig)=>createHmac('sha256',config.secret).update(digest(config.password)).digest();
export function issueSession(config:AuthConfig,now=Date.now()){
 const payload=`${now+12*3600000}.${randomBytes(24).toString('hex')}`;
 return payload+'.'+createHmac('sha256',signingKey(config)).update(payload).digest('hex');
}
export function validSession(token:string|undefined,config:AuthConfig,now=Date.now()):boolean{
 if(config.disabled)return true;
 if(!token||token.length>200)return false;
 const [expiry,nonce,sig,...rest]=token.split('.');
 if(rest.length||!/^\d+$/.test(expiry??'')||! /^[a-f0-9]{48}$/.test(nonce??'')||! /^[a-f0-9]{64}$/.test(sig??''))return false;
 if(Number(expiry)<=now||Number(expiry)>now+12*3600000)return false;
 const expected=createHmac('sha256',signingKey(config)).update(`${expiry}.${nonce}`).digest();
 return timingSafeEqual(Buffer.from(sig,'hex'),expected);
}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 const expected=process.env.WEB_ORIGIN||new URL(request.url).origin;
 return origin===expected;
}
