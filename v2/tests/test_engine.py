"""검증 문제 36개 전체를 pytest로도 돌릴 수 있게 한 묶음 (자세한 보고는 run_tests.py)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests import run_tests


def test_all_validation_problems():
    assert run_tests.main() == 0
