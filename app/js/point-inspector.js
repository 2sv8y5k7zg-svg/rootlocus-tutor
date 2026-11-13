/* Coordinates come from the current engine result. The small diagram explains
 * complex-plane geometry; it is not a simulated transfer-function response. */
(function (RL) {
  'use strict';
  function PointInspector(graph) {
    var self=this, box=document.getElementById('point-inspector'), selected=null, sign=1;
    function resolve(ref) {
      if(!graph.res || !ref) return null;
      var res=graph.res, i=+ref.slice(1), item, title, K, pole=false;
      if(ref.slice(0,2)==='cl') { item=graph.clPos && graph.clPos[+ref.slice(2)]; title='폐루프 극점'; pole=true; }
      else if(ref[0]==='p') { item=res.poles[i] && res.poles[i].s; title='개루프 극점 ×'; pole=true; }
      else if(ref[0]==='z') { item=res.zeros[i] && res.zeros[i].s; title='영점 ○'; }
      else if(ref[0]==='b') { var b=RL.content.validBreaks(res)[i]; if(b){item=b.c.s;title=RL.content.breakLabel(b.c);K=b.c.K;} }
      else if(ref[0]==='x') { var x=RL.content.crossingsPos(res)[i]; if(x){item={re:0,im:x.c.omega};title='허수축 교차';K=x.c.K;} }
      else if(ref==='c' && res.asymptotes) { item={re:res.asymptotes.centroid,im:0};title='점근선 중심'; }
      if(!item) return null;
      return {re:item.re,im:(/^[bxa]/.test(ref)?Math.abs(item.im)*sign:item.im),title:title,K:K,pole:pole};
    }
    function paint() {
      var p=resolve(selected); if(!p)return;
      var norm=Math.hypot(p.re,p.im), x=110+(norm?p.re/norm*70:0),y=100-(norm?p.im/norm*70:0);
      var f=RL.format.numShort, text=RL.format.cnum(p,3), zeta=norm?-p.re/norm:null;
      box.innerHTML='<div class="point-detail"><svg viewBox="0 0 220 200" role="img" aria-label="원점에서 선택한 점까지의 벡터와 실수부·허수부 투영">'+
        '<path class="point-axis" d="M20 100H200 M110 20V180"/><text x="190" y="94" fill="currentColor" font-size="12">σ</text><text x="118" y="24" fill="currentColor" font-size="12">jω</text>'+
        '<path class="point-projection" d="M'+x+' 100V'+y+'H110"/><line class="point-vector" x1="110" y1="100" x2="'+x+'" y2="'+y+'"/>'+
        '<circle cx="'+x+'" cy="'+y+'" r="5" fill="var(--accent)"/><text x="110" y="195" text-anchor="middle" fill="currentColor" font-size="11">원점에서의 거리 |s| = '+f(norm)+'</text></svg>'+
        '<div><h3>'+p.title+' · '+text+'</h3><dl><div><dt>실수부 σ</dt><dd>'+f(p.re)+'</dd></div><div><dt>허수부 ω</dt><dd>'+f(p.im)+'</dd></div>'+
        (p.pole?'<div><dt>고유진동수 ωn</dt><dd>'+f(norm)+'</dd></div><div><dt>감쇠비 ζ</dt><dd>'+(zeta===null?'정의되지 않음':f(zeta))+'</dd></div>':'')+
        (p.K!==undefined?'<div><dt>이 점의 K</dt><dd>'+f(p.K)+'</dd></div>':'')+'</dl><p>'+
        (p.pole?(selected.slice(0,2)==='cl'?'현재 K에서의 극점입니다. ':'개루프 극점의 기하학적 값이며 폐루프 안정 판정은 아닙니다. ')+ 'ωn = |s|, ζ = −σ/|s|. 원점에서는 감쇠비가 정의되지 않습니다.':'점의 복소평면 좌표를 표시합니다. 영점·핵심 점에는 극점의 감쇠비를 적용하지 않습니다.')+
        '</p></div></div>';
      graph.svg.querySelectorAll('[data-point]').forEach(function(n){n.setAttribute('aria-pressed',String(n.dataset.point===selected));});
    }
    this.select=function(ref,node){
      sign=1;
      if(node && /^[bxa]/.test(ref)) {var t=node.transform && node.transform.baseVal.consolidate();if(t && t.matrix.f>graph.Y(0))sign=-1;}
      if(!resolve(ref))return;selected=ref;paint();
      if(box.getBoundingClientRect().bottom>innerHeight) box.scrollIntoView({block:'nearest',behavior:document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    };
    this.refresh=function(){if(selected)paint();};
    this.reset=function(){selected=null;box.innerHTML='<p class="muted">그래프의 점 또는 극점 값을 눌러 좌표와 파라미터를 살펴보세요.</p>';};
    this.bind=function(){
      if(graph.cl)graph.cl.forEach(function(n,i){if(n.isConnected)n.dataset.point='cl'+i;});
      graph.svg.querySelectorAll('[data-ref]').forEach(function(n){if(resolve(n.dataset.ref))n.dataset.point=n.dataset.ref;});
      graph.svg.querySelectorAll('[data-point]').forEach(function(n){var p=resolve(n.dataset.point);if(!p)return;n.setAttribute('role','button');n.setAttribute('tabindex','0');n.setAttribute('aria-pressed',String(selected===n.dataset.point));n.setAttribute('aria-label',p.title+' '+RL.format.cnum(p,3)+' 파라미터 보기');});
    };
    this.dominant=function(){if(!graph.clPos || !graph.clPos.length)return;var i=0;graph.clPos.forEach(function(p,j){if(p.re>graph.clPos[i].re+1e-8 || (Math.abs(p.re-graph.clPos[i].re)<1e-8 && p.im>graph.clPos[i].im))i=j;});self.select('cl'+i);};
    document.getElementById('screen-lesson').addEventListener('click',function(e){var n=e.target.closest('[data-point],.ref[data-ref],tr[data-ref]');if(n)self.select(n.dataset.point||n.dataset.ref,n);});
    graph.svg.addEventListener('keydown',function(e){var n=e.target.closest('[data-point]');if(n&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();self.select(n.dataset.point,n);}});
  }
  RL.PointInspector=PointInspector;
})(window.RL=window.RL||{});
