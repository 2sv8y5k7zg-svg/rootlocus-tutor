# 근궤적 AI 튜터 (v2, Python 엔진)

제어공학 근궤적을 9단계로 배우는 웹 애플리케이션입니다. 전달함수를 입력하거나 문제 사진·블록선도·손글씨 풀이를 올리면
**Python 계산 엔진이 정확한 값을 계산·검증**하고, **AI(Gemini)는 사진 인식과 설명**만 맡습니다.
2026 안양대학교 AI 경진대회(AI+X) 출품작.

## Windows에서 실행하기

1. Python 3.11 이상 설치 (python.org, 설치 화면에서 "Add python.exe to PATH" 체크)
2. 이 폴더에서 명령 프롬프트(cmd)를 열고:
   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   python run.py
   ```
3. 브라우저가 열리지 않으면 `http://127.0.0.1:8000` 접속. 끄려면 창에서 Ctrl+C.

인터넷이 없어도 계산·채점·팀 힌트·그래프·랜딩 연출(GSAP 포함)이 모두 동작합니다. 글꼴만 시스템 글꼴로 바뀝니다.

### AI(Gemini) 켜기 — 선택
API 키는 **서버 환경변수로만** 둡니다. HTML·JavaScript·Git에 넣지 않습니다.
```
set GEMINI_API_KEY=여기에_본인_키
set GEMINI_MODEL=gemini-3.5-flash-lite   (생략 가능, 기본값)
python run.py
```
- 키가 없으면 AI 기능만 꺼지고 나머지는 그대로 동작합니다.
- 오른쪽 위 **시연 모드**를 켜면 인터넷·키 없이 정해 둔 예시 응답(모의 AI)으로 사진 인식·손글씨 검사 흐름을 보여 줍니다(화면에 '모의'로 표시).
- 무료 등급은 입력 내용이 Google 제품 개선에 쓰일 수 있습니다(Gemini 가격표 "Used to improve our products: Yes"). 사진 전송 전 화면에서 동의를 받습니다.

## 시험 돌리기
```
python tests/run_tests.py      검증 문제 36개 (결과: tests/results.json)
python tools/make_report.py    docs/테스트-결과.md 만들기
python -m pytest tests -q      전체 자동 시험 (엔진·채점·서버·AI 오류 처리)
python tests/fuzz.py 1000      무작위 1,000개 안정성 시험
```
최근 실행(2026-11-17 KST): 검증 문제 36/36, 검사 항목 420/420, pytest 60/60, 무작위 1,000개 중 실패 0.

## 폴더
| 경로 | 내용 |
|---|---|
| `engine/` | Python 계산 엔진 (수학의 단일 기준) |
| `ai/` | AI 공통 인터페이스, Gemini 연결, 모의 AI, 이중 검증 |
| `server/app.py` | FastAPI: 웹 페이지 + 계산 API + AI 중계 |
| `web/` | 랜딩(`index.html`)·학습(`learn.html`) 화면, CSS, JS, GSAP |
| `tests/` | 검증 문제·기준 정답·자동 시험 |
| `tools/` | 보고서 생성 |
| `docs/` | 코드 설명서, 테스트 결과, 한계 보고서 |

## 지원 범위
연속시간, 음의 피드백, K ≥ 0, 실수 계수, 분모 4차 이하, 분자 차수 ≤ 분모 차수.
극점·영점 상쇄, 시간 지연, 5차 이상, 양의 피드백(최고차 부호 반대), K가 전체 곱이 아닌 식은 계산하지 않고 이유를 안내합니다.

## 데이터·모델 출처
- 검증 문제 T01~T15: 기존 저장소(2sv8y5k7zg-svg/rootlocus-tutor)의 문제와 기준 정답
- 검증 문제 T16~T34: 새로 만든 문제, 손 풀이 기대값 (`tests/data/new_problems.json`)
- AI: Google Gemini API (기본 `gemini-3.5-flash-lite`, 2026-11-17 공식 모델·가격 페이지 확인). AI를 학습시키지 않았습니다.
- 라이브러리: SymPy, NumPy, FastAPI, Uvicorn, httpx, GSAP 3.12.5(Standard no-charge license), python-control(시험용 대조)

## 서버 없이 화면만 보기 (오프라인 미리보기)
```
python tools/build_offline.py
```
`dist/offline/index.html`(랜딩)과 `learn.html`(학습)이 만들어집니다. 더블클릭하면 Chrome에서 바로 열립니다.
실제 서버에 예시 문제 9개를 미리 물어본 응답을 넣어 둔 것이라 화면과 숫자는 실제 앱과 같습니다.
다른 식 계산, 자유 입력 채점, 실제 AI는 `python run.py`로 서버를 켜야 동작합니다. 시연 백업용으로도 쓸 수 있습니다.
