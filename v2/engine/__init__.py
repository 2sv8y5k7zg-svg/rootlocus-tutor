"""근궤적 계산 엔진 (Python). 모든 수학적 정답의 단일 기준."""
from .solver import analyze, analyze_text, analyze_factors  # noqa: F401
from .parse import InputError, parse_text, from_factors, from_coeffs  # noqa: F401
