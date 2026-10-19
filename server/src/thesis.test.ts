import {it,expect} from 'vitest';import {thesisSchema,dueTheses} from './thesis.js';
const t=thesisSchema.parse({symbol:'aapl',title:'Cash',rationale:'',metrics:'',catalysts:'',invalidation:'',reviewDate:'2026-10-01',status:'active'});
it('rejects impossible dates and filters inactive or unrelated due reviews',()=>{expect(thesisSchema.safeParse({...t,reviewDate:'2026-02-30'}).success).toBe(false);expect(dueTheses([{payload:t},{payload:{...t,status:'archived' as const}},{payload:{...t,symbol:'MSFT'}}],['AAPL'],'2026-10-19')).toHaveLength(1);});
