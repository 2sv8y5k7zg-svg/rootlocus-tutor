"""
run.py — 로컬 웹사이트 실행 (Windows: python run.py)
브라우저에서 http://127.0.0.1:8000 을 연다. 종료는 Ctrl+C.
AI를 쓰려면 실행 전에 같은 창에서 환경변수 GEMINI_API_KEY를 설정한다 (README 참고).
"""
import os
import sys
import webbrowser
import threading

import uvicorn

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    if '--no-browser' not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
    # 127.0.0.1: 내 컴퓨터에서만 접속 가능 (같은 와이파이의 다른 기기에 공개하지 않음)
    uvicorn.run('server.app:app', host='127.0.0.1', port=port, log_level='warning')
