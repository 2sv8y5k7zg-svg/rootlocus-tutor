"""
verify.py — AI와 엔진의 이중 검증 (7. 필수 기능 ④)

처리 순서
  1) AI가 손글씨에서 학생 값과 '오류 후보'를 읽어 온다           (ai.read_handwriting)
  2) 읽은 값마다 Python 엔진이 독립적으로 채점한다                (engine.grader.check)
  3) AI 판단(의심 여부·AI 계산값)과 엔진 판정을 비교한다
  4) 결과를 다섯 가지 중 하나로 정리한다
       agree_correct   둘 다 정답으로 봄
       agree_wrong     둘 다 오답으로 봄 → 엔진 정답과 오류 원인을 함께 표시
       disagree        AI와 엔진 판단이 다름 → 검증된 엔진 결과를 기준으로 표시
       recognize       글씨 인식이 불확실 → 오답이 아니라 '인식 확인 필요'
       unverifiable    엔진이 정답을 확정하지 못함 → 정답을 지어내지 않음
"""
import re
from engine import grader, fmt

CONF_MIN = 0.6
LABEL = {
    'agree_correct': '정답 (AI·엔진 일치)',
    'agree_wrong': '오답 (AI·엔진 일치)',
    'disagree': 'AI와 엔진 판단 불일치 → 엔진 결과 기준',
    'recognize': '인식 확인 필요',
    'unverifiable': '검증 불가',
}
STEP_TITLE = {1: '특성방정식', 2: '극점·영점', 3: '실수축 구간', 4: '점근선', 5: '이탈점·진입점',
              6: '출발각·도착각', 7: 'Routh·안정 범위', 8: '근궤적 완성', 9: 'K 변화'}


def verify_handwriting(ai_out: dict, result: dict) -> dict:
    items = []
    known = {f for fs in grader.FIELDS.values() for f, _ in fs}
    step_of = {f: n for n, fs in grader.FIELDS.items() for f, _ in fs}
    for it in ai_out.get('items', []):
        field = it.get('field')
        ans = str(it.get('studentAnswer', '')).strip()
        conf = float(it.get('confidence', 0) or 0)
        row = {'step': step_of.get(field, it.get('step')), 'field': field, 'student': ans,
               'location': it.get('location', ''), 'formula': it.get('formula', ''), 'work': it.get('work', ''),
               'ai': {'suspect': bool(it.get('aiSuspect')), 'reason': it.get('aiReason', ''), 'value': it.get('aiValue', '')},
               'confidence': conf}
        row['stepTitle'] = STEP_TITLE.get(row['step'], '')
        if field not in known:
            row.update(outcome='recognize', message='AI가 어떤 항목인지 정하지 못했습니다. 직접 확인해 주세요.',
                       label=LABEL['recognize'])
            items.append(row)
            continue
        if conf < CONF_MIN or not ans or '?' in ans:
            row.update(outcome='recognize', message='글씨를 확실히 읽지 못했습니다. 오답이 아니라 확인이 필요한 항목입니다.',
                       label=LABEL['recognize'])
            items.append(row)
            continue
        v = grader.check(result, field, ans)
        row['engine'] = v
        if v['status'] == 'unreadable':
            row.update(outcome='recognize', message='AI가 옮긴 값을 엔진이 읽지 못했습니다. 사진 속 값을 직접 입력해 확인해 주세요.')
        elif v['status'] == 'unverifiable':
            row.update(outcome='unverifiable', message=v['diagnosis'])
        else:
            eng_ok = v['status'] in ('correct', 'approx')
            ai_ok = not row['ai']['suspect']
            if eng_ok and ai_ok:
                row.update(outcome='agree_correct', message='정답입니다.' + (' (반올림 허용)' if v['status'] == 'approx' else ''))
            elif not eng_ok and ai_ok:
                row.update(outcome='disagree', message=f'AI는 오류를 찾지 못했지만 엔진 검증 결과 오답입니다. 엔진 결과: {v["expected"]}')
            elif eng_ok and not ai_ok:
                row.update(outcome='disagree', message='AI는 오류로 의심했지만 엔진 검증 결과 정답입니다. 엔진 결과를 기준으로 정답 처리했습니다.')
            else:   # 엔진 오답 + AI도 의심 → 일치
                row.update(outcome='agree_wrong', message=f'엔진 결과: {v["expected"]}')
            # AI가 직접 계산한 값이 있으면 엔진 값과 비교 (AI 계산값은 정답으로 쓰지 않는다)
            if row['ai']['value']:
                av = grader.check(result, field, row['ai']['value'])
                row['aiValueCheck'] = 'match' if av['status'] in ('correct', 'approx') else 'mismatch'
                if row['aiValueCheck'] == 'mismatch':
                    row['message'] += f' (AI가 계산한 값 {row["ai"]["value"]}은 엔진 결과와 달라 사용하지 않았습니다.)'
            if not eng_ok:
                row['cause'] = v.get('diagnosis') or row['ai']['reason'] or '엔진 규칙으로 원인을 특정하지 못했습니다.'
        row['label'] = LABEL[row['outcome']]
        items.append(row)
    summary = {k: sum(1 for r in items if r['outcome'] == k) for k in LABEL}
    return {'items': items, 'unreadable': ai_out.get('unreadable', []), 'summary': summary,
            'firstError': next((r for r in sorted(items, key=lambda r: r['step'] or 99)
                                if r['outcome'] in ('agree_wrong', 'disagree') and r.get('engine', {}).get('status') == 'incorrect'), None)}


# ───────────────────── AI 설명 속 숫자 검사 ─────────────────────

_NUM = re.compile(r'(?<![A-Za-z가-힣])[−-]?\d+(?:\.\d+)?')


def numbers_in(text):
    return [float(x.replace('−', '-')) for x in _NUM.findall(text or '')]


def check_numbers(ai_text: str, engine_texts: list) -> list:
    """AI 설명에 엔진 근거에 없는 숫자가 있으면 그 숫자 목록을 돌려준다 (비어 있으면 통과).
    0~10 정수, 90/180/270/360(각도 상수)은 공식에 늘 나오므로 허용한다."""
    allowed = set()
    for t in engine_texts:
        for v in numbers_in(fmt.expr(t) if not isinstance(t, str) else t):
            allowed.add(round(abs(v), 2))
    bad = []
    for v in numbers_in(ai_text):
        a = round(abs(v), 2)
        if (abs(v) <= 10 and float(v).is_integer()) or a in (90, 180, 270, 360):
            continue
        if a in allowed or any(abs(a - x) <= 0.011 for x in allowed):
            continue
        bad.append(v)
    return bad
