import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authConfig,validSession,SESSION_COOKIE} from '../lib/session';
import TerminalClient from '../components/TerminalClient';
export const dynamic='force-dynamic';
export default async function Home(){
 let authorized=false;
 try{authorized=validSession((await cookies()).get(SESSION_COOKIE)?.value,authConfig());}catch{}
 if(!authorized)redirect('/login');
 return <TerminalClient/>;
}
