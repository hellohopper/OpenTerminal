import {Router} from 'express';import {db} from '../db.js';import {asyncRoute} from '../async-route.js';import {createBackup,restoreBackup} from '../storage/backup.js';import {SCHEMA_VERSION} from '../storage/migrations.js';
export const dataRouter=Router();
dataRouter.get('/status',asyncRoute(async(_req,res)=>res.json({database:db.kind,schemaVersion:SCHEMA_VERSION,backups:'manual',maxBackupBytes:32*1024*1024})));
dataRouter.get('/backup',asyncRoute(async(_req,res)=>{try{res.json(await createBackup(db));}catch(error){res.status(400).json({error:(error as Error).message});}}));
dataRouter.post('/restore',asyncRoute(async(req,res)=>{if(req.body?.confirmation!=='RESTORE')return res.status(400).json({error:'Type RESTORE to replace server data.'});try{res.json({restored:await restoreBackup(db,req.body.backup)});}catch(error){res.status(400).json({error:(error as Error).message});}}));
