/* Device-local time only; no network, location permission or inferred emotions. */
(function (RL) {
  'use strict';
  function choose(hour, returning, random) {
    random = random || Math.random;
    var greetings = ['반갑습니다.'];
    if (hour >= 5 && hour < 11) greetings.push('좋은 아침입니다.');
    else if (hour >= 11 && hour < 17) greetings.push('좋은 오후입니다.');
    else if (hour >= 17 && hour < 22) greetings.push('좋은 저녁입니다.');
    else greetings.push('편안한 밤입니다.');
    if (returning) greetings.push('다시 만나 반갑습니다.');
    var prompts = ['어떤 식으로 시작해 볼까요?', '식 하나에서 시작해 볼까요?', '준비한 식을 입력해 주세요.', '어떤 궤적을 만나볼까요?'];
    return { greeting:greetings[Math.floor(random() * greetings.length)], prompt:prompts[Math.floor(random() * prompts.length)] };
  }
  RL.welcomeCopy = { choose:choose };
})(typeof window !== 'undefined' ? (window.RL = window.RL || {}) : (globalThis.RL = globalThis.RL || {}));
