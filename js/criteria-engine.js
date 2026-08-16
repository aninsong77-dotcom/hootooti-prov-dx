/* ==========================================================================
   criteria-engine.js — 정량 기준 5상태 판정 엔진

   js/criteria.js의 규칙과 상담자가 입력한 값을 받아 축별로 판정한다.
   순수 계산만 있고 DOM·네트워크 의존이 없어 node로 단독 테스트할 수 있다.

   설계 = docsPlan/quantified-criteria/{requirements,structure}.md

   ── 이 엔진이 지키는 안전 원칙 ────────────────────────────────────────────
   1. **미입력을 통과로 처리하지 않는다.** 값이 없으면 UNKNOWN이다. 외부 설계안의
      코드는 `userInput.durationMonths < 6` 비교에서 미입력(undefined)이 false가
      되어 조용히 통과했는데, 그 패턴을 구조적으로 막는다.
   2. **최소·최대를 모두 평가한다.** 하한만 보면 "18세 이상에서 진단"인 반사회성
      성격장애를 15세 내담자가 통과한다.
   3. **첫 미확인에서 멈추지 않는다.** 모든 축을 끝까지 평가해 결과를 모아 준다 —
      화면이 "기간은 충족, 기능손상은 미확인"처럼 축별로 보여줘야 하기 때문.
   4. **판정으로 진단을 배제하지 않는다.** 이 엔진은 상태만 돌려주고, 목록에서
      빼는 일은 어디서도 하지 않는다.
   5. **단위가 달라 경계에서 애매하면 UNKNOWN을 낸다.** 개월과 일은 정확히 환산되지
      않으므로(1개월 = 30일이 아님) 근사 비교가 경계에 가까우면 판정을 보류한다.
      조용히 틀린 PASS/FAIL을 내는 것보다 낫다.

   상태 5가지
     PASS         충족
     FAIL         미충족 (그래도 목록에서 빼지 않는다)
     UNKNOWN      상담자가 아직 입력하지 않음 — 물어보면 채울 수 있다
     QUALITATIVE  애초에 자동 판정 대상이 아님 — 물어봐도 자동으로는 못 정한다
     NA           그 진단에 해당 규칙이 자체가 없음 (종합에서 제외)
   ========================================================================== */

(function (root) {
  'use strict';

  /* ---------------------------------------------------------- 단위 처리 */

  // 시간 계열(정확 환산) / 날짜 계열(정확 환산) — 두 계열 사이는 근사만 가능하다.
  var SHORT = { hours: 1, days: 24, weeks: 168 };        // 기준: 시간
  var LONG = { months: 1, years: 12 };                   // 기준: 개월
  var LONG_TO_HOURS = 730.5;                             // 1개월 ≈ 30.44일 (근사)
  var AMBIGUOUS_RATIO = 0.05;                            // 5% 이내면 판정 보류

  var UNIT_KR = { hours: '시간', days: '일', weeks: '주', months: '개월', years: '년' };

  function familyOf(unit) {
    if (SHORT[unit]) return 'short';
    if (LONG[unit]) return 'long';
    return null;
  }

  function label(spec) {
    return spec.value + UNIT_KR[spec.unit];
  }

  // 두 기간을 비교한다.
  //   { cmp: -1|0|1, exact: true }        정확히 비교됨 (a<b, a==b, a>b)
  //   { ambiguous: true }                 단위 계열이 달라 경계에서 판정 불가
  function compareDuration(a, b) {
    var fa = familyOf(a.unit), fb = familyOf(b.unit);
    if (!fa || !fb) return { ambiguous: true };

    if (fa === fb) {
      var table = fa === 'short' ? SHORT : LONG;
      var av = a.value * table[a.unit], bv = b.value * table[b.unit];
      return { cmp: av === bv ? 0 : (av < bv ? -1 : 1), exact: true };
    }

    // 계열이 다르면 근사 환산. 두 값이 가까우면 판정을 보류한다.
    var ah = fa === 'short' ? a.value * SHORT[a.unit] : a.value * LONG[a.unit] * LONG_TO_HOURS;
    var bh = fb === 'short' ? b.value * SHORT[b.unit] : b.value * LONG[b.unit] * LONG_TO_HOURS;
    var diff = Math.abs(ah - bh) / Math.max(ah, bh);
    if (diff <= AMBIGUOUS_RATIO) return { ambiguous: true };
    return { cmp: ah < bh ? -1 : 1, exact: false };
  }

  // 연령은 개월로 환산해 비교한다(영아 기준이 있어 년 단위만으로는 부족).
  function ageToMonths(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v * 12;                 // 숫자면 '세'로 본다
    if (!v.unit) return null;
    if (v.unit === 'years') return v.value * 12;
    if (v.unit === 'months') return v.value;
    return null;
  }

  /* ------------------------------------------------------------ 축 판정 */

  function na() { return { status: 'NA' }; }
  function qualitative(need) { return { status: 'QUALITATIVE', need: need || null }; }
  function unknown(need) { return { status: 'UNKNOWN', need: need || null }; }
  function pass(reason) { return { status: 'PASS', reason: reason || null }; }
  function failWith(reason, need) { return { status: 'FAIL', reason: reason, need: need || null }; }

  // 예외 조항이 이 축을 면제하는지
  function waived(criteria, input, axis) {
    if (!criteria.exceptions || !input || !input.exceptions) return null;
    for (var i = 0; i < criteria.exceptions.length; i++) {
      var e = criteria.exceptions[i];
      if (input.exceptions[e.id] && e.waives && e.waives.indexOf(axis) !== -1) return e;
    }
    return null;
  }

  function evalDuration(criteria, input) {
    var rule = criteria.duration;
    if (!rule) return na();
    if (rule.qualitative) return qualitative('지속 기간을 직접 확인해야 합니다');

    var ex = waived(criteria, input, 'duration');
    if (ex) return { status: 'NA', reason: ex.label + ' — 기간 조건이 면제됩니다' };

    // 소아/성인 기준 분기: 연령이 있어야 어떤 기준을 쓸지 정해진다.
    var min = rule.min;
    if (rule.minIfUnder) {
      var months = ageToMonths(input && input.age);
      if (months === null) {
        return unknown('내담자 연령을 먼저 입력해 주세요 — ' +
          rule.minIfUnder.age + '세 미만은 ' + rule.minIfUnder.value + UNIT_KR[rule.minIfUnder.unit] +
          ', 이상은 ' + label(rule.min) + ' 기준입니다');
      }
      if (months < rule.minIfUnder.age * 12) min = { value: rule.minIfUnder.value, unit: rule.minIfUnder.unit };
    }

    var need = [];
    if (min) need.push(label(min) + ' 이상');
    if (rule.max) need.push(label(rule.max) + (rule.maxInclusive ? ' 이내' : ' 미만'));
    var needText = need.join(', ');

    if (!input || !input.duration || input.duration.value === undefined || input.duration.value === null) {
      return unknown(needText);
    }
    var got = input.duration;

    if (min) {
      var c = compareDuration(got, min);
      if (c.ambiguous) return unknown(needText + ' — 입력 단위(' + UNIT_KR[got.unit] + ')로는 경계에서 판정할 수 없습니다. 같은 단위로 입력해 주세요');
      if (c.cmp < 0) return failWith(needText + ' 이어야 하는데 ' + label(got) + ' 입력됨', needText);
    }
    if (rule.max) {
      var c2 = compareDuration(got, rule.max);
      if (c2.ambiguous) return unknown(needText + ' — 입력 단위(' + UNIT_KR[got.unit] + ')로는 경계에서 판정할 수 없습니다. 같은 단위로 입력해 주세요');
      var over = rule.maxInclusive ? c2.cmp > 0 : c2.cmp >= 0;
      if (over) return failWith(needText + ' 이어야 하는데 ' + label(got) + ' 입력됨', needText);
    }
    return pass(label(got) + ' — ' + needText + ' 충족');
  }

  function evalAge(criteria, input) {
    var rule = criteria.age;
    if (!rule) return na();

    var kindText = rule.kind === 'onset' ? '발병 연령' : '진단 시 연령';
    var need = [];
    if (rule.min) need.push(label(rule.min) + ' 이상');
    if (rule.max) need.push(label(rule.max) + ' 이하');
    var needText = kindText + ' ' + need.join(', ');

    // 발병 연령과 현재 연령은 다르다. 발병 기준이면 onsetAge를 쓰고, 없으면 물어야 한다.
    var raw = rule.kind === 'onset'
      ? (input ? input.onsetAge : undefined)
      : (input ? input.age : undefined);
    var months = ageToMonths(raw);
    if (months === null) return unknown(needText);

    if (rule.min && months < ageToMonths(rule.min)) {
      return failWith(needText + ' 이어야 하는데 ' + formatAge(months) + ' 입력됨', needText);
    }
    if (rule.max && months > ageToMonths(rule.max)) {
      return failWith(needText + ' 이어야 하는데 ' + formatAge(months) + ' 입력됨', needText);
    }
    return pass(formatAge(months) + ' — ' + needText + ' 충족');
  }

  function formatAge(months) {
    if (months < 24) return months + '개월';
    return Math.floor(months / 12) + '세';
  }

  var FREQ_LEVELS = { occasional: 1, most_days: 2, almost_always: 3 };
  var FREQ_LEVEL_KR = { occasional: '이따금', most_days: '대부분의 날에', almost_always: '거의 항상' };
  var PER_KR = { week: '주', month: '월' };
  var PER_TO_MONTH = { week: 4, month: 1 };

  function evalFrequency(criteria, input) {
    var rule = criteria.frequency;
    if (!rule) return na();

    if (rule.level) {
      var needText = FREQ_LEVEL_KR[rule.level] + ' 이상';
      var got = input ? input.frequency : undefined;
      if (got === undefined || got === null) return unknown(needText);
      var gotLevel = typeof got === 'string' ? got : null;
      if (!gotLevel || !FREQ_LEVELS[gotLevel]) return unknown(needText);
      if (FREQ_LEVELS[gotLevel] < FREQ_LEVELS[rule.level]) {
        return failWith(needText + ' 이어야 하는데 "' + FREQ_LEVEL_KR[gotLevel] + '" 입력됨', needText);
      }
      return pass(FREQ_LEVEL_KR[gotLevel]);
    }

    var need2 = PER_KR[rule.per] + ' ' + rule.minCount + '회 이상';
    var g = input ? input.frequency : undefined;
    if (!g || typeof g !== 'object' || g.count === undefined || g.count === null) return unknown(need2);

    if (g.per === rule.per) {
      if (g.count < rule.minCount) return failWith(need2 + ' 이어야 하는데 ' + PER_KR[g.per] + ' ' + g.count + '회 입력됨', need2);
      return pass(PER_KR[g.per] + ' ' + g.count + '회');
    }
    // 기간 단위가 다르면 근사 환산 후, 경계에 가까우면 보류한다.
    var gm = g.count * PER_TO_MONTH[g.per], rm = rule.minCount * PER_TO_MONTH[rule.per];
    if (!PER_TO_MONTH[g.per]) return unknown(need2);
    var diff = Math.abs(gm - rm) / Math.max(gm, rm);
    if (diff <= AMBIGUOUS_RATIO) return unknown(need2 + ' — 입력 단위가 달라 경계에서 판정할 수 없습니다');
    if (gm < rm) return failWith(need2 + ' 이어야 하는데 ' + PER_KR[g.per] + ' ' + g.count + '회 입력됨', need2);
    return pass(PER_KR[g.per] + ' ' + g.count + '회');
  }

  function evalDailyTime(criteria, input) {
    var rule = criteria.dailyTime;
    if (!rule || !rule.min) return na();
    var needText = '하루 ' + label(rule.min) + ' 이상 소요';
    var got = input ? input.dailyTime : undefined;
    if (!got || got.value === undefined || got.value === null) return unknown(needText);
    var c = compareDuration(got, rule.min);
    if (c.ambiguous) return unknown(needText);
    if (c.cmp < 0) return failWith(needText + ' 이어야 하는데 ' + label(got) + ' 입력됨', needText);
    return pass('하루 ' + label(got));
  }

  function evalImpairment(criteria, input) {
    var rule = criteria.impairment;
    if (!rule || !rule.required) return na();
    var needText = '일상 기능(직업·학업·사회관계)에 뚜렷한 지장';
    var got = input ? input.impairment : undefined;
    if (got === undefined || got === null) return unknown(needText);
    if (got === false) return failWith('기능 손상이 없다고 표시됨', needText);
    return pass('기능 손상 있음');
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
  // input   : { age, onsetAge, duration:{value,unit}, frequency, impairment,
  //             dailyTime:{value,unit}, exceptions:{id:true} } — 미입력 항목은 생략
  function evaluate(criteria, input) {
    if (!criteria) {
      return { overall: 'NA', axes: {}, notes: [], exceptions: [] };
    }
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
    };

    return {
      overall: combine(axes),
      axes: axes,
      notes: (criteria.notes || []).slice(),
      exceptions: (criteria.exceptions || []).slice(),
    };
  }

  // 화면이 "무엇을 더 물어야 하는가"를 알기 위한 도우미.
  // UNKNOWN인 축의 이름과 안내 문구만 추린다.
  function pendingAxes(result) {
    if (!result || !result.axes) return [];
    return Object.keys(result.axes)
      .filter(function (k) { return result.axes[k].status === 'UNKNOWN'; })
      .map(function (k) { return { axis: k, need: result.axes[k].need }; });
  }

  var api = {
    evaluate: evaluate,
    pendingAxes: pendingAxes,
    compareDuration: compareDuration,
    STATUS_KR: {
      PASS: '충족', FAIL: '미충족', UNKNOWN: '미확인',
      QUALITATIVE: '직접 확인 필요', NA: '해당 없음',
    },
    AXIS_KR: {
      duration: '기간', age: '연령', frequency: '빈도',
      dailyTime: '하루 소요시간', impairment: '기능 손상',
    },
  };

  root.HututiCriteriaEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
