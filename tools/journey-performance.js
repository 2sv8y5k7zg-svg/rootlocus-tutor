'use strict';
// Diagnostic only: headless compositor and synthetic click, not physical-device FPS or input latency.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',timeout:15000});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},offline:true});
    const file=path.resolve(__dirname,'../dist/rootlocus-tutor.html');
    await page.goto(pathToFileURL(file).href); await page.bringToFront();
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    const before=await cdp.send('Performance.getMetrics');
    const result=await page.evaluate(()=>new Promise(resolve=>{
      const gaps=[],longTasks=[],states=[document.visibilityState];let last=0,frames=0;
      const observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>longTasks.push({start:e.startTime,duration:e.duration})));
      observer.observe({type:'longtask',buffered:false});
      const started=performance.now();
      function frame(now) {
        if(last) gaps.push(now-last);last=now;frames++;
        if(frames===60) document.querySelector('#btn-begin').click();
        if(frames<181) requestAnimationFrame(frame);
        else {states.push(document.visibilityState);observer.disconnect();resolve({gaps,longTasks,states,elapsed:performance.now()-started,scroll:scrollY});}
      }
      requestAnimationFrame(frame);
    }));
    const after=await cdp.send('Performance.getMetrics');const sorted=[...result.gaps].sort((a,b)=>a-b);
    result.summary={samples:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),longTasks:result.longTasks.length};
    result.rendererSeconds={};for(const key of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']) result.rendererSeconds[key]=after.metrics.find(m=>m.name===key).value-before.metrics.find(m=>m.name===key).value;
    result.browser=browser.version();result.viewport=[1440,1000];result.sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    result.condition='Headless Chrome, file:// offline, brought to front, 60 intro frames then synthetic CTA click; not real input-latency or physical-device smoothness validation';
    fs.writeFileSync(path.resolve(__dirname,'../docs/shots/fluid-study/performance.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({summary:result.summary,states:result.states,rendererSeconds:result.rendererSeconds}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
