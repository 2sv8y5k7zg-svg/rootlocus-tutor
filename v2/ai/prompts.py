"""
prompts.py — AI에게 보내는 지시문과 응답 형식(JSON 스키마)

응답 형식을 JSON 스키마로 고정하는 이유: AI 답을 Python이 바로 읽고 검증할 수 있게 하기 위해서다.
채점 항목 이름(field)은 engine/grader.py 의 FIELDS 와 같다.
"""

FIELDS_DOC = """charPoly(1단계 특성방정식), poles(2단계 극점), zeros(2단계 영점), branches(2단계 가지 수),
segments(3단계 실수축 구간), centroid(4단계 점근선 중심), asymAngles(4단계 점근선 각도),
breakpoints(5단계 이탈점·진입점), angles(6단계 출발각·도착각), stableRange(7단계 안정 K 범위),
crossK(7단계 허수축 교차 K), crossOmega(7단계 교차 주파수 ω)"""

EXTRACT = """너는 제어공학 문제 사진을 읽어 구조화하는 도우미다. 계산하지 말고, 사진에 적힌 것만 옮겨라.
사진은 (1) 전달함수가 적힌 문제 또는 (2) 블록선도다.

규칙
- 전달함수는 s와 K만 쓰는 한 줄 식으로 적는다. 곱셈 기호는 생략 가능, 거듭제곱은 ^ (예: K(s+2)/(s(s^2+2s+2)))
- 블록선도면 블록마다 id, 전달함수 tf, 입력 신호 in 을 적고, 합산점마다 들어오는 신호와 부호(+/−)를 적는다.
  출력 신호가 어느 블록의 출력인지 outputNode에 적는다. 입력 신호 이름은 R.
- 앞먹임 G(s)와 되먹임 H(s)만 있는 단순 구조면 G, H도 함께 적는다.
- 가변 이득(근궤적 변수)이 K가 아닌 다른 문자면 K로 바꾸고 conditions에 적는다.
- 확실하지 않은 부분(흐린 숫자, 부호, 연결)은 uncertain에 구체적으로 적고 confidence를 낮춘다. 추측으로 채우지 않는다.
- 문제의 조건(예: '안정한 K 범위를 구하라', '단위 피드백')은 conditions에 짧게 적는다."""

EXTRACT_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'kind': {'type': 'STRING', 'enum': ['transferFunction', 'blockDiagram', 'unknown']},
        'tf': {'type': 'STRING', 'description': '개루프 전달함수 K·G(s)H(s) 한 줄 (알 수 있을 때)'},
        'G': {'type': 'STRING'},
        'H': {'type': 'STRING'},
        'feedbackSign': {'type': 'STRING', 'enum': ['-', '+']},
        'diagram': {
            'type': 'OBJECT',
            'properties': {
                'input': {'type': 'STRING'},
                'outputNode': {'type': 'STRING'},
                'blocks': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
                    'id': {'type': 'STRING'}, 'tf': {'type': 'STRING'}, 'in': {'type': 'STRING'}},
                    'required': ['id', 'tf', 'in']}},
                'sums': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
                    'id': {'type': 'STRING'},
                    'inputs': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
                        'from': {'type': 'STRING'}, 'sign': {'type': 'STRING', 'enum': ['+', '-']}},
                        'required': ['from', 'sign']}}},
                    'required': ['id', 'inputs']}},
            },
        },
        'conditions': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
        'uncertain': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
        'confidence': {'type': 'NUMBER'},
    },
    'required': ['kind', 'conditions', 'uncertain', 'confidence'],
}

HANDWRITING = """너는 학생의 근궤적 손글씨 풀이를 읽는 도우미다. 문제: {problem}

할 일
1) 학생이 쓴 결과값을 단계별로 옮겨 적는다(studentAnswer). 학생이 쓴 그대로, 고치지 말 것.
   field는 다음 중 하나: {fields}
2) 각 값 옆에 쓰인 공식(formula)과 중간 계산(work)을 짧게 옮긴다.
3) 계산이 틀렸다고 의심되는 곳은 aiSuspect=true, 이유(aiReason)를 한 문장으로 쓴다. 의심되지 않으면 false.
   네가 직접 계산한 값이 있으면 aiValue에 적는다(없으면 빈 문자열). 최종 판정은 별도 계산 엔진이 한다.
4) 글씨를 읽을 수 없거나 확실하지 않으면 confidence를 0.6 미만으로 하고 unreadable에 위치를 적는다.
   읽을 수 없는 것을 추측해서 채우지 않는다.
5) 근궤적 그래프 그림 자체는 채점하지 않는다(엔진이 담당).
location에는 '두 번째 줄', '오른쪽 위 Routh 표'처럼 사진 속 위치를 쓴다."""

HANDWRITING_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'readable': {'type': 'BOOLEAN'},
        'problemSeen': {'type': 'STRING', 'description': '사진 속 문제 식 (있으면)'},
        'items': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'step': {'type': 'INTEGER'},
            'field': {'type': 'STRING'},
            'studentAnswer': {'type': 'STRING'},
            'formula': {'type': 'STRING'},
            'work': {'type': 'STRING'},
            'location': {'type': 'STRING'},
            'confidence': {'type': 'NUMBER'},
            'aiSuspect': {'type': 'BOOLEAN'},
            'aiReason': {'type': 'STRING'},
            'aiValue': {'type': 'STRING'},
        }, 'required': ['step', 'field', 'studentAnswer', 'confidence', 'aiSuspect']}},
        'unreadable': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'location': {'type': 'STRING'}, 'note': {'type': 'STRING'}}}},
    },
    'required': ['readable', 'items'],
}

HINT = """너는 제어공학 근궤적 튜터다. 학생에게 한국어 존댓말로 짧게(3문장 이내) 설명한다.
반드시 지킬 것
- 아래 '엔진 계산 근거'에 있는 숫자만 쓴다. 새 숫자를 계산하거나 만들지 않는다.
- 힌트 단계가 {level}이면 그 단계까지만 알려 준다 (1: 개념 질문만, 2: 공식까지, 3: 계산 일부까지, 4: 전체 풀이).
- 학생 답이 정답이면 칭찬 한 문장으로 끝낸다.

단계: {step}단계 {title}
적용 공식: {formula}
엔진 계산 근거:
{work}
팀이 정한 힌트(이 단계): {team_hint}
학생 답: {student}
엔진 채점 결과: {verdict}
"""
