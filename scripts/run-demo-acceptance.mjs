import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args=process.argv.slice(2);
const value=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
if(!args.includes('--execute')) throw new Error('Use --execute to run the dedicated demo tenant tests, including fixture mutations and small real AWS calls.');
const loginFile=resolve(value('--login-file','work/deployment/validation-login.txt'));
const login=await readFile(loginFile,'utf8');
const field=(name)=>login.match(new RegExp(`^${name}: (.+)$`,'m'))?.[1]?.trim();
const base=new URL(field('URL'));
if(base.protocol!=='https:'||base.username||base.password) throw new Error('An HTTPS validation URL without embedded credentials is required');
const password=field('Password'),username=field('Username');
if(!password||!username) throw new Error('Missing validation login fields');
const headers={authorization:'Basic '+Buffer.from(`${username}:${password}`).toString('base64'),'content-type':'application/json'};
const output=resolve(value('--output-dir',`outputs/demo-acceptance/${new Date().toISOString().replace(/[:.]/g,'-')}`));
await mkdir(output,{recursive:true});
const redact=(v)=>JSON.parse(JSON.stringify(v,(k,x)=>/^(appkey|adminKey|operatorKey|password|authorization)$/i.test(k)?'[redacted]':typeof x==='string'?x.split(password).join('[redacted]'):x));
async function call(path,body){
 const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(300000)});
 const data=await r.json().catch(()=>({message:'Non-JSON response'}));
 if(!r.ok) throw new Error(`HTTP ${r.status}: ${data.code||data.message||'request failed'}`);
 return data;
}
const state=await call('api/demo/state');
if(!state.ready) throw new Error('Prepare the STORE_A / STORE_B validation environment in the console first. No credentials were rotated by this runner.');
const config=await call('api/config');
const suites=[
 ['core','api/scenarios/run',{}],
 ['http-exposure','api/demo/http-exposure-validation',{}],
 ['internal-exposure','api/demo/internal-exposure-validation',{confirmValidation:true}],
 ['tenant','api/demo/tenant-validation',{confirmValidation:true}],
 ['rbac','api/demo/rbac-validation',{confirmValidation:true}],
 ['credentials','api/demo/credential-lifecycle-validation',{confirmValidation:true}],
 ['parsers','api/demo/parser-regression-validation',{confirmValidation:true}],
 ['knowledge-lifecycle','api/demo/knowledge-lifecycle-validation',{confirmValidation:true}],
 ['policy-matrix','api/demo/knowledge-policy-matrix-validation',{confirmValidation:true}],
 ['index-jobs','api/demo/knowledge-index-job-validation',{confirmValidation:true}],
 ['file-rejection','api/demo/knowledge-file-rejection-validation',{confirmValidation:true}],
 ['performance-smoke','api/performance/run',{preset:'smoke',operationId:'knowledge.answers',body:{query:'교환과 환불 정책을 알려주세요.',strict:true,includeSources:true,maxTokens:256,temperature:0}}],
];
const results=[];
console.log(`Output: ${output}`);
for(const [id,path,body] of suites){
 console.log(`RUN ${id}`);
 try{
  const report=redact(await call(path,body));
  await writeFile(join(output,`${id}.json`),JSON.stringify(report,null,2));
  const s=report.summary||{};
  const pass=id==='performance-smoke'?s.successRate===100:(s.failed===0&&(s.skipped||0)===0&&s.passed===s.total);
  results.push({id,passed:pass,summary:s,reportFile:report.reportFile});
  console.log(`${pass?'PASS':'FAIL'} ${id} ${JSON.stringify(s)}`);
 }catch(e){results.push({id,passed:false,error:e.message});console.log(`FAIL ${id}: ${e.message}`);}
 await writeFile(join(output,'summary.json'),JSON.stringify({at:new Date().toISOString(),validationUrl:base.href,upstream:config.baseUrl,results},null,2));
}
console.log(`Suites passed: ${results.filter(r=>r.passed).length}/${results.length}`);
process.exitCode=results.every(r=>r.passed)?0:1;
