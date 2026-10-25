import {it,expect} from "vitest";
import {managedPollingInterval} from "../../web/lib/display";
it("applies pause, visibility, minimum intervals and bounded error backoff to every polling query",()=>{
 expect(managedPollingInterval(0,15000,true)).toBe(false);
 expect(managedPollingInterval(5000,15000,false)).toBe(false);
 expect(managedPollingInterval(30000,15000,true)).toBe(30000);
 expect(managedPollingInterval(5000,1000,true,2)).toBe(20000);
 expect(managedPollingInterval(5000,1000,true,8)).toBe(60000);
 expect(managedPollingInterval(5000,300000,true,8)).toBe(300000);
 expect(managedPollingInterval(5000,false,true)).toBe(false);
});
