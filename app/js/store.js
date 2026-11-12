/*
 * store.js — 학습 기록 (같은 기기의 브라우저에만 저장)
 * 다른 기기와 자동으로 맞춰지지 않고, 브라우저 데이터를 지우면 사라집니다. 화면에도 이렇게 안내합니다.
 * 저장이 막힌 환경(사생활 보호 창 등)에서도 화면은 그대로 동작하도록 모든 읽기·쓰기를 try로 감쌉니다.
 */
(function (RL) {
  'use strict';
  var KEY = 'rltutor.records.v1';

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(v)) return [];
      return v.filter(function (r) {
        return r && typeof r.id === 'string' && typeof r.input === 'string' &&
          typeof r.tf === 'string' && typeof r.date === 'string' &&
          Number.isInteger(r.lastStep) && r.lastStep >= 1 && r.lastStep <= 9;
      });
    }
    catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40))); return true; }
    catch (e) { return false; }
  }
  // 같은 식이면 하나로 합쳐 최신 상태로 갱신
  function upsert(rec) {
    var list = load(), i, found = -1;
    for (i = 0; i < list.length; i++) if (list[i].id === rec.id) found = i;
    if (found >= 0) {
      rec.done = rec.done || list[found].done;
      list.splice(found, 1);
    }
    list.unshift(rec);
    return save(list);
  }
  function remove(id) {
    var list = load(), out = [], i;
    for (i = 0; i < list.length; i++) if (list[i].id !== id) out.push(list[i]);
    return save(out);
  }
  function getPref(k, d) { try { var v = localStorage.getItem('rltutor.' + k); return v === null ? d : v; } catch (e) { return d; } }
  function setPref(k, v) { try { localStorage.setItem('rltutor.' + k, v); } catch (e) { /* 저장 불가 환경 */ } }

  RL.store = { load: load, upsert: upsert, remove: remove, getPref: getPref, setPref: setPref };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
