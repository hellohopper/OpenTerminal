import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../async-route.js";
import { symbolSchema } from "../validation.js";
import { changesFor, acknowledgeResearch, chartEvents, compareResearch, type ResearchSnapshot } from "../workflow-research.js";
import { records } from "../records.js";
export const workflowResearchRouter=Router();
workflowResearchRouter.param("symbol",(req,res,next,value)=>{const parsed=symbolSchema.safeParse(value);if(!parsed.success)return res.status(400).json({error:"Invalid symbol"});req.params.symbol=parsed.data;next();});
workflowResearchRouter.get("/changes/:symbol",asyncRoute(async(req,res)=>res.json(await changesFor(req.params.symbol))));
workflowResearchRouter.get("/changes/:symbol/:snapshot",asyncRoute(async(req,res)=>{
 const history=await records<ResearchSnapshot>(`research-baseline:${req.params.symbol}`),chosen=history.find(r=>r.id===Number(req.params.snapshot));
 if(!chosen)return res.status(404).json({error:"Snapshot no longer retained."});
 const older=history.find(r=>r.id<chosen.id);res.json({...compareResearch(chosen.payload.entries,older?.payload.entries),current:chosen.payload});
}));
workflowResearchRouter.post("/changes/:symbol/read",asyncRoute(async(req,res)=>{
 const p=z.object({token:z.string().length(64),version:z.number().int().nonnegative().safe()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Review a current change summary first."});
 try{res.json(await acknowledgeResearch(req.params.symbol,p.data.token,p.data.version));}catch(e){res.status(409).json({error:(e as Error).message});}
}));
workflowResearchRouter.get("/events/:symbol",asyncRoute(async(req,res)=>res.json(await chartEvents(req.params.symbol))));
