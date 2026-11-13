'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
require('../app/js/welcome-copy.js');
const checks=[], bounds=[], errors=[];
function check(name,ok){if(!ok)throw Error(name);checks.push(name);}
for(const [h,text] of [[7,'아침'],[14,'오후'],[19,'저녁'],[1,'밤']]) check('local greeting '+h,RL.welcomeCopy.choose(h,false,()=>.75).greeting.includes(text));
check('returning greeting requires history',RL.welcomeCopy.choose(7,true,()=>.99).greeting.includes('다시')&&!RL.welcomeCopy.choose(7,false,()=>.99).greeting.includes('다시'));
(async()=>{
 const browser=await chromium.launch({channel:'chrome'}), file=path.resolve(__dirname,'../dist/rootlocus-tutor.html'),out=path.resolve(__dirname,'../docs/shots/fluid-study');
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},offline:true});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.envelope={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
   for(const key of ['moveTo','lineTo']){const original=CanvasRenderingContext2D.prototype[key];CanvasRenderingContext2D.prototype[key]=function(x,y){if(this.canvas.id==='math-field'){const b=window.envelope;b.minX=Math.min(b.minX,x);b.minY=Math.min(b.minY,y);b.maxX=Math.max(b.maxX,x);b.maxY=Math.max(b.maxY,y);}return original.call(this,x,y);};}
  });
  for(const size of [[876,812],[1440,900],[1194,834],[834,1194],[390,844],[360,740]]){
   await page.setViewportSize({width:size[0],height:size[1]});await page.goto(pathToFileURL(file).href);await page.waitForTimeout(250);
   await page.mouse.move(size[0]*.35,size[1]*.35);await page.mouse.move(size[0]*.65,size[1]*.5,{steps:12});await page.waitForTimeout(600);
   const b=await page.evaluate(()=>({...window.envelope,top:document.querySelector('.top').getBoundingClientRect().bottom,bottom:document.querySelector('#btn-begin').getBoundingClientRect().top}));
   bounds.push({size,...b});check('surface fits nav/CTA and width '+size,b.minX>0&&b.maxX<size[0]&&b.minY>b.top&&b.maxY<b.bottom);
  }
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.click('#btn-begin');await page.waitForTimeout(1400);
  const l=await page.locator('.start-left').boundingBox(),r=await page.locator('.start-right').boundingBox();
  check('equal panel widths and aligned top/bottom',Math.abs(l.width-r.width)<1&&Math.abs(l.y-r.y)<1&&Math.abs(l.height-r.height)<1);
  check('desktop CTA fits viewport',(await page.locator('#btn-start').boundingBox()).y<850);
  check('AI status beside CTA removed',await page.locator('#ai-status').count()===0);
  const greeting=await page.innerText('#input-title'),first=await page.innerText('#preview-caption');
  check('separate tour clearly labeled',first.includes('예제 둘러보기')&&(await page.getAttribute('#preview-graph','aria-label')).includes('입력한 식과 별개'));
  await page.waitForTimeout(7500);check('actual engine branches drawn',await page.locator('#preview-graph .branch').count()>0);
  await page.click('#preview-play');const phase=await page.innerText('#preview-phase');await page.waitForTimeout(1800);
  check('pause holds phase',phase===await page.innerText('#preview-phase'));
  check('pause holds SVG animations',await page.locator('#preview-graph').evaluate(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='paused')));
  await page.click('#preview-play');await page.waitForTimeout(14500);
  check('slow tour advances to different example',first!==await page.innerText('#preview-caption'));
  await page.locator('#tf-input').fill('K/(');await page.waitForTimeout(200);
  check('editing immediately takes control',await page.getAttribute('.start-right','data-preview-mode')==='input'&&await page.locator('#preview-graph .mk').count()===0);
  await page.locator('#tf-input').fill('K/(s(s+2))');await page.waitForTimeout(200);
  check('input preview matches two actual poles',await page.locator('#preview-graph .mk.pole').count()===2);
  await page.waitForTimeout(20500);check('tour cannot overwrite user input',(await page.innerText('#preview-caption')).includes('입력한 식')&&await page.locator('#preview-graph .mk.pole').count()===2);
  check('greeting remains stable during visit',greeting===await page.innerText('#input-title'));
  await page.emulateMedia({reducedMotion:'reduce'});await page.click('#preview-tour');
  check('reduced motion offers explicit next example',await page.innerText('#preview-play')==='다음 예제');
  // Start a fresh tour bag, then six explicit scenes: every example once, no repeat.
  await page.locator('#tf-input').fill('K/(s(s+2))');await page.click('#preview-tour');
  const names=[];for(let i=0;i<6;i++){names.push(await page.innerText('#preview-caption'));await page.click('#preview-play');}
  check('shuffle bag covers all six examples',new Set(names).size===6);
  const still=await page.innerText('#preview-caption');await page.waitForTimeout(1500);check('reduced tour stays still',still===await page.innerText('#preview-caption'));
  check('no runtime errors',errors.length===0);
  fs.writeFileSync(path.join(out,'fluid-checks.json'),JSON.stringify({sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),browser:browser.version(),checks,bounds,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
