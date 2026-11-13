/* Run: node tools/journey-check.js (Playwright for Node required).
 * PLAYWRIGHT_MODULE may point to an existing Playwright package in the test environment.
 * This is tooling only, not an HTML dependency.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), html = path.join(root, 'dist/rootlocus-tutor.html');
const out = path.join(root, 'docs/shots/mathematical-journey');
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], requests = [], layouts = [];
function check(name, ok) { if (!ok) throw Error(name); checks.push(name); }
const sleep = (page, ms) => page.waitForTimeout(ms);
async function capture(page, name, fullPage = false) {
  await sleep(page, 1100);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage });
  check(name + ': no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
}
async function main() {
  let browser;
  for (const opts of [{channel:'chrome'}, {}, {channel:'msedge'}]) {
    try { browser = await chromium.launch({...opts, timeout:15000}); break; } catch (_) {}
  }
  if (!browser) throw Error('No test browser available');
  try {
    async function pageFor(size, touch = false) {
      const context = await browser.newContext({viewport:{width:size[0],height:size[1]},offline:true,hasTouch:touch});
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
      page.on('request', r => {if(/^https?:/.test(r.url())) requests.push(r.url());});
      await page.addInitScript(() => {
        window.canvasFrames = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function(...a) { window.canvasFrames++; return clear.apply(this,a); };
      });
      await page.goto(pathToFileURL(html).href);
      return page;
    }
    const page = await pageFor([1440,1000]);
    const visibility = await page.evaluate(() => document.visibilityState);
    const frames = () => page.evaluate(() => window.canvasFrames);
    await capture(page,'welcome');
    const before = await frames(); await sleep(page,400);
    check('intro continues moving without pointer', (await frames()) > before+2);
    check('intro has no visible title or marketing copy', await page.locator('#screen-welcome').innerText() === '근궤적 탐구 시작\n학습 시작 ↓' || await page.locator('#screen-welcome h1').evaluate(e=>getComputedStyle(e).clipPath==='inset(50%)'));
    check('integrated CTA has no filled rectangle', await page.locator('#btn-begin').evaluate(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(e).borderTopWidth==='0px'));
    await page.mouse.move(1100,700); await sleep(page,100);
    check('pointer adds shallow background depth', await page.locator('#atmosphere').evaluate(e=>parseFloat(e.style.getPropertyValue('--drift-x'))>0));
    // Capture the genuine midpoint, then settled view, from the same file.
    await page.click('#btn-begin'); await sleep(page,250);
    const mid = await page.evaluate(()=>scrollY);
    check('start button initiates actual document scrolling', mid > 0 && mid < 964);
    await page.screenshot({path:path.join(out,'transition.png')});
    check('both journey sections stay in document', !await page.isHidden('#screen-welcome') && !await page.isHidden('#screen-start'));
    await sleep(page,1400);
    check('input receives desktop focus', await page.locator('#tf-input').evaluate(e=>document.activeElement===e));
    check('input settles at intended position', Math.abs(await page.locator('#screen-start').evaluate(e=>e.getBoundingClientRect().top)-36)<2);
    check('fog fully clears for readable input', await page.locator('.start-left').evaluate(e=>getComputedStyle(e).filter==='none'));
    await capture(page,'input');
    await page.locator('#photo-file').setInputFiles({name:'local-test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64')});
    check('offline photo remains local reference only', await page.isHidden('#photo-send') && (await page.innerText('#photo-panel')).includes('자동 인식 연결이 없어'));
    await page.click('#photo-cancel');
    let stopped = await frames(); await sleep(page,250);
    check('canvas stops when intro leaves viewport', stopped===await frames());
    await page.fill('#tf-input','K^2/(s+1)'); await sleep(page,200);
    check('invalid equation remains blocked', await page.isDisabled('#btn-start') && await page.getAttribute('#tf-input','aria-invalid')==='true');
    await capture(page,'error');
    await page.locator('.ex').nth(1).click(); await page.click('#btn-start');
    await page.locator('.st').nth(8).click(); await page.click('.kq[data-k="0"]');
    await page.locator('.st').nth(7).click(); await page.locator('.st').nth(8).click();
    check('K=0 survives step round trip', await page.innerText('#k-val')==='0');
    check('one graph-adjacent slider', await page.locator('#k-slider').count()===1 && await page.locator('.stage #k-slider').count()===1);
    await page.focus('#k-slider'); await page.keyboard.press('ArrowRight');
    check('keyboard changes actual K', await page.innerText('#k-val')!=='0');
    await capture(page,'lesson',true);
    stopped = await frames(); await sleep(page,250);
    check('decorative animation stops during lesson', stopped===await frames());
    await page.evaluate(()=>{for(let i=0;i<10;i++){document.querySelector('#btn-home').click();document.querySelector('#btn-start').click();document.querySelectorAll('.st')[8].click();}});
    await sleep(page,1100);
    check('rapid scroll/screen transitions do not reappear', await page.isHidden('#screen-welcome') && await page.evaluate(()=>scrollY)===0 && await page.getAttribute('[aria-current="step"]','data-i')==='8');
    await page.click('#btn-records'); await page.keyboard.press('Shift+Tab');
    check('dialog backward Tab wraps', await page.locator('#records-list button').last().evaluate(e=>document.activeElement===e));
    await page.keyboard.press('Tab');
    check('dialog forward Tab wraps', await page.locator('#records-close').evaluate(e=>document.activeElement===e));
    await page.keyboard.press('Escape');
    check('dialog focus returns', await page.locator('#btn-records').evaluate(e=>document.activeElement===e));
    await page.click('#btn-records'); await page.locator('[data-act="resume"]').first().click();
    check('history restores step', await page.getAttribute('[aria-current="step"]','data-i')==='8');
    await page.click('#btn-motion'); await page.reload();
    check('motion setting persists', await page.getAttribute('html','data-motion')==='reduced');
    stopped = await frames(); await sleep(page,300);
    check('app reduced motion stops canvas', stopped===await frames());
    await page.click('#btn-begin');
    check('reduced motion scrolls immediately', Math.abs(await page.locator('#screen-start').evaluate(e=>e.getBoundingClientRect().top)-36)<2);
    await page.click('#btn-welcome'); await page.click('#btn-motion');
    await page.emulateMedia({reducedMotion:'reduce'}); await sleep(page,100);
    stopped = await frames(); await sleep(page,300);
    check('OS reduced motion stops canvas', stopped===await frames());
    await page.click('#btn-begin'); await page.click('#btn-start'); await page.locator('.st').nth(2).click();
    check('OS reduction also stops graph animation', await page.locator('#main-graph').evaluate(e=>e.getAnimations({subtree:true}).length)===0);
    await page.locator('.lv').nth(2).click();
    check('offline static hints remain', (await page.innerText('#ladder-out')).length>20);
    await page.locator('.st').nth(3).click(); await page.locator('.lv').nth(2).click();
    await page.locator('.q').first().click();
    check('static question explanation remains', (await page.innerText('#q-out')).length>10);
    await page.click('#btn-example'); await page.keyboard.press('Shift+Tab');
    check('example dialog traps keyboard focus', await page.locator('#example').evaluate(e=>e.contains(document.activeElement)));
    await page.click('#ex-back');
    check('example returns to original lesson', await page.isHidden('#example') && await page.getAttribute('[aria-current="step"]','data-i')==='3');
    // No stale smooth scroll: rapid forward/backward clicks settle at latest intent.
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.click('#brand'); await sleep(page,900);
    await page.evaluate(()=>{document.querySelector('#btn-begin').click();document.querySelector('#btn-welcome').click();document.querySelector('#btn-begin').click();});
    await sleep(page,1400);
    check('latest scroll intent wins', Math.abs(await page.locator('#screen-start').evaluate(e=>e.getBoundingClientRect().top)-36)<2);
    for(let ex=0;ex<6;ex++) {
      await page.locator('.ex').nth(ex).click(); await page.click('#btn-start');
      for(let step=0;step<9;step++) {
        await page.locator('.st').nth(step).click();
        check(`example ${ex+1} step ${step+1}`, await page.getAttribute('[aria-current="step"]','data-i')===String(step) && !!await page.innerText('#step-body h2'));
      }
      await page.locator('.kq').last().click(); await capture(page,`graph-${ex+1}`);
      await page.click('#btn-home'); await sleep(page,900);
    }
    await page.evaluate(()=>localStorage.setItem('rltutor.records.v1','[null,{}, {"lastStep":999}]'));
    await page.reload(); await page.click('#btn-records');
    check('corrupt history ignored', (await page.innerText('#records-list')).includes('아직 기록이 없습니다'));
    await page.keyboard.press('Escape');
    for (const [name,size,touch] of [['ipad-landscape',[1194,834],true],['ipad-portrait',[834,1194],true],['mobile',[390,844],true],['small-mobile',[360,740],true]]) {
      const p=await pageFor(size,touch); await capture(p,name+'-welcome');
      await p.click('#btn-begin'); await sleep(p,1300);
      check(name+': touch does not auto-open keyboard', await p.locator('#screen-start h1').evaluate(e=>document.activeElement===e));
      await capture(p,name+'-input'); await p.click('#btn-start'); await p.locator('.st').nth(8).click();
      await p.click('.kq[data-k="0"]'); await p.evaluate(()=>window.scrollTo(0,0)); await capture(p,name+'-lesson',true);
      const g=await p.locator('.plane-wrap').boundingBox(), k=await p.locator('#k-controls').boundingBox();
      check(name+': K remains adjacent to graph', Math.abs(k.y-g.y-g.height-16)<1);
      layouts.push({name,viewport:size,touchEmulation:touch,graphHeight:g.height,KGap:k.y-g.y-g.height});
      await p.context().close();
    }
    check('no external requests',requests.length===0); check('no page/console errors',errors.length===0);
    const report={sha256:crypto.createHash('sha256').update(fs.readFileSync(html)).digest('hex'),browser:browser.version(),visibility,
      environment:'Windows headless Chrome; file://; offline; viewport and touch emulation, not physical devices',checks,layouts,requests,errors};
    fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:checks.length,browser:browser.version(),layouts,errors}));
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
