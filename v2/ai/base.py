"""
base.py — AI 제공업체 공통 인터페이스

AI가 하는 일은 세 가지뿐이다.
  1) extract_problem   문제 사진·블록선도 사진 → 구조화된 문제(JSON)
  2) read_handwriting  손글씨 풀이 사진 → 학생이 쓴 값과 '오류 후보'(JSON)
  3) explain           엔진이 확정한 결과를 바탕으로 자연어 설명·힌트

수학적 정답은 AI가 정하지 않는다. AI 출력은 항상 Python 엔진이 다시 검증한다.
새 제공업체(OpenAI, Anthropic 등)를 붙일 때는 이 클래스를 상속해 세 함수만 구현하면 된다.
"""


class AIError(Exception):
    """AI 호출 실패. code:
        noKey      API 키가 서버에 설정되지 않음
        rateLimit  호출 한도 초과 (무료 등급 한도 포함)
        network    연결 실패·시간 초과
        badResponse 응답 형식이 약속과 다름
        blocked    안전 필터 등으로 응답 거부
        consent    사용자가 사진 전송에 동의하지 않음"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self):
        return {'code': self.code, 'message': self.message}


class AIProvider:
    name = 'base'
    label = '없음'
    sends_data_to = None        # 사진·글이 전송되는 곳 (화면 안내용)

    def available(self) -> bool:
        return False

    def extract_problem(self, image: bytes, mime: str) -> dict:
        raise AIError('noKey', 'AI가 설정되지 않았습니다.')

    def read_handwriting(self, image: bytes, mime: str, problem_text: str) -> dict:
        raise AIError('noKey', 'AI가 설정되지 않았습니다.')

    def explain(self, prompt: str) -> str:
        raise AIError('noKey', 'AI가 설정되지 않았습니다.')
