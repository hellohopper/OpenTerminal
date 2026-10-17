import {describe,it,expect} from 'vitest';
import {issueSession,validSession,passwordMatches} from '../../web/lib/session';
const config={disabled:false,password:'a long owner password',secret:'a'.repeat(48)},now=1000000000;
describe('private web sessions',()=>{
 it('requires a correct password and rejects unsigned, expired and tampered cookies',()=>{expect(passwordMatches('wrong',config)).toBe(false);expect(passwordMatches(config.password,config)).toBe(true);const token=issueSession(config,now);expect(validSession(token,config,now)).toBe(true);expect(validSession(token,config,now+12*3600000)).toBe(false);expect(validSession(token+'a',config,now)).toBe(false);expect(validSession(undefined,config,now)).toBe(false);});
 it('invalidates sessions when the password or signing secret changes',()=>{const token=issueSession(config,now);expect(validSession(token,{...config,password:'changed password'},now)).toBe(false);expect(validSession(token,{...config,secret:'b'.repeat(48)},now)).toBe(false);});
});
