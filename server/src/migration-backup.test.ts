import {it,expect} from 'vitest';
import {makeWorkspace} from '../../web/lib/workspaces.js';
import {defaultDisplayPreferences} from '../../web/lib/display.js';
import {createMigrationBackup,readMigrationBackup,stageMigrationBrowser} from '../../web/lib/migration-backup.js';
function storage(){const s:Record<string,unknown>={};Object.defineProperties(s,{getItem:{value:(k:string)=>s[k]??null},setItem:{configurable:true,value:(k:string,v:string)=>{s[k]=v;}},removeItem:{value:(k:string)=>{delete s[k];}}});return s as unknown as Storage;}
function snapshot(){const w=makeWorkspace('Migrated','blank');return {format:'openterminal-device' as const,version:1 as const,workspace:{workspaces:[w],activeWorkspaceId:w.id},preferences:{groups:[],screeners:[]},drawings:{},display:{...defaultDisplayPreferences(),language:'zh' as const,fontSize:18}};}
it('checks migration integrity and restores drafts, display and layouts without touching session keys',async()=>{
 const source=storage();source.setItem('openterminal-research-draft-v1:form',JSON.stringify({version:1,value:{title:'Keep'}}));source.setItem('session-secret','excluded');
 const file=await createMigrationBackup({format:'openterminal-backup'},snapshot(),source);expect(JSON.stringify(file)).not.toContain('session-secret');const parsed=await readMigrationBackup(file);
 const target=storage();target.setItem('session-secret','keep');target.setItem('openterminal-display','old');target.setItem('openterminal-journal-draft-v1:old','old');const before={...target};
 const undo=stageMigrationBrowser(parsed,target);expect(JSON.parse(target.getItem('openterminal-display')!).state.fontSize).toBe(18);expect(target.getItem('openterminal-journal-draft-v1:old')).toBeNull();expect(target.getItem('session-secret')).toBe('keep');undo();expect({...target}).toEqual(before);
 const changed=structuredClone(file);changed.device.display!.fontSize=20;await expect(readMigrationBackup(changed)).rejects.toThrow('checksum');
});
it('rolls back partially staged browser state on quota failure before server restore',async()=>{
 const file=await createMigrationBackup({format:'openterminal-backup'},snapshot(),storage()),target=storage();target.setItem('openterminal-display','old');target.setItem('openterminal-workspace','old-layout');const before={...target};
 const original=target.setItem.bind(target);let failed=false;const proxy=new Proxy(target,{get(t,k){if(k==='setItem')return (key:string,value:string)=>{if(key==='openterminal-preferences'&&!failed){failed=true;throw new Error('Quota');}return original(key,value);};return Reflect.get(t,k);}});
 expect(()=>stageMigrationBrowser(file,proxy)).toThrow('Quota');expect({...target}).toEqual(before);
});
