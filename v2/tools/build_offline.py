"""
build_offline.py — 서버 없이 Chrome에서 바로 여는 '오프라인 미리보기' HTML을 만든다.
    python tools/build_offline.py      →  dist/offline/index.html (랜딩), dist/offline/learn.html (학습)

방법: 실제 FastAPI 서버(server/app.py)에 예시 문제들을 미리 요청해서 응답을 그대로 저장하고,
      화면 코드(web/)와 함께 한 파일에 넣는다. 브라우저의 api_offline.js가 저장된 응답을 꺼내 쓴다.
      → 화면·숫자는 실제 앱과 같고, 저장하지 않은 문제·답만 '미리보기에서는 안 됨'으로 안내한다.
시연 백업용으로도 쓸 수 있다 (인터넷·서버 없이 동작, 글꼴만 시스템 글꼴로 바뀔 수 있음).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient  # noqa: E402
from server.app import app  # noqa: E402
from ai import routes as ai_routes  # noqa: E402

# 미리 받아 두는 동안은 서버의 분당 호출 제한(실제 AI 보호용)을 끈다. 모의 AI만 부르므로 외부 전송 없음.
ai_routes._rate_ok = lambda: True

WEB = ROOT / 'web'
OUT = ROOT / 'dist' / 'offline'
C = TestClient(app)

# learn.js의 EXAMPLES와 같은 문제 + G·H 예시 + 모의 AI가 돌려주는 문제
TEXTS = ['K/(s(s+1)(s+2))', 'K(s+2)/(s(s+1))', 'K/(s(s+3)(s^2+2s+2))', 'K(s+1)/(s^2(s+9))',
         'K/(s(s+2)(s^2+2s+5))', 'K(s+1)/(s(s-1))']
GH = [('K/(s(s+1))', '1'), ('K/(s(s+3)(s^2+2s+2))', '1'), ('K/(s(s+2))', '(s+4)/(s+8)')]
LANDING = {'text': 'K/(s(s+3)(s^2+2s+2))'}
LANDING_SAMPLES = [('centroid', '-1'), ('angles', '-71.6'), ('stableRange', '0<K≤8.16')]


def key(o):
    """api_offline.js의 stableKey와 같은 글자 (키 정렬, 공백 없음)"""
    if isinstance(o, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + key(o[k]) for k in sorted(o)) + '}'
    if isinstance(o, list):
        return '[' + ','.join(key(x) for x in o) + ']'
    if isinstance(o, str):
        o = o.strip()
    return json.dumps(o, ensure_ascii=False)


def norm(a):
    return re.sub(r'\s+', '', str(a)).replace('−', '-').replace('–', '-')


def post(path, body):
    return C.post(path, json=body).json()


def ascii_answer(t):
    """엔진 표기(위첨자, −, √)를 학생이 키보드로 칠 법한 모양으로"""
    sup = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹', '0123456789')
    t = re.sub(r'([⁰¹²³⁴⁵⁶⁷⁸⁹]+)', lambda m: '^' + m.group(1).translate(sup), t)
    return t.replace('−', '-').replace('·', '*').replace('°', '').replace(' = 0', '')


def wrong_candidates(res, field):
    """흔한 실수 모양의 답 후보 (실제 채점기가 오답·진단을 내는지 보고 고른다)"""
    st = res['steps']
    poles = st[1]['result']['poles']
    n = sum(p['mult'] for p in poles)
    zeros = st[1]['result'].get('zeros', [])
    m = sum(z['mult'] for z in zeros)
    c = []
    if field == 'charPoly':
        c.append(ascii_answer(st[0]['result']['charPoly']).replace('+ K', '- K'))
    if field == 'poles':
        c.append(', '.join(ascii_answer(p['text']) for p in poles[:-1]))
    if field == 'branches':
        c += [str(n - m), str(m)] if m else [str(n - 1)]
    if field == 'centroid':
        s = sum(p['re'] * p['mult'] for p in poles) - sum(z['re'] * z['mult'] for z in zeros)
        c += [f'{s:g}', f'{s / n:g}']
    if field == 'asymAngles' and n > m:
        c.append(', '.join(f'{k * 360 / (n - m):g}' for k in range(n - m)))
    if field == 'breakpoints':
        c += ['없음'] + [ascii_answer(x['sText']) for x in st[4]['result'].get('candidates', []) if not x['valid']][:1]
    if field == 'angles':
        for it in st[5]['result'].get('items', [])[:1]:
            c += [f'{-it["base"]:.2f}', f'{it["base"] + 180:.2f}']
    r7 = st[6]['result']
    if field == 'stableRange' and r7.get('stable'):
        iv = r7['stable'][0]
        if iv['hi'] is not None and iv['hi'] < 1e12:
            c.append(f'0<K<={iv["hi"]:g}')
        c.append('K>0')
    if field in ('crossK', 'crossOmega'):
        cr = res['graph']['crossings']
        if cr:
            c.append(f'{cr[0][2] / 2:g}' if field == 'crossK' else f'{cr[0][1] ** 2:g}')
    if field == 'polesAtK':
        c.append(', '.join(ascii_answer(p['text']) for p in poles))
    if field == 'segments':
        c.append('(-inf, 0]')
    if field == 'zeros':
        c.append(ascii_answer(poles[0]['text']))
    return c


def main():
    fields = C.get('/api/fields').json()
    health = C.get('/api/health').json()
    # 미리보기 파일은 힌트·손글씨에 실제 AI를 부르지 않는다. 문제 사진만 claude.ai 링크 안에서 Claude가 읽는다(api_offline.js).
    health['ai'] = {'available': False, 'label': 'Claude', 'sendsDataTo': 'Anthropic Claude, 미리보기 링크에서만'}
    from ai.prompts import EXTRACT
    data = {'health': health, 'fields': fields, 'analyze': {}, 'check': {}, 'samples': {}, 'poles': {},
            'diagram': {}, 'hint': {}, 'handwriting': {}, 'prompts': {'extract': EXTRACT}}
    # 시연 모드(모의 AI)의 사진 인식 결과. 확인 패널에서 그대로 확정하면 이 구조(블록선도)로 계산하므로 함께 저장한다.
    data['recognize'] = C.post('/api/ai/recognize', files={'image': ('a.png', b'\x89PNG\r\n\x1a\n' + b'0' * 64, 'image/png')},
                               data={'demo': 'true', 'consent': 'false'}).json()
    problems = [{'text': t} for t in TEXTS] + [{'G': g, 'H': h} for g, h in GH]
    if data['recognize']['preview'].get('problem'):
        problems.append(data['recognize']['preview']['problem'])
    for g, h in GH:
        data['diagram'][key({'G': g, 'H': h})] = post('/api/diagram', {'G': g, 'H': h})

    for p in problems:
        k = key(p)
        res = post('/api/analyze', {'problem': p})
        if not res.get('ok'):
            print('지원 밖', p, res['error']['message'])
            data['analyze'][k] = res
            continue
        data['analyze'][k] = res
        chk, smp = {}, {}
        for n, fs in fields.items():
            for f in fs:
                fld = f['field']
                K = 10 if n == '9' else None
                tbl, ex = {}, []

                def grade(ans):
                    v = post('/api/check', {'problem': p, 'field': fld, 'answer': ans, 'K': K})
                    tbl[norm(ans) + (f'|K={K}' if K is not None else '')] = v
                    tbl.setdefault(norm(ans), v)
                    return v
                # 1) 정답: 채점기가 돌려준 기대값을 키보드 모양으로 바꿔 넣고, 정말 정답 판정인지 확인
                probe = grade('0')
                exp = probe.get('expected')
                if exp is None:
                    probe = grade('[-1, 0]' if fld == 'segments' else '0<K<1')
                    exp = probe.get('expected')
                if exp:
                    for cand in (ascii_answer(exp), exp):
                        if grade(cand)['status'] in ('correct', 'approx'):
                            ex.append({'kind': '정답', 'answer': cand, **({'K': K} if K else {})})
                            break
                # 2) 흔한 실수: 채점기가 오답 + 원인 진단을 내는 것만 최대 2개
                for cand in wrong_candidates(res, fld):
                    if len([e for e in ex if e['kind'] != '정답']) >= 2:
                        break
                    v = grade(cand)
                    if v['status'] == 'incorrect' and not any(e['answer'] == cand for e in ex):
                        ex.append({'kind': '오답 예', 'answer': cand, **({'K': K} if K else {})})
                chk[fld], smp[fld] = tbl, ex
        if p == LANDING:
            for fld, ans in LANDING_SAMPLES:
                v = post('/api/check', {'problem': p, 'field': fld, 'answer': ans})
                chk[fld][norm(ans)] = v
        data['check'][k], data['samples'][k] = chk, smp
        # K별 폐루프 극점 (그래프의 K 목록과 같은 순서)
        data['poles'][k] = [{x: y for x, y in post('/api/poles', {'problem': p, 'K': K}).items()
                             if x in ('poles', 'status')} for K in res['graph']['K']]
        # 시연 모드(모의 AI) 힌트와 손글씨 검사
        data['hint'][k] = {f'{s}|{lv}': post('/api/ai/hint', {'problem': p, 'step': s, 'level': lv, 'demo': True})
                           for s in range(1, 10) for lv in range(1, 5)}
        data['handwriting'][k] = C.post('/api/ai/handwriting', files={'image': ('a.png', b'\x89PNG\r\n\x1a\n' + b'0' * 64, 'image/png')},
                                        data={'demo': 'true', 'consent': 'false', 'problem': json.dumps(p)}).json()
        print('저장', p, '예시 답', sum(len(v) for v in smp.values()), '개')
    OUT.mkdir(parents=True, exist_ok=True)
    land_key = key(LANDING)
    land_data = {'health': health, 'fields': fields, 'analyze': {land_key: data['analyze'][land_key]},
                 'check': {land_key: data['check'][land_key]}, 'samples': {}, 'poles': {}, 'diagram': {},
                 'hint': {}, 'handwriting': {}}
    build('index.html', land_data)
    build('learn.html', data)


OFFLINE_CSS = """
.offline-bar{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99;white-space:nowrap;
  background:rgba(16,20,29,.82);color:#F5F4F0;border:1px solid rgba(177,203,230,.4);border-radius:999px;
  padding:4px 12px;font-size:11px;line-height:1.4;backdrop-filter:blur(6px);pointer-events:none}
body{padding-bottom:36px}
.offline-samples{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:-4px 0 10px;font-size:12px;color:var(--muted,#777)}
.offline-samples .chip{font-size:12px;padding:3px 9px;cursor:pointer}
"""


def inline_css(m):
    path = m.group(1).replace('/static/', '')
    return '<style>\n' + (WEB / path).read_text(encoding='utf-8') + '\n</style>'


def inline_js(path):
    src = (WEB / path).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>\n' + src + '\n</script>'


def build(name, data):
    html = (WEB / name).read_text(encoding='utf-8')
    html = re.sub(r'<link rel="stylesheet" href="(/static/[^"]+)">', inline_css, html)
    html = html.replace('</head>', f'<style>{OFFLINE_CSS}</style>\n</head>')
    html = html.replace('href="/learn"', 'href="learn.html"').replace('href="/"', 'href="index.html"')
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    def scripts(m):
        path = m.group(1).replace('/static/', '')
        if path == 'js/api.js':
            return f'<script>window.PREVIEW_DATA = {payload};</script>\n' + inline_js('js/api_offline.js')
        return inline_js(path)
    html = re.sub(r'<script src="(/static/[^"]+)"></script>', scripts, html)
    html = html.replace('</body>', inline_js('js/offline_ui.js') + '\n</body>')
    (OUT / name).write_text(html, encoding='utf-8')
    print('저장:', OUT / name, f'{len(html.encode()) / 1024:.0f} KB')
    # 휴대폰 링크(claude.ai 아티팩트)용: 외부 글꼴(jsdelivr)을 빼고, 랜딩은 문서 뼈대 없이 내용만
    art = re.sub(r'<link rel="stylesheet" href="https://cdn\.jsdelivr[^>]+>\n?', '', html)
    if name == 'index.html':
        art = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', art)
        art = art.replace('</head>', '').replace('<body class="landing">', '<script>document.body.classList.add("landing")</script>')
        art = art.replace('</body>', '').replace('</html>', '')
    (OUT / 'artifact').mkdir(exist_ok=True)
    (OUT / 'artifact' / name).write_text(art, encoding='utf-8')


if __name__ == '__main__':
    main()
