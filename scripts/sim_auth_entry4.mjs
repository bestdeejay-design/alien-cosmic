// Real game + auth + boot, canonical harness from alien-cosmic 20db44a.
import {fireWindow} from './harness.mjs';
import assert from 'node:assert/strict';
const mode=process.argv[2]||'cloud';
const KEY='ac_raid_session_v1';
const nativeInterval=globalThis.setInterval;
globalThis.setInterval=(fn,ms,...args)=>{const id=nativeInterval(fn,ms,...args);id.unref?.();return id;};
const callbacks={};
const oldAdd=globalThis.addEventListener;
globalThis.addEventListener=(ev,fn)=>{(callbacks[ev]||=[]).push(fn);oldAdd(ev,fn);};
globalThis.location={protocol:'http:',hostname:'test.invalid',reload(){}};
globalThis.dispatchEvent=()=>true;
globalThis.confirm=()=>mode!=='cancel-replace';
let cloud=null,ts=12345,raidSaves=0,offline=false,hold=null;
const resp=(status,j)=>({status,ok:status>=200&&status<300,headers:{get:()=>null},json:async()=>j});
globalThis.fetch=async(url,opts={})=>{
 const path=String(url),body=JSON.parse(opts.body||'{}');
 if(offline)throw new Error('offline');
 if(path.endsWith('/health'))return resp(200,{ok:true});
 if(path.endsWith('/api/load')){
  if(body.key==='__check__'){if(mode==='late-login'&&hold)await hold;return resp(200,{ok:false,error:'not found',player:body.player});}
  if(body.key===KEY){if(hold)await hold;return cloud==null?resp(200,{ok:false,error:'not found'}):resp(200,{ok:true,value:cloud,ts});}
  return resp(200,{ok:false,error:'not found'});
 }
 if(path.endsWith('/api/save')){if(body.key===KEY&&mode==='save-fail')return resp(503,{ok:false,error:'test write failure'});if(body.key===KEY){cloud=body.value;ts++;raidSaves++;}return resp(200,{ok:true,ts});}
 return resp(200,{ok:true,records:[]});
};
Object.defineProperty(globalThis.navigator,'sendBeacon',{configurable:true,value:(url,body)=>{throw new Error('unexpected beacon before decision');}});
await import('../r/js/game.js');
const g=window.game;
g.startRaidHome('human',{forceNew:true});
const cc=()=>g.state.buildings.find(b=>!b.dead&&b.side==='player'&&b.type==='cc');
const setErg=(n)=>{g.state.minerals.player=n;if(g.raidSession&&g.raidSession.schema===2&&g.raidSession.alarmV2){g.raidSession.alarmV2.walletMicro=(BigInt(Math.round(n))*1000000n).toString();}};
cc().level=16;cc().maxHp=3750;cc().hp=3750;setErg(336692);g.raidSession.raidSeq=18;g.syncRaidHomeSnapshot();
cloud=JSON.stringify(g.raidSession);const originalCloud=cloud;
g.raidSession=null;g.started=false;localStorage.removeItem(KEY);
if(mode==='remembered'){localStorage.setItem('ac_save_nick','test');localStorage.setItem('ac_save_pin','1234');}
await import('../r/save-client.js');
const save=window.__saveApi;
const A=await import('../r/js/auth-ui.js?v=10271846');
const wait=async(pred)=>{for(let i=0;i<250;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`timeout ${mode}: ${A.auth.step}`);};
const overlay=()=>document.body.children.find(c=>c.id==='auth-overlay'&&!c.classList.contains('hidden'));
const click=id=>{const el=overlay()?.querySelector(id);assert(el,`missing ${id}`);el.click();};
const boot=import('../r/raid-boot.js');
await wait(()=>A.isAuthOpen());
assert.equal(g.started,false,'simulation must wait on entry screen');
assert.equal(raidSaves,0);assert.equal(ts,12345);
const submit=async()=>{assert(A.goToPin('test'));const r=await A.submitPin('1234');assert(r.ok);};
if(['cloud','remembered','empty','corrupt'].includes(mode)){
 if(mode==='empty')cloud=null;
 if(mode==='corrupt')cloud='{broken';
 await submit();
 if(mode==='corrupt'){
  await wait(()=>A.auth.step==='offline');assert.equal(save.raidWriteReady,false);assert.equal(g.raidAuthPending,true);click('#auth-close');
 }
 await boot;
 if(mode==='empty'||mode==='corrupt')assert.equal(cc().level,1);
 else {assert.equal(cc().level,16);assert.equal(g.state.minerals.player,336692);/* П2: capturedAt жив при каждом снимке — сравниваем состав без метки */assert.equal(cloud.replace(/"capturedAt":\d+,?/g,''),originalCloud.replace(/"capturedAt":\d+,?/g,''));assert.equal(ts,12345);}
} else {
 if(mode==='escape')fireWindow('keydown',{key:'Escape',code:'Escape'});else click('#auth-close');await boot;
 assert.equal(save.identity,null);assert.equal(cc().level,1);
 if(mode==='skip'||mode==='escape'){
  await save.pushKey(KEY);fireWindow('pagehide');assert.equal(raidSaves,0);assert(localStorage.getItem(save.guestRaidKey));
 }else{
  cc().level=7;setErg(7777);g.syncRaidHomeSnapshot();
  if(mode==='guest-empty')cloud=null;
  if(mode==='offline')offline=true;
  A.openAuth(g,{step:'login'});
  if(mode==='offline'){
   assert(A.goToPin('test'));const r=await A.submitPin('1234');assert(!r.ok);click('#auth-close');
   await new Promise(r=>setTimeout(r,5)); // ace#10 Ф-4: enterGuest теперь асинхронный (промоция) — пауза снимается в микротаске
   assert.equal(save.identity,null);assert.equal(g.paused,false);assert.equal(cc().level,7);assert.equal(ts,12345);
  }else{
   if(mode==='late-login'){
    let release;hold=new Promise(r=>release=r);assert(A.goToPin('test'));const pending=A.submitPin('1234');await new Promise(r=>setTimeout(r,10));click('#auth-close');release();await pending;assert.equal(save.identity,null);assert.equal(cc().level,7);assert.equal(ts,12345);
   }else if(mode==='late-skip'){
    let release;hold=new Promise(r=>release=r);await submit();await wait(()=>A.auth.step==='pull');click('#auth-close');release();await new Promise(r=>setTimeout(r,40));
    assert.equal(save.identity,null);assert.equal(cc().level,7);assert.equal(ts,12345);
   }else{
    await submit();
    if(mode==='guest-empty'){
     await wait(()=>!A.isAuthOpen());assert.equal(JSON.parse(cloud).homeDto.minerals,7777); // detailed world assertions below
     assert.equal(cc().level,7);assert.equal(raidSaves,1);
    }else{
     await wait(()=>A.auth.step==='choice');
     const before=cloud,stamp=ts;
     g.syncRaidHomeSnapshot();await save.pushKey(KEY);await save.pushAll();fireWindow('pagehide');fireWindow('beforeunload');
     assert.equal(cloud,before);assert.equal(ts,stamp);assert.equal(raidSaves,0);assert.equal(cc().level,7);
     if(mode==='load-cloud'){
      click('#auth-load-cloud');
      // ace#10 Ф-4 (ревизия): применение облачного снапшота идёт через
      // промоцию (async, Web Locks) — ждём подъёма базы, потом сверяем.
      await wait(()=>cc().level===16);
      assert.equal(cc().level,16);assert.equal(g.state.minerals.player,336692);assert.equal(cloud,before);assert.equal(ts,stamp);
     }else if(mode==='cancel-replace'){
      click('#auth-save-guest');await new Promise(r=>setTimeout(r,20));assert.equal(cloud,before);assert.equal(ts,stamp);assert.equal(A.auth.step,'choice');click('#auth-close');await new Promise(r=>setTimeout(r,5));assert.equal(cc().level,7);assert.equal(g.paused,false);
     }else if(mode==='save-fail'){
      click('#auth-save-guest');await wait(()=>A.auth.step==='guest-save-error');assert.equal(raidSaves,0);assert.equal(cloud,before);assert.equal(ts,stamp);assert.equal(save.raidWriteReady,false);click('#auth-close');await new Promise(r=>setTimeout(r,5));assert.equal(cc().level,7);assert.equal(g.paused,false);
     }else if(mode==='replace'){
      click('#auth-save-guest');await wait(()=>!A.isAuthOpen());assert.equal(cc().level,7);assert.equal(raidSaves,1);assert.notEqual(cloud,before);assert.equal(g.state.minerals.player,7777);
     }
    }
   }
  }
 }
}
console.log(`PASS ${mode}: real engine/auth/boot, write barrier, snapshot and ts assertions`);
process.exit(0);
