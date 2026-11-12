"""File:// offline UI checks and captures. Run from root: python tools/design-check.py.
Viewport simulation in desktop Chromium, not Safari or physical touch testing.
"""
import hashlib
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'dist/rootlocus-tutor.html'
OUT = ROOT / 'docs/shots/quiet-depth'
OUT.mkdir(parents=True, exist_ok=True)
checks, errors, requests, layouts = [], [], [], []

def check(label, condition):
    assert condition, label
    checks.append(label)

def open_page(browser, size):
    ctx = browser.new_context(viewport=dict(width=size[0], height=size[1]), offline=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
    page.goto(HTML.as_uri())
    return page

def capture(page, name, full=False):
    page.wait_for_timeout(650)
    page.screenshot(path=str(OUT / (name + '.png')), full_page=full)
    overflow = page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
    check(name + ': no horizontal overflow', overflow == 0)

with sync_playwright() as p:
    browser = None
    for opts in [dict(), dict(channel='msedge'), dict(channel='chrome')]:
        try:
            browser = p.chromium.launch(**opts)
            break
        except Exception:
            pass
    assert browser, 'Install Playwright Chromium or Edge/Chrome'
    pg = open_page(browser, (1440, 1000))
    version = browser.version
    user_agent = pg.evaluate('navigator.userAgent')
    visibility = pg.evaluate('document.visibilityState')
    capture(pg, 'welcome')
    pg.mouse.move(1100, 700)
    pg.wait_for_timeout(650)
    check('decorative depth responds', pg.locator('#screen-welcome').evaluate("e=>parseFloat(e.style.getPropertyValue('--drift-x')) > 0"))
    check('title is never tilted', pg.locator('#welcome-title').evaluate("e=>new DOMMatrix(getComputedStyle(e).transform).isIdentity"))
    pg.mouse.move(1, 1)
    pg.wait_for_timeout(650)
    check('pointer exit resets', pg.locator('#screen-welcome').evaluate("e=>e.style.getPropertyValue('--drift-x') === '0px'"))
    pg.click('#btn-begin')
    check('input receives focus', pg.locator('#tf-input').evaluate('e=>e===document.activeElement'))
    capture(pg, 'input')
    pg.locator('#photo-file').set_input_files(dict(name='local-test.png',mimeType='image/png',buffer=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')))
    check('offline photo is local reference only', pg.is_hidden('#photo-send') and '자동 인식 연결이 없어' in pg.inner_text('#photo-panel'))
    pg.click('#photo-cancel')
    pg.fill('#tf-input', 'K^2/(s+1)')
    pg.wait_for_timeout(200)
    check('invalid input blocks start', pg.is_disabled('#btn-start') and pg.get_attribute('#tf-input','aria-invalid') == 'true')
    capture(pg, 'error')
    pg.locator('.ex').nth(1).click()
    pg.click('#btn-start')
    pg.locator('.st').nth(8).click()
    check('one K control below graph', pg.locator('#k-slider').count() == 1 and pg.locator('.stage #k-slider').count() == 1)
    pg.click('.kq[data-k="0"]')
    pg.locator('.st').nth(7).click()
    pg.locator('.st').nth(8).click()
    check('K zero survives step round trip', pg.inner_text('#k-val') == '0')
    pg.focus('#k-slider')
    pg.keyboard.press('ArrowRight')
    check('keyboard K changes actual value', pg.inner_text('#k-val') != '0' and pg.get_attribute('#k-slider','aria-valuetext').startswith('K = '))
    pg.click('.kq[data-k="0"]')
    capture(pg, 'lesson', True)
    # Actual DOM clicks without Playwright's animation waits exercise same-tick races.
    pg.evaluate("""() => {for(let i=0;i<12;i++) {
      document.querySelector('#btn-home').click(); document.querySelector('#btn-start').click();
      document.querySelectorAll('.st')[2].click(); document.querySelectorAll('.st')[8].click();
    }}""")
    pg.wait_for_timeout(1000)
    check('rapid transitions retain one screen and current step', pg.locator('main:not([hidden])').count() == 1 and pg.get_attribute('[aria-current="step"]','data-i') == '8')
    check('focus remains on visible control', pg.evaluate('document.activeElement.getClientRects().length > 0'))
    pg.click('#btn-records')
    pg.keyboard.press('Shift+Tab')
    check('dialog backward focus wraps', pg.locator('#records-list button').last.evaluate('e=>e===document.activeElement'))
    pg.keyboard.press('Tab')
    check('dialog forward focus wraps', pg.locator('#records-close').evaluate('e=>e===document.activeElement'))
    pg.keyboard.press('Escape')
    check('dialog focus returns', pg.locator('#btn-records').evaluate('e=>e===document.activeElement'))
    pg.click('#btn-records')
    pg.locator('[data-act="resume"]').first.click()
    check('history restores actual saved step', pg.get_attribute('[aria-current="step"]','data-i') == '8')
    pg.click('#btn-motion')
    pg.reload()
    check('motion preference persists', pg.get_attribute('html','data-motion') == 'reduced')
    pg.click('#btn-motion')
    pg.emulate_media(reduced_motion='reduce')
    check('OS reduced motion removes CSS animation', pg.locator('.welcome-sub').evaluate("e=>getComputedStyle(e).animationName==='none'"))
    pg.click('#btn-begin')
    pg.click('#btn-start')
    pg.locator('.st').nth(2).click()
    check('OS reduced motion removes graph animation', pg.locator('#main-graph').evaluate('e=>e.getAnimations({subtree:true}).length===0'))
    pg.locator('.lv').nth(2).click()
    check('offline static hints work', len(pg.inner_text('#ladder-out')) > 20)
    pg.emulate_media(reduced_motion='no-preference')
    pg.click('#btn-home')
    for ex in range(6):
        pg.locator('.ex').nth(ex).click()
        pg.click('#btn-start')
        for step in range(9):
            pg.locator('.st').nth(step).click()
            check('example %d step %d' % (ex+1, step+1), pg.get_attribute('[aria-current="step"]','data-i') == str(step) and bool(pg.inner_text('#step-body h2')))
        pg.locator('.kq').last.click()
        pg.wait_for_timeout(300)
        capture(pg, 'graph-%d' % (ex+1))
        pg.click('#btn-home')
    pg.evaluate("localStorage.setItem('rltutor.records.v1','[null,{}, {\"lastStep\":999}]')")
    pg.reload()
    pg.click('#btn-records')
    check('corrupt record entries safely ignored', '아직 기록이 없습니다' in pg.inner_text('#records-list'))
    pg.keyboard.press('Escape')
    pg.click('#btn-begin')
    pg.click('#btn-start')
    check('normal start after corrupt history', pg.get_attribute('[aria-current="step"]','data-i') == '0')
    for name, size in [('ipad-landscape',(1194,834)), ('ipad-portrait',(834,1194)), ('mobile',(390,844)), ('small-mobile',(360,740))]:
        page = open_page(browser, size)
        capture(page,name+'-welcome')
        page.click('#btn-begin')
        capture(page,name+'-input')
        page.click('#btn-start')
        page.locator('.st').nth(8).click()
        page.click('.kq[data-k="0"]')
        page.evaluate('window.scrollTo(0,0)')
        capture(page,name+'-lesson',True)
        graph_box = page.locator('.plane-wrap').bounding_box()
        control_box = page.locator('#k-controls').bounding_box()
        gap = control_box['y'] - graph_box['y'] - graph_box['height']
        check(name+': K controls adjacent', 0 <= gap <= 20)
        check(name+': graph and slider fit viewport together', page.locator('#k-slider').bounding_box()['y'] + 32 - graph_box['y'] < size[1])
        layouts.append(dict(name=name,viewport=size,gap=gap,graph_height=graph_box['height']))
        page.context.close()
    check('no external network requests', not requests)
    check('no page or console errors', not errors)
    report = dict(sha256=hashlib.sha256(HTML.read_bytes()).hexdigest(),browser=version,user_agent=user_agent,visibility=visibility,
                  mode='headless Chromium, file://, offline context; viewport simulation only',checks=checks,layouts=layouts,errors=errors,requests=requests)
    (OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(checks=len(checks),browser=version,layouts=layouts,errors=errors),ensure_ascii=False))
    browser.close()
