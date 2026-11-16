// studio-smoke.cjs — 브라우저 대역으로 그래프 상태 전환과 오래된 응답 차단을 검사합니다.
// 실제 브라우저 렌더링·Python 수학 검증·성능 측정은 별도로 실행해야 합니다.
// 실행: v2 폴더에서 node tests/studio-smoke.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'web', 'js', file), 'utf8');

async function runStudioTests(sources) {
  const passed = [];
  function check(name, condition) { if (!condition) throw Error(name); passed.push(name); }
  const queue = new Map(); let frameId = 0;
  const requestAnimationFrame = fn => { queue.set(++frameId, fn); return frameId; };
  const cancelAnimationFrame = id => queue.delete(id);
  const frame = now => { const tasks = [...queue.values()]; queue.clear(); for (const fn of tasks) fn(now); };
  const media = { matches: false, listeners: [], addEventListener(_, fn) { this.listeners.push(fn); } };
  const matchMedia = () => media;
  const elements = new Map();
  const classList = () => {
    const values = new Set();
    return { add: v => values.add(v), remove: v => values.delete(v), contains: v => values.has(v),
      toggle(v, force) { const on = force === undefined ? !values.has(v) : force;
        if (on) values.add(v); else values.delete(v); return on; } };
  };
  const node = () => ({ style: {}, classList: classList(), attributes: {}, value: '', checked: false,
    textContent: '', innerHTML: '', disabled: false, hidden: false,
    setAttribute(k,v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, animate() { return { cancel() {} }; } });
  const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const handlers = {};
  const document = { hidden: false, body: node(), getElementById: get,
    querySelector: selector => get(selector), querySelectorAll: () => [],
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } };
  const colors = { '--graph-bg':'#10141D', '--graph-ink':'#F5F4F0', '--graph-curve':'#B1CBE6' };
  const getComputedStyle = () => ({ getPropertyValue: key => colors[key] || '', fontFamily: 'sans-serif' });
  let depth = 0; const calls = [];
  const ctx = { save() { depth++; }, restore() { depth--; if (depth < 0) throw Error('canvas restore imbalance'); } };
  for (const method of ['setTransform','clearRect','fillRect','setLineDash','beginPath','moveTo','lineTo','stroke','arc','fill','fillText','closePath']) {
    ctx[method] = (...args) => { if (args.some(x => typeof x === 'number' && !Number.isFinite(x))) throw Error('nonfinite canvas coordinate'); calls.push([method, ...args]); };
  }
  const canvas = { ...node(), clientWidth: 800, clientHeight: 600, getContext: () => ctx,
    getBoundingClientRect: () => ({left:0,top:0}), addEventListener() {} };
  const window = { devicePixelRatio: 3, scrollTo() {} };
  const ResizeObserver = class { observe() {} };
  const keys = ['document','window','ResizeObserver','getComputedStyle','matchMedia','requestAnimationFrame','cancelAnimationFrame'];
  const vals = [document,window,ResizeObserver,getComputedStyle,matchMedia,requestAnimationFrame,cancelAnimationFrame];
  const PlaneGraph = new Function(...keys, sources.graph + '\nreturn PlaneGraph;')(...vals);
  const StudioMotion = new Function(...keys, sources.motion + '\nreturn StudioMotion;')(...vals);
  const g = new PlaneGraph(canvas);
  g.resize();
  check('레티나 배율을 2로 제한', canvas.width === 1600 && canvas.height === 1200);
  const data = {
    view: {xmin:-4,xmax:2,ymin:-3,ymax:3}, K:[0,1,2,3,4],
    poles: [[0,0,1],[-2,0,1]], zeros: [[-1,0,1]],
    asymptotes:{centroid:-1,angles:[180],showCentroid:true},
    segments:[[-2,0],[null,-3]], breakpoints:[[-1,0]], angles:[[-1,1,-45]],
    crossings:[[0,1,3]], branches:[[[0,0],[-.5,0],[-1,0],[-1,1],[-1,2]],[[-2,0],[-1.5,0],[-1,0],[-1,-1],[-1,-2]]],
  };
  const baseline = JSON.stringify(data);
  g.setData(data);
  const [px,py]=g.toPx(-1.5,.75), world=g.toWorld(px,py);
  check('좌표 변환 왕복 일치', Math.abs(world.x+1.5)<1e-12 && Math.abs(world.y-.75)<1e-12);
  const origin=g.toPx(0,0), xunit=g.toPx(1,0), yunit=g.toPx(0,1);
  check('가로·세로 축척 동일', Math.abs(xunit[0]-origin[0]-(origin[1]-yunit[1]))<1e-12);
  check('캔버스별 어두운 색 읽기', g.colors.bg==='#10141D' && g.isStudio);
  for(let step=1;step<=9;step++) { g.setStep(step); frame(0); frame(3000); check(step+'단계 그리기 완료',g.progress===1 && depth===0); }
  check('엔진 데이터 변경 없음',JSON.stringify(data)===baseline);
  g.setStep(8); frame(0); frame(1200);
  check('곡선 중간 진행률',g.progress===.5);
  g.setStep(3);
  check('단계 이동 시 이전 RAF 취소',queue.size===1 && g.step===3);
  frame(0);frame(900);
  check('이전 재생의 뒤늦은 변경 없음',g.step===3 && g.progress===1 && queue.size===0);
  g.reducedMotion=true;g.setStep(8);
  check('움직임 줄이기에서는 즉시 완성',g.progress===1 && queue.size===0);
  g.reducedMotion=false;g.setStep(8);document.hidden=true;frame(100);
  check('숨겨진 문서의 그래프 RAF 중단',queue.size===0 && g.progress===1);
  document.hidden=false;
  g.progress=.25;g.setData(data);
  check('랜딩 스크롤 진행률 보존',g.progress===.25);
  g.stopAnimation();
  let settled=0;const samples=[];
  const motion=new StudioMotion(g,i=>{samples.push(i);g.kIndex=i;g.draw();},()=>settled++);
  motion.setStep(9);g.kIndex=0;motion.playK();frame(0);frame(4000);frame(8000);
  check('K 재생은 실제 표본 인덱스 사용',samples.join(',')==='0,2,4');
  check('재생 종료 시에만 검산 1회',settled===1 && !motion.playing);
  check('재생 종료 후 RAF 없음',queue.size===0);
  motion.playK();frame(0);motion.stopK(true);
  check('사용자 일시 정지는 검산 1회',settled===2 && !motion.playing);
  motion.playK();motion.setStep(5);
  check('단계 이동에서는 추가 API 요청 없음',settled===2 && !motion.playing);
  frame(0);frame(1000);
  motion.setStep(9);motion.playK();document.hidden=true;
  for(const fn of handlers.visibilitychange || [])fn();
  check('탭을 숨기면 K 재생 중단',!motion.playing && queue.size===0);
  document.hidden=false;
  get('focusGraph').onclick();
  check('집중 보기 진입과 aria 상태',document.body.classList.contains('focus-mode') && get('focusGraph').attributes['aria-pressed']==='true');
  motion.reset();
  check('문제 변경 시 집중 보기 해제',!document.body.classList.contains('focus-mode') && queue.size===0);
  media.matches=true;media.listeners.forEach(fn=>fn());
  check('OS 움직임 설정 즉시 반영',g.reducedMotion && get('playK').disabled && get('reduceMotion').checked);
  media.matches=false;get('reduceMotion').checked=false;get('reduceMotion').onchange();
  check('움직임 다시 허용',!g.reducedMotion && !get('playK').disabled);
  let requests=[];
  const API={poles(problem,K) {return new Promise((resolve,reject)=>requests.push({problem,K,resolve,reject}));}};
  const learnSource=sources.learn.replace(/\ninit\(\);\s*$/, '');
  const app=new Function('document','window','API','setTimeout','clearTimeout',
    learnSource+'\nreturn {state,setKIndex,exactPoles,setupK};'
  )(document,window,API,()=>123,()=>{});
  app.state.graph=g;app.state.motion=motion;app.state.problem={text:'fixture'};app.state.result={graph:data};app.state.step=9;
  app.setKIndex(1);
  const older=app.exactPoles();
  app.setKIndex(3);
  const newer=app.exactPoles();
  requests[1].resolve({poles:[{re:-1,im:1,text:'-1+j'}],status:'stable'});await newer;
  requests[0].resolve({poles:[{re:999,im:0,text:'999'}],status:'unstable'});await older;
  check('늦게 도착한 이전 K 응답 폐기',g.exactPoints[0][0]===-1 && g.exactPoints[0][1]===1);
  check('표본 K와 숫자 입력 일치',get('kValue').value==='3' && app.state.selectedK===3);
  app.setupK();get('kValue').valueAsNumber=2.5;get('kValue').onchange();
  check('직접 입력 K 대기 중 이전 극점 숨김',g.kIndex===null && g.exactPoints===null && requests[2].K===2.5);
  requests[2].resolve({poles:[{re:-1,im:.7,text:'-1+0.7j'}],status:'stable'});
  await Promise.resolve();await Promise.resolve();
  check('직접 입력은 Python 좌표 그대로 표시',g.exactPoints[0][1]===.7);
  get('kValue').valueAsNumber=-1;get('kValue').onchange();
  check('음수 K에서는 API 요청 차단',requests.length===3 && g.exactPoints===null);
  app.setKIndex(0);const lost=app.exactPoles();requests[3].reject(Error('offline'));await lost;
  check('서버 오류 후 표본 그래프 유지',g.kIndex===0 && get('kPoles').textContent.includes('서버 연결'));
  app.setKIndex(2);const different=app.exactPoles();app.state.problem={text:'new problem'};
  requests[4].resolve({poles:[{re:888,im:0,text:'888'}],status:'unstable'});await different;
  check('다른 문제의 오래된 응답 폐기',g.exactPoints===null);
  check('최종 Canvas save/restore 균형',depth===0);
  return passed;
}

runStudioTests({
  graph: read('graph.js'), motion: read('studio-motion.js'), learn: read('learn.js'),
}).then(passed => {
  console.log(passed.length + '/' + passed.length + ' checks passed');
  for (const name of passed) console.log('PASS ' + name);
}).catch(error => {
  console.error('FAIL ' + error.message);
  process.exitCode = 1;
});
