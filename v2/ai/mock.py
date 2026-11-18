"""
mock.py — 시연·시험용 '모의 AI' (인터넷·키 없이 동작, 화면에 '모의 응답'이라고 표시)

용도
  1) 자동 테스트: 실제 AI 없이 이중 검증 흐름(AI 결과 → 엔진 검증 → 비교)을 시험
  2) 발표 백업: 대회장 인터넷이나 무료 한도가 막혀도 시연 흐름을 보여 줄 수 있음
실제 사진을 읽지 않는다. 정해 둔 예시 답을 돌려줄 뿐이다.
"""
from .base import AIProvider


class MockProvider(AIProvider):
    name = 'mock'
    label = '모의 AI (시연용, 사진을 실제로 읽지 않음)'
    sends_data_to = None

    def available(self):
        return True

    def extract_problem(self, image, mime):
        # 예시: 블록선도 사진 (G = K/(s(s+3)), H = (s^2+2s+2)…가 아니라 교재형 단위 피드백)
        return {
            'kind': 'blockDiagram',
            'tf': 'K/(s(s+3)(s^2+2s+2))',
            'G': 'K/(s(s+3)(s^2+2s+2))', 'H': '1', 'feedbackSign': '-',
            'diagram': {'input': 'R', 'outputNode': 'G',
                        'blocks': [{'id': 'G', 'tf': 'K/(s(s+3)(s^2+2s+2))', 'in': 'E'}],
                        'sums': [{'id': 'E', 'inputs': [{'from': 'R', 'sign': '+'}, {'from': 'G', 'sign': '-'}]}]},
            'conditions': ['근궤적을 그리고 안정한 K의 범위를 구하라', '단위 피드백'],
            'uncertain': ['분모 둘째 인수의 상수항이 2인지 3인지 흐림'],
            'confidence': 0.82,
        }

    def read_handwriting(self, image, mime, problem_text):
        # 예시 풀이: 점근선 중심에서 영점을 빼먹은 실수, 출발각은 정답, Routh 범위의 등호 실수, 한 곳은 흐림
        return {
            'readable': True,
            'problemSeen': problem_text,
            'items': [
                {'step': 2, 'field': 'poles', 'studentAnswer': '0, -3, -1±j', 'formula': 'D(s)=0', 'work': '',
                 'location': '첫째 줄', 'confidence': 0.95, 'aiSuspect': False, 'aiReason': '', 'aiValue': ''},
                {'step': 4, 'field': 'centroid', 'studentAnswer': '-1', 'formula': 'σ=(Σp−Σz)/(n−m)',
                 'work': '(0-3-1-1)/(4)', 'location': '둘째 줄', 'confidence': 0.9,
                 'aiSuspect': True, 'aiReason': '극점 합 계산에서 −3을 한 번 빠뜨린 것으로 보입니다.', 'aiValue': '-1.25'},
                {'step': 6, 'field': 'angles', 'studentAnswer': '-71.6', 'formula': '180+Σz−Σp',
                 'work': '180-(135+90+26.6)', 'location': '셋째 줄', 'confidence': 0.88,
                 'aiSuspect': False, 'aiReason': '', 'aiValue': ''},
                {'step': 7, 'field': 'stableRange', 'studentAnswer': '0<K≤8.16', 'formula': 'Routh',
                 'work': 's1: 6-25K/34', 'location': '오른쪽 Routh 표 아래', 'confidence': 0.85,
                 'aiSuspect': False, 'aiReason': '', 'aiValue': ''},
                {'step': 7, 'field': 'crossOmega', 'studentAnswer': '1.?5', 'formula': '보조방정식',
                 'work': '', 'location': '오른쪽 아래', 'confidence': 0.4,
                 'aiSuspect': False, 'aiReason': '', 'aiValue': ''},
            ],
            'unreadable': [{'location': '오른쪽 아래', 'note': 'ω 값의 둘째 자리가 번져 있음'}],
        }

    def explain(self, prompt):
        return '(모의 AI 설명) 엔진이 계산한 근거를 다시 보면서, 위 공식에 값을 하나씩 넣어 보세요.'
