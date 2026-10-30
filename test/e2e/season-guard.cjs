// Browser test for client/season-guard.js against the local accounts mock.
//   node --import ./test/register.mjs test/dev-server.mjs 8793   (in one terminal)
//   python3 -m http.server 8794                                    (in the agnostic-accounts folder)
//   node test/e2e/season-guard.cjs
const { chromium } = require('playwright');
const PAGE='http://localhost:8794/test/e2e/guard-page.html', SVC='http://localhost:8793', CENTRAL='https://agnostic.accounts.agnosticsolutions.co.uk';
let fails=0; const ok=(c,m)=>{console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++;}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const post=(p,b,t)=>fetch(SVC+p,{method:'POST',headers:Object.assign({'content-type':'application/json'},t?{authorization:'Bearer '+t}:{}),body:JSON.stringify(b)}).then(r=>r.json());
async function newPage(b,seed,opts={}){
  const ctx=await b.newContext();
  await ctx.route(CENTRAL+'/**',async r=>{ if(opts.offline) return r.abort(); const res=await r.fetch({url:r.request().url().replace(CENTRAL,SVC)}); await r.fulfill({response:res}); });
  await ctx.addInitScript(([s])=>{ if(!localStorage.getItem('__seeded')){ localStorage.setItem('__seeded','1'); for(const k in s) localStorage.setItem(k,s[k]); } },[seed||{}]);
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('  pageerror',e.message)); return p;
}
const get=(p,k)=>p.evaluate(k=>localStorage.getItem(k),k).catch(()=>'<reloading>');
async function waitFor(fn,ms=8000){ const t=Date.now(); while(Date.now()-t<ms){ try{ if(await fn()) return true; }catch(e){} await sleep(250);} return false; }
(async()=>{
  const b=await chromium.launch(); await fetch(SVC+'/__reset');
  const u=await post('/api/auth/register',{username:'Guard',pin:'123456'}); const tok=u.token;
  await post('/api/sync',{game:'test-game',best:150000},tok);

  console.log('A. a new season clears this device\'s saved scores (and only those)');
  await fetch(SVC+'/__season/2');
  let p=await newPage(b,{tg_best:'150000',tg_week:'90000','tg_lb_all':'cached','as.season':'1',keep_me:'sound-on'});
  await p.goto(PAGE); 
  ok(await waitFor(async()=>(await get(p,'as.season'))==='2'),'device moves to season 2');
  await sleep(1500);
  ok(await get(p,'tg_best')===null&&await get(p,'tg_week')===null,'saved best and weekly best are cleared');
  ok(await get(p,'tg_lb_all')===null,'cached leaderboard (prefix) is cleared');
  ok(await get(p,'keep_me')==='sound-on','unrelated settings are left alone');

  console.log('B. saves carry the season, so they are accepted (and old-season saves are refused)');
  const r=await p.evaluate(([c,t])=>fetch(c+'/api/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t},body:JSON.stringify({game:'test-game',best:7000})}).then(r=>r.status),[CENTRAL,tok]);
  ok(r===200,'a save sent with no season by the game is accepted because the guard added it');
  const me=await fetch(SVC+'/api/me',{headers:{authorization:'Bearer '+tok}}).then(r=>r.json());
  ok(me.games['test-game']&&me.games['test-game'].best===7000,'the new season holds 7,000 (not the old 150,000)');
  const bare=await fetch(SVC+'/api/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tok},body:JSON.stringify({game:'test-game',best:150000})});
  ok(bare.status===409,'without the guard the same save would have been refused (409)');

  console.log('C. scores follow the account: a lower device is raised on sign-in');
  p=await newPage(b,{tg_best:'3000','as.season':'2'}); await p.goto(PAGE); await sleep(1500);
  await p.evaluate(([c,t])=>fetch(c+'/api/me',{headers:{authorization:'Bearer '+t}}),[CENTRAL,tok]);
  ok(await waitFor(async()=>(await get(p,'tg_best'))==='7000'),'device saved best raised from 3,000 to the account\'s 7,000');
  await sleep(1500);
  ok(await p.evaluate(()=>!!sessionStorage.getItem('as.reloaded.pull')),'page reloaded once to pick it up');
  const before=await get(p,'tg_best'); await p.evaluate(([c,t])=>fetch(c+'/api/me',{headers:{authorization:'Bearer '+t}}),[CENTRAL,tok]); await sleep(1500);
  ok(await get(p,'tg_best')===before,'a device already at or above the account best is left alone');

  console.log('D. the service being unreachable changes nothing');
  p=await newPage(b,{tg_best:'42000','as.season':'1'},{offline:true}); await p.goto(PAGE); await sleep(2500);
  ok(await get(p,'tg_best')==='42000','saved best untouched while offline');

  console.log('E. other requests are not touched');
  p=await newPage(b,{}); await p.goto(PAGE); await sleep(800);
  const n=await p.evaluate(()=>fetch('/test/e2e/guard-page.html').then(r=>r.status)); ok(n===200,'a normal same-site fetch still works');

  console.log(fails?`\n${fails} CHECK(S) FAILED`:'\nALL CHECKS PASSED'); await b.close(); process.exit(fails?1:0);
})();
