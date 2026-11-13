// Independent known-root construction: choose Q, N and K, then D = Q - K*N.
// Expected roots come from Q's chosen factors, not the engine under test.
'use strict';
const fs=require('fs'),path=require('path');
['complex','poly','format','routh','locus'].forEach(f=>require('../js/'+f+'.js'));
require('../app/js/parser.js');
const checks=[],failures=[];
function check(name,ok,detail){checks.push(name);if(!ok)failures.push({name,detail});}
function multiply(a,b){const c=Array(a.length+b.length-1).fill(0);a.forEach((x,i)=>b.forEach((y,j)=>c[i+j]+=x*y));return c;}
function combine(a,b,k){const n=Math.max(a.length,b.length);return Array.from({length:n},(_,i)=>(a[i-n+a.length]||0)+k*(b[i-n+b.length]||0));}
function expression(a){return a.map((c,i)=>'('+c+')'+(a.length-i>1?'*s^'+(a.length-i-1):'')).join('+');}
function residual(a,z){let re=0,im=0,scale=0;for(const c of a){const next=re*z.re-im*z.im+c;im=re*z.im+im*z.re;re=next;scale=scale*Math.hypot(z.re,z.im)+Math.abs(c);}return Math.hypot(re,im)/Math.max(1,scale);}
function match(got,want){const left=got.slice();return left.length===want.length&&want.every(z=>{let best=0;left.forEach((v,i)=>{if(Math.hypot(v.re-z[0],v.im-z[1])<Math.hypot(left[best].re-z[0],left[best].im-z[1]))best=i;});return Math.hypot(left[best].re-z[0],left.splice(best,1)[0].im-z[1])<2e-5*Math.max(1,Math.hypot(...z));});}
let systems=0;
for(let order=1;order<=4;order++)for(let seed=1;seed<=40;seed++){
 let Q=[1],expected=[];
 if(order>=2&&seed%2===0){const re=seed%5===0?.5:-(seed%7+1)/4,im=(seed%9+1)/3;Q=multiply(Q,[1,-2*re,re*re+im*im]);expected.push([re,im],[re,-im]);}
 while(expected.length<order){const re=-(seed%11+expected.length+1)/3;Q=multiply(Q,[1,-re]);expected.push([re,0]);}
 const degree=seed%(order+1),N=Array.from({length:degree+1},(_,i)=>(i+1)/(seed%3+1)),K=(seed%4+1)/10;
 const D=combine(Q,N,-K),input='K*('+expression(N)+')/('+expression(D)+')';
 const parsed=RL.parser.parse(input);check('parse constructed '+order+'/'+seed,parsed.ok,input);if(!parsed.ok)continue;
 // D and N share a root iff Q and N do. Determine this from our chosen roots.
 const cancellation=expected.some(([re,im])=>{let a=0,b=0;for(const c of N){const next=a*re-b*im+c;b=a*im+b*re;a=next;}return Math.hypot(a,b)<1e-9;});
 const res=RL.locus.analyze(parsed.N,parsed.D,{branches:false});
 if(cancellation){check('known cancellation rejected '+order+'/'+seed,!res.ok&&res.error.code==='cancel');continue;}
 check('analyze constructed '+order+'/'+seed,res.ok,res.error);if(!res.ok)continue;
 systems++;const roots=RL.routh.closedLoopPoles(parsed.N,parsed.D,K);
 check('independent known roots '+order+'/'+seed,match(roots,expected),{input,K,roots,expected});
 check('stability at constructed K '+order+'/'+seed,RL.routh.classify(roots)===(expected.some(z=>z[0]>0)?'unstable':'stable'));
 const interval=res.stability.intervals.find(x=>K>x.lo&&K<x.hi);
 if(interval)check('stability interval '+order+'/'+seed,interval.status===(expected.some(z=>z[0]>0)?'unstable':'stable'),{input,K,interval});
}
const examples=['K/(s+7)','2K/((s+0.5)(s+4))','K(s+0.3)/(s^2+2s+5)','3K(s+5)/(s^3+7s^2+14s+8)','K/(s^4+8s^3+25s^2+38s+24)','K(s^2+2s+5)/(s^2+6s+13)','K/(s-2)','K/(s+2)^4','K/(s^2+9)','K/s^4'];
for(const input of examples){const p=RL.parser.parse(input),r=p.ok&&RL.locus.analyze(p.N,p.D);check('new full graph '+input,r&&r.ok,r.error);if(r.ok){check('finite branches '+input,r.branches.length===r.n&&r.branches.every(b=>b.every(z=>Number.isFinite(z.re)&&Number.isFinite(z.im)&&Number.isFinite(z.K))));check('branches satisfy D+KN independently '+input,r.branches.every(b=>b.every(z=>residual(combine(p.D,p.N,z.K),z)<1e-7)));}}
for(const input of ['K/(s^5+1)','K(s+2)/(s+2)','K(s^3+1)/(s+1)','-K/(s+1)','K/0','sin(s)','exp(-s)/(s+1)','K^2/(s+1)','1/(K+s)','K/(s+)']){const p=RL.parser.parse(input),r=p.ok&&RL.locus.analyze(p.N,p.D,{branches:false});check('unsupported rejected '+input,!p.ok||!r.ok);}
for(const input of ['1e309/(s+1)','1e-999/(s+1)','1e308*1e308*s/(s+1)','0.00000000001/(s+1)','K/(1e-14*s^4+s+1)','K/((s+1)^12)^12','('.repeat(300)+'s'+')'.repeat(300),'s'.repeat(2049)]) check('numeric/complexity guard '+input.slice(0,45),!RL.parser.parse(input).ok);
const scientific=RL.parser.parse('2.5e-3K/(s+2e0)');check('scientific coefficient notation',scientific.ok&&scientific.N[0]===.0025&&scientific.D[1]===2);
const scaled=RL.parser.parse('K/(0.00000000001*(s+1))');check('nonzero small denominator not mislabeled zero',scaled.ok&&scaled.N[0]===1e11);
for(const [name,roots,status] of [
 ['simple origin',[[0,0]],'marginal'],['double origin',[[0,0],[0,0]],'unstable'],
 ['simple imaginary pair',[[0,2],[0,-2]],'marginal'],['repeated imaginary pair',[[0,2],[0,2],[0,-2],[0,-2]],'unstable'],
 ['repeated negative real pole',[[-2,0],[-2,0]],'stable'],['right half-plane pole',[[.5,0]],'unstable']
])check('stability regression '+name,RL.routh.classify(roots.map(([re,im])=>({re,im})))===status);
check('K/s^2 at K=0 is not marginal',RL.routh.classify(RL.routh.closedLoopPoles([1],[1,0,0],0))==='unstable');
const report={systems,checks:checks.length,failures};fs.writeFileSync(path.join(__dirname,'general-input-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;
