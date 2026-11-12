"""
smoke.py — 묶은 페이지를 실제 브라우저(헤드리스 Chrome)로 열어 모든 예제·단계를 눌러 보고,
자바스크립트 오류가 없는지와 화면 캡처를 확인합니다.
실행: python3 tools/smoke.py
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8')  # 윈도우 콘솔에서 한글·기호가 깨지지 않게
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
url = (ROOT / 'dist' / 'rootlocus-tutor.html').as_uri()
shots = ROOT / 'docs' / 'shots'
shots.mkdir(parents=True, exist_ok=True)
errors = []
notes = []


def launch_browser(p):
    """윈도우·맥·리눅스 어디서든 쓸 수 있는 브라우저를 찾아 엽니다.
    순서: Playwright 자체 Chromium → Edge(윈도우 기본) → Chrome → 리눅스 Chrome 경로"""
    tries = [dict(), dict(channel='msedge'), dict(channel='chrome'),
             dict(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])]
    last = None
    for opt in tries:
        try:
            return p.chromium.launch(**opt)
        except Exception as e:
            last = e
    raise SystemExit('브라우저를 찾지 못했습니다. "python -m playwright install chromium"을 먼저 실행해 주세요.\n' + str(last)[:300])


def on_console(m):
    if m.type != 'error':
        return
    if 'Failed to load resource' in m.text:  # 인터넷이 없으면 글꼴(Google Fonts)만 못 불러옴 — 동작에는 영향 없음
        notes.append(m.text)
    else:
        errors.append('console: ' + m.text)


with sync_playwright() as p:
    br = launch_browser(p)
    # 1) 노트북 크기: 모든 예제 × 9단계
    pg = br.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('console', on_console)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.goto(url)
    pg.click('#btn-begin')
    pg.wait_for_timeout(600)
    n_ex = pg.locator('#examples .ex').count()
    for e in range(n_ex):
        pg.locator('#examples .ex').nth(e).click()
        pg.wait_for_timeout(250)
        pg.click('#btn-start')
        for s in range(9):
            pg.wait_for_timeout(350)
            if s < 8:
                pg.click('#btn-next')
        # 9단계 슬라이더와 빠른 버튼
        pg.locator('#k-slider').fill('700')
        pg.locator('.kq').last.click()
        pg.click('#btn-home')
    # 2) 노트 예제: 화면 캡처 (3단계 진행 중, 8단계 완성)
    pg.locator('#examples .ex').nth(0).click()
    pg.click('#btn-start')
    pg.click('#stepper .st >> nth=2')
    pg.wait_for_timeout(3200)
    pg.screenshot(path=str(shots / 'desktop-step3.png'))
    pg.click('#stepper .st >> nth=5')
    pg.wait_for_timeout(2600)
    pg.screenshot(path=str(shots / 'desktop-step6.png'))
    pg.click('#stepper .st >> nth=7')
    pg.wait_for_timeout(3000)
    pg.screenshot(path=str(shots / 'desktop-step8.png'))
    # 힌트 사다리, 질문, 내 답 확인, 예시 열고 돌아오기
    pg.click('#stepper .st >> nth=3')
    pg.wait_for_timeout(400)
    pg.locator('.lv').nth(2).click()
    pg.locator('.q').first.click()
    pg.fill('#check-in', '-3/2')
    pg.click('#check-form button[type=submit]')
    ok_text = pg.inner_text('#check-out')
    pg.click('#btn-example')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=str(shots / 'desktop-example.png'))
    pg.click('#ex-back')
    pg.wait_for_timeout(300)
    pg.click('#btn-records')
    rec_count = pg.locator('#records-list .rec').count()
    pg.click('#records-close')
    # 잘못된 입력 안내
    pg.click('#btn-home')
    msgs = []
    for bad in ['K^2/(s+1)', 'K(s+1)/((s+1)(s+2))', '(s+1', 'K/(s(s+1)(s+2)(s+3)(s+4))']:
        pg.fill('#tf-input', bad)
        pg.wait_for_timeout(300)
        msgs.append((bad, pg.inner_text('#tf-msg'), pg.is_disabled('#btn-start')))
    # 3) 휴대폰 크기 (밝은 화면)
    mp = br.new_page(viewport={'width': 390, 'height': 844}, color_scheme='light', device_scale_factor=2)
    mp.on('pageerror', lambda e: errors.append('mobile pageerror: ' + str(e)))
    mp.goto(url)
    mp.click('#btn-begin')
    mp.wait_for_timeout(500)
    mp.screenshot(path=str(shots / 'mobile-start.png'))
    mp.click('#btn-start')
    mp.click('#stepper .st >> nth=4')
    mp.wait_for_timeout(2600)
    mp.screenshot(path=str(shots / 'mobile-step5.png'), full_page=False)
    overflow = mp.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    br.close()

print('예제 수:', n_ex)
print('내 답 확인(−3/2):', ok_text.strip())
print('기록 수:', rec_count)
for m in msgs:
    print('입력', m[0], '→', m[1][:70], '| 시작 버튼 비활성:', m[2])
print('휴대폰 가로 넘침(px):', overflow)
if notes:
    print('참고: 외부 글꼴을 불러오지 못함 %d건 (인터넷 연결 문제, 동작에는 영향 없음)' % len(notes))
print('오류:', len(errors))
for e in errors[:20]:
    print('  ', e)
sys.exit(1 if errors else 0)

