"""Run the current file/offline UI suite: python tools/design-check.py.

The former welcome-screen-only assertions are now journey assertions in
tools/journey-check.js. Requires Node and Playwright (Node package, or the
driver package supplied with Python Playwright). No dependency enters the app.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

if not os.environ.get('PLAYWRIGHT_MODULE'):
    spec = importlib.util.find_spec('playwright')
    if spec and spec.origin:
        package = Path(spec.origin).parent / 'driver' / 'package'
        if package.exists():
            os.environ['PLAYWRIGHT_MODULE'] = str(package)
sys.exit(subprocess.call(['node', str(Path(__file__).with_name('journey-check.js'))]))
