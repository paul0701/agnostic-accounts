// Two "devices" (phone + laptop) against a local copy of the accounts service.
const { chromium } = require('playwright');
const GAME='http://localhost:8792/index.html', SVC='http://localhost:8793', CENTRAL='https://agnostic.accounts.agnosticsolutions.co.uk';
let fails=0; const ok=(c,msg)=>{console.log((c?'  PASS ':'  FAIL ')+msg); if(!c) fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function device(browser,name,initial){
  const ctx=await browser.newContext({viewport:{width:900,height:700}});
  await ctx.route(CENTRAL+'/**',async r=>{ const u=r.request().url().replace(CENTRAL,SVC); const res=await r.fetch({url:u}); await r.fulfill({response:res}); });
  await ctx.addInitScript(([init])=>{ if(!localStorage.getItem('__seeded')){ localStorage.setItem('__seeded','1'); for(const k in init) localStorage.setItem(k,init[k]); } },[initial||{}]);
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log(' ['+name+'] PAGEERR',e.message));
  return {ctx,p,name};
}
const ls=(d,k)=>d.p.evaluate(k=>localStorage.getItem(k),k).catch(()=>'<unreadable>');
async function waitLS(d,k,v,ms=20000){ const t=Date.now(); while(Date.now()-t<ms){ if(await ls(d,k)===v) return true; await sleep(400);} return false; }
async function load(d){ await d.p.goto(GAME,{waitUntil:'domcontentloaded',timeout:60000}); await sleep(2500); }
const idle=async d=>{ await sleep(1500); try{ await d.p.goto('about:blank'); }catch(e){ await sleep(2500); await d.p.goto('about:blank'); } };
async function ui(d,mode,user,pin){
  await d.p.click('#as-btn'); await d.p.click('.as-tab:nth-child(2)');
  if(mode==='register'){ await d.p.click('text=New here? Create an account'); }
  await d.p.fill('#as-u',user); await d.p.fill('#as-p',pin);
  await d.p.click(mode==='register'?'text=CREATE ACCOUNT':'text=LOG IN');
  await sleep(3500);
}
(async()=>{
  const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  await fetch(SVC+'/__reset');

  console.log('1. Phone has 139,000 saved, creates an account');
  const phone=await device(b,'phone',{'ninjaDojo.best':'139000'}); await load(phone);
  await ui(phone,'register','Paul','123456');
  const tok=await ls(phone,'as.acct.token');
  const me=await (await fetch(SVC+'/api/me',{headers:{authorization:'Bearer '+tok}})).json();
  ok(me.games&&me.games['ninja-dojo']&&me.games['ninja-dojo'].best===139000,'server now holds 139,000 for the account');

  console.log('2. Laptop has 109,000 saved, signs in to the same account');
  const laptop=await device(b,'laptop',{'ninjaDojo.best':'109000'}); await load(laptop);
  await ui(laptop,'login','Paul','123456'); await sleep(1500);
  ok(await waitLS(laptop,'ninjaDojo.best','139000'),'laptop now saves 139,000 (was 109,000)');
  ok(await laptop.p.evaluate(()=>!!sessionStorage.getItem('as.reloaded.pull')),'laptop reloaded once to pick it up');

  console.log('3. Laptop beats it (150,000); the phone picks that up on its next visit');
  await laptop.p.evaluate(()=>localStorage.setItem('ninjaDojo.best','150000')); await sleep(3500);
  const me2=await (await fetch(SVC+'/api/me',{headers:{authorization:'Bearer '+tok}})).json();
  ok(me2.games['ninja-dojo'].best===150000,'server got 150,000 from the laptop');
  await idle(laptop); await load(phone);
  ok(await waitLS(phone,'ninjaDojo.best','150000'),'phone now saves 150,000');

  console.log('4. THE WIPE: season 2');
  await fetch(SVC+'/__season/2');
  const board=await (await fetch(SVC+'/api/leaderboard?game=ninja-dojo')).json();
  ok(board.entries.length===0,'leaderboard is empty');
  const me3=await (await fetch(SVC+'/api/me',{headers:{authorization:'Bearer '+tok}})).json();
  ok(Object.keys(me3.games).length===0,'account progress reads as empty (account itself still works)');
  await load(phone); const pw=await waitLS(phone,'as.season','2'); await sleep(3000); const pBest=await ls(phone,'ninjaDojo.best'); await idle(phone);
  await load(laptop); const lw=await waitLS(laptop,'as.season','2'); await sleep(3000); const lBest=await ls(laptop,'ninjaDojo.best'); await idle(laptop);
  ok(pw&&pBest===null,'phone cleared its saved score');
  ok(lw&&lBest===null,'laptop cleared its saved score');
  ok(pw&&lw,'both devices are on season 2');

  console.log('5. Old scores do not come back');
  await sleep(4000);
  const board2=await (await fetch(SVC+'/api/leaderboard?game=ninja-dojo')).json();
  ok(board2.entries.length===0,'leaderboard still empty after both devices ran');
  const stale=await fetch(SVC+'/api/sync',{method:'POST',headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify({game:'ninja-dojo',best:150000,season:1})});
  ok(stale.status===409,'a device still on the old season is refused (409)');
  const dev=await device(b,'old-device',{'ninjaDojo.best':'150000','as.season':'1'}); await load(dev); await sleep(2000);
  ok(await ls(dev,'ninjaDojo.best')===null,'a signed-out device with an old 150,000 is cleared as well');
  await idle(dev);

  console.log('6. New season: play, sync across devices');
  await load(phone); await phone.p.evaluate(()=>localStorage.setItem('ninjaDojo.best','5000')); await sleep(3500); await idle(phone);
  const board3=await (await fetch(SVC+'/api/leaderboard?game=ninja-dojo')).json();
  ok(board3.entries.length===1&&board3.entries[0].best===5000,'new board shows 5,000');
  await load(laptop);
  ok(await waitLS(laptop,'ninjaDojo.best','5000'),'laptop picked up 5,000');

  console.log('7. Switching back is possible (nothing was deleted)');
  await fetch(SVC+'/__season/1');
  const me4=await (await fetch(SVC+'/api/me',{headers:{authorization:'Bearer '+tok}})).json();
  ok(me4.games['ninja-dojo'].best===150000,'season 1 data is still there: 150,000');

  console.log(fails?`\n${fails} CHECK(S) FAILED`:'\nALL CHECKS PASSED');
  await b.close(); process.exit(fails?1:0);
})();
