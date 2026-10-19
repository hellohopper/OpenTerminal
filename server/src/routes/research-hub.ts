import {Router} from 'express';import {asyncRoute} from '../async-route.js';import {symbolSchema} from '../validation.js';import {researchEntries} from '../research-hub.js';
export const researchHubRouter=Router();
researchHubRouter.get('/:symbol',asyncRoute(async(req,res)=>{const p=symbolSchema.safeParse(req.params.symbol);if(!p.success)return res.status(400).json({error:'Invalid symbol'});res.json(await researchEntries(p.data));}));
