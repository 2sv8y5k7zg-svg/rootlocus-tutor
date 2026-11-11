"""
build.py — 여러 파일을 한 파일(dist/rootlocus-tutor.html)로 묶습니다.
묶은 파일은 인터넷 없이 브라우저로 열어도 동작합니다(글꼴만 기본 글꼴로 바뀜).
실행: python3 tools/build.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ['js/complex.js', 'js/poly.js', 'js/format.js', 'js/routh.js', 'js/locus.js',
      'app/js/parser.js', 'app/js/mathview.js', 'app/js/content.js', 'app/js/graph.js',
      'app/js/ai.js', 'app/js/store.js', 'app/js/main.js']

tpl = (ROOT / 'app' / 'template.html').read_text(encoding='utf-8')
css = (ROOT / 'app' / 'app.css').read_text(encoding='utf-8')
js = '\n'.join('/* ===== %s ===== */\n%s' % (f, (ROOT / f).read_text(encoding='utf-8')) for f in JS)
assert '</script' not in js.lower(), 'JS 안에 </script가 있으면 안 됩니다'
out = tpl.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
(dist / 'rootlocus-tutor.html').write_text(out, encoding='utf-8')
# 웹 호스팅 첫 화면과 오프라인 실행 파일은 같은 내용입니다.
(dist / 'index.html').write_text(out, encoding='utf-8')
print('저장: dist/rootlocus-tutor.html (%.1f KB)' % (len(out.encode('utf-8')) / 1024))

