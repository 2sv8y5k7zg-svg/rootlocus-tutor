"""
make_report.py — tests/results.json(실제 실행 결과)으로 docs/테스트-결과.md 를 만든다.
    python tests/run_tests.py && python tools/make_report.py
보고서의 숫자는 모두 실행 결과 파일에서 읽는다 (손으로 적지 않는다).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    r = json.loads((ROOT / 'tests/results.json').read_text(encoding='utf-8'))
    L = ['# 테스트 결과 보고서', '',
         f'- 실행 시각: {r["when"]} (실행한 컴퓨터의 시계 기준)',
         f'- 검증 문제: **{r["problemsPassed"]}/{r["problems"]} 통과**, 검사 항목 **{r["itemsPassed"]}/{r["items"]} 통과**'
         + (f', 건너뜀 {r["skipped"]}' if r['skipped'] else ''),
         f'- 전체 실행 시간: {r["seconds"]}초 · sympy {r["sympy"]}, numpy {r["numpy"]}, python-control {r["control"]}',
         '', '## 기대값의 출처',
         '- A 묶음(T01~T15, T13, T14a~c): 기존 저장소 `tests/expected.json` (기존 `tools/reference.py`가 sympy로 계산). 새 엔진과 코드를 공유하지 않음.',
         '- B 묶음(T16~T34): `tests/data/new_problems.json` — 근의 공식·Routh 표·s=jω 대입으로 손으로 구한 정확한 값.'
         ' 엔진 코드를 쓰지 않고 정했지만 같은 AI(Claude)가 작성했으므로, 팀이 손으로 한 번 더 검산할 것을 권장.',
         '- 모든 정상 문제: python-control 0.10(별도 라이브러리)의 폐루프 극점·근궤적 점과 대조.', '',
         '## 문제별 결과', '', '| 번호 | 묶음 | 입력 | 결과 | 항목 | 계산 시간 |', '|---|---|---|---|---|---|']
    for x in r['reports']:
        n_ok = sum(1 for i in x['items'] if i['ok'])
        n_all = sum(1 for i in x['items'] if i['ok'] is not None)
        L.append(f'| {x["id"]} | {x["group"][0]} | `{x["title"]}` | {"통과" if x["ok"] else "**실패**"} | {n_ok}/{n_all} | {x["ms"]} ms |')
    fails = [(x, i) for x in r['reports'] for i in x['items'] if i['ok'] is False]
    L += ['', '## 실패 항목', '']
    if not fails:
        L.append('없음.')
    for x, i in fails:
        L.append(f'- {x["id"]} {i["name"]}: 입력 `{x["input"]}`, 기대 `{i["expected"]}`, 실제 `{i["actual"]}`, 원인 {i["cause"]}')
    L += ['', '## 문제별 검사 항목 (예: T16)', '']
    ex = next(x for x in r['reports'] if x['id'] == 'T16')
    for i in ex['items']:
        L.append(f'- {"✓" if i["ok"] else "✗"} {i["name"]}')
    (ROOT / 'docs/테스트-결과.md').write_text('\n'.join(L) + '\n', encoding='utf-8')
    print('저장: docs/테스트-결과.md')


if __name__ == '__main__':
    main()
