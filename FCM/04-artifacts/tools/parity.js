#!/usr/bin/env node
/* FCM parity harness.
 *
 *   node FCM/04-artifacts/tools/parity.js
 *
 * Three questions, answered mechanically so nobody has to notice drift by eye:
 *   1. Does every view in every role render without throwing?
 *   2. Does any role see something it has no business seeing?
 *   3. Does the shared design language still match the frozen teacher app?
 *
 * Exits non-zero on failure, so it can gate a push.
 */
const {chromium}=require('playwright');
const path=require('path');
const ART='file://'+encodeURI(path.resolve(__dirname,'..'))+'/';
const APP=ART+'fcm-app.html';
const FROZEN=ART+'teacher-app-mobile.html';

const PROPS=['fontSize','lineHeight','fontWeight','color','backgroundColor','borderRadius',
  'paddingTop','paddingBottom','paddingLeft','paddingRight','minHeight','borderColor','borderWidth'];
const SEL=['.row','.card','.mini.lbl','.primary','.second','.av','.tp','.ch','.sg','.sh-h','.flabel',
  '.empty','.qr','.gr','.gvv','.opt','.on2','.dc','.cread','.rs-b','.chip','.grab'];

/* Differences we have decided are correct. Anything not listed is a failure. */
const ACCEPTED={
  '.primary borderColor':'blue-500 measured 2.99:1 on the card and missed the 3:1 non-text minimum (WCAG 1.4.11); blue-700 is 6.37:1',
  '.opt borderRadius':'both files end on the same .opt rule; the synthetic probe cannot reproduce which earlier rule wins in context',
  '.rs-b paddingRight':'the director KPI tile carries longer labels and needs the 10px gutter',
};

const probe=(p,sels)=>p.evaluate(({sels,PROPS})=>{
  const host=document.querySelector('.screen')||document.body;
  const d=document.createElement('div');
  d.style.cssText='position:absolute;left:-9999px;top:0;width:340px';host.appendChild(d);
  const out={};
  for(const s of sels){
    const el=document.createElement('span');          // neutral tag, so neither
    el.className=s.replace(/^\./,'').split('.').join(' ');  // file's button
    el.textContent='Xy'; el.style.display='block';    // defaults skew the read
    d.appendChild(el); const cs=getComputedStyle(el);
    out[s]={}; PROPS.forEach(k=>out[s][k]=cs[k]); d.removeChild(el);
  }
  host.removeChild(d); return out;},{sels,PROPS});

(async()=>{
  const b=await chromium.launch(); let fail=0;
  const open=async u=>{const p=await b.newPage({viewport:{width:410,height:864}});
    p.on('pageerror',e=>{console.log('  THROW:',e.message);fail++;});await p.goto(u);return p;};

  for(const role of ['director','teacher']){
    const p=await open(APP+'?role='+role);
    const meta=await p.evaluate(()=>({who:ROLE.who,tabs:TABS.map(t=>t[1]).join(' · '),
      reach:Object.keys(V).filter(allowed).length,block:Object.keys(V).filter(v=>!allowed(v)).length}));
    console.log(`\n${role.toUpperCase()} — ${meta.who}`);
    console.log(`  ${meta.tabs}`);
    console.log(`  ${meta.reach} views reachable, ${meta.block} blocked`);

    /* 1. every view renders, nothing clips */
    for(const v of await p.evaluate(()=>Object.keys(V).filter(allowed))){
      await p.evaluate(v=>{S.sub=v;render();},v);
      const clip=await p.evaluate(()=>[...document.querySelectorAll('.body *')]
        .filter(e=>getComputedStyle(e).overflow==='hidden'&&e.clientHeight>0&&e.scrollHeight>e.clientHeight+2)
        .map(e=>e.className));
      if(clip.length){console.log('  CLIP',v,clip.slice(0,2));fail++;}
    }
    /* 2. nothing leaks across the role boundary */
    const leak=await p.evaluate(()=>{const hits=[];
      for(const v of Object.keys(V).filter(allowed)){S.sub=v;render();const t=document.body.innerText;
        if(!CAN.money && /revenue|invoice|overdue|subsidy|payroll|\$\d/i.test(t)) hits.push(v+': money');
        if(!CAN.staff && /credential|certification|timesheet/i.test(t)) hits.push(v+': staff');
        if(CAN.rooms==='one'){const o=KIDS.filter(k=>k.room!==ROLE.room&&t.includes(k.name));
          if(o.length) hits.push(v+': '+o[0].name+' is not in this room');}}
      S.sub=null;S.tab=TABS[0][0];render();return [...new Set(hits)];});
    if(leak.length){console.log('  LEAKS:');leak.forEach(l=>console.log('   ·',l));fail+=leak.length;}
    else console.log('  no cross-role leaks');

    /* 3. every action fires without throwing */
    let fired=0;
    for(const tid of await p.evaluate(()=>TABS.map(t=>t[0]))){
      await p.evaluate(t=>{S.tab=t;S.sub=null;render();},tid);
      for(const a of await p.evaluate(()=>[...document.querySelectorAll('[data-act]')].map(e=>e.getAttribute('data-act')))){
        await p.evaluate(a=>doAct(a),a); fired++;
        for(const s2 of await p.evaluate(()=>[...document.querySelectorAll('#sheet [data-act]')].map(e=>e.getAttribute('data-act')))){
          await p.evaluate(s2=>doAct(s2),s2); fired++; }
        await p.evaluate(t=>{closeSheet();S.selecting=false;S.sub=null;S.tab=t;render();},tid);}}
    console.log('  '+fired+' actions fired');
    await p.close();
  }

  /* 4. the shared design language still matches the frozen teacher app */
  console.log('\nDESIGN PARITY — teacher role vs frozen teacher app');
  const a=await probe(await open(FROZEN),SEL), c=await probe(await open(APP+'?role=teacher'),SEL);
  let unexpected=[];
  for(const s of SEL) for(const k of PROPS) if(a[s][k]!==c[s][k]){
    const key=`${s} ${k}`;
    if(ACCEPTED[key]) console.log(`  accepted · ${key}\n      ${ACCEPTED[key]}`);
    else {unexpected.push(`  DRIFT · ${key}: frozen=${a[s][k]} new=${c[s][k]}`);}
  }
  console.log(`  ${SEL.length} components × ${PROPS.length} properties compared`);
  if(unexpected.length){unexpected.forEach(u=>console.log(u));fail+=unexpected.length;}
  else console.log('  no unexpected drift');

  console.log(fail?`\nFAILED — ${fail} problem${fail===1?'':'s'}`:'\nPASS');
  await b.close(); process.exit(fail?1:0);
})();
