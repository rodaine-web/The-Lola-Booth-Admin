import express from 'express';
import {stagingSitePayload} from '../services/staging-cms-service.js';
const url=new URL(process.env.DATABASE_URL||'');if(url.hostname!=='localhost'||url.pathname!=='/lola_goal2_qualification')throw Error('Local QA database only.');
const app=express();
app.get('/staging-site/config.js',(_req,res)=>res.type('js').send('window.LOLA_CONFIG={environment:"staging",cmsChannel:"STAGING",apiBase:"http://localhost:5189",formsEnabled:false};'));
app.get('/api/public/staging/site',async(_req,res)=>res.json(await stagingSitePayload()));
app.use('/staging-site',express.static('public/staging-site'));
app.listen(5189,'127.0.0.1',()=>console.log('Local CMS preview http://localhost:5189/staging-site/index.html'));
