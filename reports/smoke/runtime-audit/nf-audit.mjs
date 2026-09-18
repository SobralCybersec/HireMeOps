import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from '../../../automation/node_modules/pg/lib/index.js';
process.loadEnvFile('.env');
const base=(process.env.NORTHFLANK_API_BASE_URL || 'https://api.northflank.com/v1').replace(/\/$/,'');
const job=`${base}/projects/${process.env.NORTHFLANK_PROJECT_ID}/jobs/${process.env.NORTHFLANK_JOB_ID}`;
const root='reports/smoke/runtime-audit';
async function api(path='',body) {
 const r=await fetch(job+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.NORTHFLANK_API_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if (!r.ok) { const detail=await r.json(); writeFileSync(`${root}/nf-api-error.json`,JSON.stringify(detail)); throw new Error(`northflank_http_${r.status}`); }
 return (await r.json()).data;
}
const pool=new pg.Pool({connectionString:process.env.HIREMEOPS_DATABASE_URL,max:1});
try {
 if(process.argv[2]==='inspect') {
  const deployment=await api('/deployment');
  const runs=await api('/runs');
  console.log(JSON.stringify({deployment:{internal:deployment.internal,docker:deployment.docker},runs}));
  const q=await pool.query(`SELECT r.id,r.profile_id,r.intent,r.query_plan,s.platform_status->>'linkedin' AS linkedin FROM search_runs r JOIN browser_sessions s ON s.profile_id=r.profile_id WHERE r.query_plan->>'platform'='linkedin' ORDER BY r.started_at DESC LIMIT 1`);
  writeFileSync(`${root}/source-run.json`,JSON.stringify(q.rows[0]));
  console.log(JSON.stringify({sourceRunId:q.rows[0]?.id,linkedin:q.rows[0]?.linkedin}));
 }
 if(process.argv[2]==='start') {
  const source=JSON.parse(readFileSync(`${root}/source-run.json`));
  if(source.linkedin!=='valid') throw new Error('local_revalidation_required');
  const id=randomUUID();
  const files={};
  for(const path of ['core/browser/browser-launch.js','cloud/cloud-navigation-telemetry.mjs']) files[`/app/automation/${path}`]={data:readFileSync(`automation/${path}`).toString('base64'),encoding:'utf-8'};
  if(process.argv.includes('--deadline-experiment')) {
   let worker=readFileSync('automation/platforms/linkedin/worker-linkedin.js','utf8');
   worker=worker.replaceAll('readLinkedInSearchState(page, inspectorTimeoutMs)', 'readLinkedInSearchState(page, Math.max(1, deadline - Date.now()))');
   worker=worker.replace('await readLinkedInSearchDiagnostics(page, stateDiagnostics, inspectorTimeoutMs)', '(Date.now() < deadline ? await readLinkedInSearchDiagnostics(page, stateDiagnostics, Math.max(1, deadline - Date.now())) : stateDiagnostics)');
   files['/app/automation/platforms/linkedin/worker-linkedin.js']={data:Buffer.from(worker).toString('base64'),encoding:'utf-8'};
  }
  let browser=readFileSync('automation/cloud/cloud-browser.mjs','utf8');
  browser=browser.replace('import { existsSync }','import { readFileSync, readdirSync, existsSync }');
  browser=browser.replace('const page = await context.newPage();', `const page = await context.newPage();
    const actualViewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
    const processes = readdirSync('/proc').filter(id => /^\\d+$/.test(id)).flatMap(id => {
      try { const args=readFileSync('/proc/'+id+'/cmdline','utf8').split('\\0');
        if(!args.includes('--remote-debugging-pipe') || args.some(a=>a.startsWith('--type='))) return [];
        return [{pid:Number(id),backgroundNetworkingDisabled:args.includes('--disable-background-networking')}];
      } catch { return []; }
    });
    console.error('[runtime-audit] '+JSON.stringify({version:browser.version(),viewport:actualViewport,processes}));
    if(!processes.length || processes.some(p=>p.backgroundNetworkingDisabled)) throw new Error('networking_switch_ineffective');`);
  files['/app/automation/cloud/cloud-browser.mjs']={data:Buffer.from(browser).toString('base64'),encoding:'utf-8'};
  await pool.query(`INSERT INTO search_runs(id,profile_id,intent,query_plan,status) VALUES($1,$2,$3,$4::jsonb,'started')`,[id,source.profile_id,source.intent,JSON.stringify(source.query_plan)]);
  try {
   const run=await api('/runs',{runtimeEnvironment:{HIREMEOPS_RUN_ID:id,HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING:'1',HIREMEOPS_CLOUD_BLOCK_HEAVY_RESOURCES:'0'},runtimeFiles:files});
   writeFileSync(`${root}/active-run.json`,JSON.stringify({searchRunId:id,...run}));
   console.log(JSON.stringify({searchRunId:id,northflank:run}));
  } catch(e) {
   await pool.query(`UPDATE search_runs SET status='failed',phase='failed',error=$2,finished_at=now(),updated_at=now() WHERE id=$1`,[id,e.message]); throw e;
  }
 }
 if(process.argv[2]==='logs') {
  const run=JSON.parse(readFileSync(`${root}/active-run.json`));
  const logs=await api(`/logs?runId=${run.id}&type=runtime&lineLimit=1000&direction=forward`);
  writeFileSync(`${root}/nf-logs.json`,JSON.stringify(logs));
  console.log(JSON.stringify({type:typeof logs,keys:Object.keys(logs)}));
 }
 if(process.argv[2]==='status') {
  const run=JSON.parse(readFileSync(`${root}/active-run.json`));
  const state=await api(`/runs/${run.id}`);
  const q=await pool.query(`SELECT id,status,phase,error,result_count,persisted_count FROM search_runs WHERE id=$1`,[run.searchRunId]);
  console.log(JSON.stringify({state:{id:state.id,status:state.status,active:state.active,concluded:state.concluded},db:q.rows}));
 }
} catch(e) { console.error(e.message);process.exitCode=1; } finally { await pool.end(); }
