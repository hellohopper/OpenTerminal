import {NextRequest,NextResponse} from 'next/server';
import {authConfig,issueSession,passwordMatches,sameOrigin,SESSION_COOKIE} from '../../../lib/session';
let attempts=0,windowStart=0;
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return NextResponse.json({error:'Same-origin request required.'},{status:403});
 const now=Date.now();if(now-windowStart>60000){windowStart=now;attempts=0;}
 if(++attempts>10)return NextResponse.json({error:'Too many sign-in attempts. Try again in one minute.'},{status:429,headers:{'retry-after':'60'}});
 try{
  const config=authConfig();const reader=req.body?.getReader();if(!reader)return NextResponse.json({error:'Password required.'},{status:400});
  let body='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return NextResponse.json({error:'Request too large.'},{status:413});}body+=decoder.decode(value,{stream:true});}
  const input=JSON.parse(body);
  if(typeof input.password!=='string'||!passwordMatches(input.password,config))return NextResponse.json({error:'Invalid password.'},{status:401});
  attempts=0;
  const res=NextResponse.json({ok:true});res.cookies.set(SESSION_COOKIE,issueSession(config),{httpOnly:true,sameSite:'strict',secure:new URL(process.env.WEB_ORIGIN||req.url).protocol==='https:',path:'/',maxAge:12*3600});res.headers.set('cache-control','no-store');return res;
 }catch{return NextResponse.json({error:'Sign-in is unavailable. Check the server auth configuration.'},{status:503});}
}
export async function DELETE(req:NextRequest){if(!sameOrigin(req))return NextResponse.json({error:'Same-origin request required.'},{status:403});const res=NextResponse.json({ok:true});res.cookies.set(SESSION_COOKIE,'',{httpOnly:true,sameSite:'strict',path:'/',maxAge:0});return res;}
