'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const checks=[],errors=[];function check(n,ok){if(!ok)throw Error(n);checks.push(n);}
(async()=>{const browser=await chromium.launch({channel:'chrome'});try{
 const file=path.resolve(__dirname,'../dist/rootlocus-tutor.html'),out=path.resolve(__dirname,'../docs/shots/point-study');fs.mkdirSync(out,{recursive:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},offline:true,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(file).href);await page.click('#btn-begin');await page.click('#btn-start');await page.locator('.st').nth(1).click();
 await page.locator('#main-graph [data-point="p0"]').focus();await page.keyboard.press('Enter');
 check('keyboard point selection shows parameter diagram',await page.locator('#point-inspector svg').count()===1&&(await page.innerText('#point-inspector')).includes('개루프 극점'));
 check('point has pressed accessible state',await page.getAttribute('#main-graph [data-point="p0"]','aria-pressed')==='true');
 await page.locator('#main-graph [data-point="z0"]').click();check('zero has coordinates without pole damping ratio',await page.locator('#point-inspector dt').allTextContents().then(a=>a.join(',')==='실수부 σ,허수부 ω'));
 await page.locator('.st').nth(8).click();await page.click('.kq[data-k="0"]');
 check('K chip opens current pole parameters',(await page.innerText('#point-inspector')).includes('폐루프 극점'));
 await page.locator('.pole-value').last().click();check('negative conjugate coordinates retained',(await page.innerText('#point-inspector h3')).includes('−1 − j'));
 const before=await page.innerText('#point-inspector h3');await page.locator('#k-slider').fill('600');await page.locator('#k-slider').dispatchEvent('input');
 check('selected closed-loop point follows K',before!==await page.innerText('#point-inspector h3'));
 await page.screenshot({path:path.join(out,'parameters.png'),fullPage:true});
 await page.locator('.st').nth(2).click();check('new step clears stale selection',await page.locator('#point-inspector svg').count()===0);
 check('AI hints and chat absent',await page.locator('#coach,#ask-form,.ladder').count()===0);
 const inputs=['K/(s+7)','2K/((s+0.5)(s+4))','K(s+0.3)/(s^2+2s+5)','3K(s+5)/(s^3+7s^2+14s+8)','K/(s^4+8s^3+25s^2+38s+24)','K(s^2+2s+5)/(s^2+6s+13)','K/(s-2)','K/(s+2)^4','K/(s^2+9)','K/s^2','2.5e-3K/(s+2)'];
 for(const input of inputs){await page.click('#btn-home');await page.locator('#tf-input').fill(input);await page.waitForTimeout(180);check('new user input accepted '+input,!await page.isDisabled('#btn-start'));await page.click('#btn-start');for(let i=0;i<9;i++){await page.locator('.st').nth(i).click();check('new input step '+input+'/'+(i+1),await page.getAttribute('[aria-current="step"]','data-i')===String(i));}await page.click('.kq[data-k="0"]');if(input==='K/s^2'){check('double origin UI is unstable',(await page.innerText('#k-status')).includes('불안정'));check('origin zeta is undefined',(await page.innerText('#point-inspector')).includes('정의되지 않음'));}}
 await page.click('#btn-home');await page.locator('#tf-input').fill('1e308*1e308*s/(s+1)');await page.waitForTimeout(180);check('numeric overflow blocks UI with explanation',await page.isDisabled('#btn-start')&&(await page.innerText('#tf-msg')).includes('수치 범위'));
 await page.locator('#tf-input').fill('K/(s(s+3)(s+5))');await page.waitForTimeout(180);await page.click('#btn-start');await page.locator('.st').nth(6).click();
 const cross=page.locator('#main-graph [data-point="x0"]');await cross.last().click();check('negative crossing sign is retained',(await page.innerText('#point-inspector h3')).includes('−'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.locator('.st').nth(8).click();await page.click('.kq[data-k="0"]');
 check('mobile parameters have no overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await page.screenshot({path:path.join(out,'mobile-parameters.png'),fullPage:true});
 check('no runtime errors',errors.length===0);fs.writeFileSync(path.join(out,'point-checks.json'),JSON.stringify({sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),browser:browser.version(),checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
