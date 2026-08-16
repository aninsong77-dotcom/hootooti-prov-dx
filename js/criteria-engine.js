/* ==========================================================================
   criteria-engine.js — 진단기준 5상태 판정 엔진

   js/criteria.js의 규칙과 상담자가 답한 내용을 받아 축별로 판정한다.
   순수 계산만 있고 DOM·네트워크 의존이 없어 node로 단독 테스트할 수 있다.

   설계 = docsPlan/quantified-criteria/{requirements,structure}.md

   ── 묻는 방식: 기준을 보여주고 예/아니오를 받는다 ─────────────────────────
   처음에는 숫자와 단위를 직접 입력받았다("3" + "주"). 두 가지 문제가 있었다.
     ① 입력이 번거롭다 — 숫자 타이핑 + 단위 선택
     ② 단위가 다르면 경계에서 판정할 수 없다 — "1개월"과 "30일"은 정확히 같지
        않아 경계 근처에서는 판정을 보류해야 했다
   이제 **기준을 문장으로 보여주고 예/아니오를 받는다.**
     "2주 이상 지속되었습니까?" → 예 / 아니오 / 확인 안 됨
   임상가가 실제로 판단하는 방식과 같고, 기록으로도 더 정확하다 — 상담자가
   판단한 내용 그대로이지, 입력한 숫자를 우리가 해석한 결과가 아니다.

   질문 문장은 **규칙에서 자동으로 조립한다**(min: 2주 → "2주 이상 지속되었습니까?").
   사람이 81개를 손으로 쓰지 않으므로 원문과 어긋날 수 없다.

   연령만 숫자로 받는다 — "성인 2년 / 소아 1년"처럼 나이에 따라 기준이 갈리는
   진단이 있어, 나이를 알아야 어느 질문을 보여줄지 정해지기 때문이다.
   세션당 한 번만 묻는다.

   ── 지키는 안전 원칙 ──────────────────────────────────────────────────────
   1. **미응답을 통과로 처리하지 않는다.** 답이 없으면 UNKNOWN이다.
   2. **최소·최대를 모두 평가한다.** 하한만 보면 "18세 이상에서 진단"인 반사회성
      성격장애를 15세 내담자가 통과한다.
   3. **첫 미확인에서 멈추지 않는다.** 모든 축을 끝까지 평가해 모아 준다.
   4. **판정으로 진단을 배제하지 않는다.** 상태만 돌려주고 목록에서 빼지 않는다.

   상태 5가지
     PASS         충족
     FAIL         미충족 (그래도 목록에서 빼지 않는다)
     UNKNOWN      아직 답하지 않음 — 물어보면 채울 수 있다
     QUALITATIVE  애초에 자동 판정 대상이 아님 — 물어봐도 자동으로는 못 정한다
     NA           그 진단에 해당 규칙이 없음 (종합에서 제외)
   ========================================================================== */

(function (root) {
  'use strict';

  var UNIT_KR = { hours: '시간', days: '일', weeks: '주', months: '개월', years: '년' };
  var AGE_UNIT_KR = { years: '세', months: '개월' };
  var PER_KR = { week: '주', month: '월' };
  var FREQ_LEVEL_KR = { occasional: '이따금', most_days: '대부분의 날에', almost_always: '거의 항상' };

  function label(spec) { return spec.value + UNIT_KR[spec.unit]; }
  function ageLabel(spec) { return spec.value + AGE_UNIT_KR[spec.unit]; }

  // 연령은 개월로 환산해 비교한다(영아 기준이 있어 년 단위만으로는 부족).
  function ageToMonths(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v * 12;                 // 숫자면 '세'로 본다
    if (!v.unit) return null;
    if (v.unit === 'years') return v.value * 12;
    if (v.unit === 'months') return v.value;
    return null;
  }

  function formatAge(months) {
    if (months < 24) return months + '개월';
    return Math.floor(months / 12) + '세';
  }

  /* ------------------------------------------------------------ 축 결과 */

  function na() { return { status: 'NA' }; }
  function qualitative(need) { return { status: 'QUALITATIVE', need: need || null }; }
  function unknown(question) { return { status: 'UNKNOWN', question: question, need: question }; }
  function pass(question, reason) { return { status: 'PASS', question: question, reason: reason }; }
  function failWith(question, reason) { return { status: 'FAIL', question: question, reason: reason }; }

  // 예/아니오 답을 상태로 바꾼다. 세 축(기간·빈도·하루 소요시간)이 같은 방식이다.
  function answerToStatus(question, answer) {
    if (answer === undefined || answer === null) return unknown(question);
    if (answer === false) return failWith(question, '“아니오”로 답하셨습니다');
    return pass(question, '“예”로 답하셨습니다');
  }

  // 예외 조항이 이 축을 면제하는지
  function waived(criteria, input, axis) {
    if (!criteria.exceptions || !input || !input.exceptions) return null;
    for (var i = 0; i < criteria.exceptions.length; i++) {
      var e = criteria.exceptions[i];
      if (input.exceptions[e.id] && e.waives && e.waives.indexOf(axis) !== -1) return e;
    }
    return null;
  }

  function met(input, axis) {
    return (input && input.met) ? input.met[axis] : undefined;
  }

  /* --------------------------------------------------------------- 기간 */

  // 규칙에서 질문 문장을 조립한다.
  //   min만        "2주 이상 지속되었습니까?"
  //   min+max      "1개월 이상 6개월 미만입니까?"
  //   max만        "6개월 이내입니까?"
  function durationQuestion(min, rule) {
    var parts = [];
    if (min) parts.push(label(min) + ' 이상');
    if (rule.max) parts.push(label(rule.max) + (rule.maxInclusive ? ' 이내' : ' 미만'));
    if (min && !rule.max) return parts[0] + ' 지속되었습니까?';
    return parts.join(' ') + '입니까?';
  }

  function evalDuration(criteria, input) {
    var rule = criteria.duration;
    if (!rule) return na();
    if (rule.qualitative) return qualitative('지속 기간을 직접 확인해야 합니다');

    var ex = waived(criteria, input, 'duration');
    if (ex) return { status: 'NA', reason: ex.label + ' — 기간 조건이 면제됩니다' };

    // 소아/성인 기준 분기: 연령을 알아야 어느 기준을 보여줄지 정해진다.
    var min = rule.min;
    if (rule.minIfUnder) {
      var months = ageToMonths(input && input.age);
      if (months === null) {
        return unknown('내담자 연령을 먼저 입력해 주세요 — ' +
          rule.minIfUnder.age + '세 미만은 ' + rule.minIfUnder.value + UNIT_KR[rule.minIfUnder.unit] +
          ', 이상은 ' + label(rule.min) + ' 기준입니다');
      }
      if (months < rule.minIfUnder.age * 12) {
        min = { value: rule.minIfUnder.value, unit: rule.minIfUnder.unit };
      }
    }
    return answerToStatus(durationQuestion(min, rule), met(input, 'duration'));
  }

  /* --------------------------------------------------------------- 연령 */

  // 연령만 숫자로 받는다(위 파일 주석 참고). 발병 연령과 현재 연령은 다르다.
  function evalAge(criteria, input) {
    var rule = criteria.age;
    if (!rule) return na();

    var kindText = rule.kind === 'onset' ? '발병 연령' : '진단 시 연령';
    var need = [];
    if (rule.min) need.push(ageLabel(rule.min) + ' 이상');
    if (rule.max) need.push(ageLabel(rule.max) + ' 이하');
    var needText = kindText + ' ' + need.join(', ');

    var raw = rule.kind === 'onset'
      ? (input ? input.onsetAge : undefined)
      : (input ? input.age : undefined);
    var months = ageToMonths(raw);
    if (months === null) return unknown(needText);

    if (rule.min && months < ageToMonths(rule.min)) {
      return failWith(needText, needText + ' 이어야 하는데 ' + formatAge(months) + ' 입력됨');
    }
    if (rule.max && months > ageToMonths(rule.max)) {
      return failWith(needText, needText + ' 이어야 하는데 ' + formatAge(months) + ' 입력됨');
    }
    return pass(needText, formatAge(months) + ' — ' + needText + ' 충족');
  }

  /* --------------------------------------------------------------- 빈도 */

  function frequencyQuestion(rule) {
    if (rule.level) return FREQ_LEVEL_KR[rule.level] + ' 나타납니까?';
    return PER_KR[rule.per] + ' ' + rule.minCount + '회 이상 나타납니까?';
  }

  function evalFrequency(criteria, input) {
    var rule = criteria.frequency;
    if (!rule) return na();
    return answerToStatus(frequencyQuestion(rule), met(input, 'frequency'));
  }

  /* ------------------------------------------------------- 하루 소요시간 */

  function evalDailyTime(criteria, input) {
    var rule = criteria.dailyTime;
    if (!rule || !rule.min) return na();
    return answerToStatus('하루 ' + label(rule.min) + ' 이상 소요됩니까?', met(input, 'dailyTime'));
  }

  /* ----------------------------------------------------------- 기능 손상 */

  function evalImpairment(criteria, input) {
    var rule = criteria.impairment;
    if (!rule || !rule.required) return na();
    var q = '일상 기능(직업·학업·사회관계)에 뚜렷한 지장이 있습니까?';
    var got = input ? input.impairment : undefined;
    if (got === undefined || got === null) return unknown(q);
    if (got === false) return failWith(q, '기능 손상이 없다고 표시됨');
    return pass(q, '기능 손상 있음');
  }

  /* ----------------------------------------------------------- 추가 조건 */

  // 진단기준 중 예/아니오로 답할 수 있는 조건들. 기간처럼 수치로 재지는 못하지만
  // 상담자가 판단해 답할 수 있는 것들이다 — 예: "증상이 없던 기간이 2개월을 넘지
  // 않았습니까?"(지속성우울장애), "2개 이상의 환경에서 나타납니까?"(ADHD).
  // 전에는 안내 문구로만 보여줘 판정에 반영되지 않았다.
  function evalConfirmations(criteria, input) {
    var list = criteria.confirmations;
    if (!list || !list.length) return na();

    var got = (input && input.confirmations) || {};
    var failed = [], pending = [];
    list.forEach(function (c) {
      var v = got[c.id];
      if (v === false) failed.push(c.text);
      else if (v !== true) pending.push(c.text);
    });

    var allText = list.map(function (c) { return c.text; }).join(' / ');
    if (failed.length) return failWith(allText, '충족하지 못한 조건: ' + failed.join(' / '));
    if (pending.length) return unknown('확인이 필요한 조건: ' + pending.join(' / '));
    return pass(allText, list.length + '개 조건 모두 충족');
  }

  /* ---------------------------------------------------------- 종합 판정 */

  // FAIL 하나라도 있으면 FAIL. 없으면 UNKNOWN, 그다음 QUALITATIVE, 전부 통과면 PASS.
  // NA는 종합에서 제외한다 — 규칙이 없는 것을 "통과"로 세면 충족을 부풀리게 된다.
  function combine(axes) {
    var statuses = Object.keys(axes)
      .map(function (k) { return axes[k].status; })
      .filter(function (s) { return s !== 'NA'; });

    if (!statuses.length) return 'QUALITATIVE';
    if (statuses.indexOf('FAIL') !== -1) return 'FAIL';
    if (statuses.indexOf('UNKNOWN') !== -1) return 'UNKNOWN';
    if (statuses.indexOf('QUALITATIVE') !== -1) return 'QUALITATIVE';
    return 'PASS';
  }

  /* ------------------------------------------------------------ 공개 API */

  // criteria: js/criteria.js의 한 진단 규칙 (없으면 null)
  // input   : { age, onsetAge,
  //             met: { duration, frequency, dailyTime },   // 예=true / 아니오=false / 미응답=없음
  //             impairment, confirmations:{id:true|false}, exceptions:{id:true} }
  function evaluate(criteria, input) {
    if (!criteria) return { overall: 'NA', axes: {}, notes: [], exceptions: [] };

    if (criteria.qualitative) {
      return {
        overall: 'QUALITATIVE',
        axes: {},
        notes: (criteria.notes || []).slice(),
        exceptions: [],
        qualitativeReason: '이 진단의 기간·기타 기준은 수치가 아니라 서술로만 정의되어 있어 자동으로 판정할 수 없습니다. 직접 확인해 주세요.',
      };
    }

    var axes = {
      duration: evalDuration(criteria, input),
      age: evalAge(criteria, input),
      frequency: evalFrequency(criteria, input),
      dailyTime: evalDailyTime(criteria, input),
      impairment: evalImpairment(criteria, input),
      confirmations: evalConfirmations(criteria, input),
    };

    return {
      overall: combine(axes),
      axes: axes,
      notes: (criteria.notes || []).slice(),
      exceptions: (criteria.exceptions || []).slice(),
    };
  }

  // 화면이 "무엇을 더 물어야 하는가"를 알기 위한 도우미.
  function pendingAxes(result) {
    if (!result || !result.axes) return [];
    return Object.keys(result.axes)
      .filter(function (k) { return result.axes[k].status === 'UNKNOWN'; })
      .map(function (k) { return { axis: k, need: result.axes[k].need }; });
  }

  var api = {
    evaluate: evaluate,
    pendingAxes: pendingAxes,
    STATUS_KR: {
      PASS: '충족', FAIL: '미충족', UNKNOWN: '미확인',
      QUALITATIVE: '직접 확인 필요', NA: '해당 없음',
    },
    AXIS_KR: {
      duration: '기간', age: '연령', frequency: '빈도',
      dailyTime: '하루 소요시간', impairment: '기능 손상',
      confirmations: '추가 조건',
    },
  };

  root.HututiCriteriaEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
