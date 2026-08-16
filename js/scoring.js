/* ==========================================================================
   scoring.js — 후투티 채점 로직 (순수 함수)

   js/main.js 안에 있던 채점 3함수(keyOf·groupSatisfied·diagnosisScore)를
   그대로 옮겨온 것이다. 옮긴 이유는 guided-intake-wizard 트랙에서 새 화면
   (index.html 위저드)이 같은 채점 규칙을 써야 하는데, main.js가 전체를
   IIFE로 감싸고 있어 외부에서 호출할 방법이 없었기 때문이다
   (docsPlan/guided-intake-wizard/structure.md §3.1).

   원본과 달라진 점은 딱 하나 — 체크 상태(checked)를 파일 전역 변수에서
   읽지 않고 **인자로 받는다**. 그래서 이 파일은 상태를 갖지 않으며 어느
   화면에서든 같은 결과를 낸다. 계산 규칙 자체는 한 글자도 바꾸지 않았다
   (동치 테스트로 검증 — structure.md §6.1).

   ES 모듈이 아니라 일반 스크립트인 것도 의도적이다. 파일을 브라우저로
   직접 열었을 때(file://) 모듈은 차단되지만 일반 스크립트는 동작하므로,
   AI 없이 체크리스트·위저드만 쓰는 배포 형태가 살아남는다
   (requirements.md §4.6).

   checked 형태: { 'diagId::groupIndex::itemIndex': true, ... }
   ========================================================================== */

(function (root) {
  'use strict';

  // 체크 상태 객체의 키를 만든다. 이 형식은 checklist.html의 체크박스 id
  // 생성(main.js checkboxId)과 sessionStorage 저장 형식에도 그대로 쓰이므로
  // 임의로 바꾸면 저장된 진행 상태를 읽지 못한다.
  function keyOf(diagId, g, i) {
    return diagId + '::' + g + '::' + i;
  }

  // 항목군 하나의 충족 현황.
  //   count : 체크된 항목 수
  //   min   : 충족에 필요한 최소 개수 (data.js가 정의)
  //   met   : 충족 여부
  //   ratio : 진행률(0~1). min을 넘어도 1로 고정한다.
  function groupSatisfied(diag, gIdx, checked) {
    var g = diag.groups[gIdx];
    var n = 0;
    for (var i = 0; i < g.items.length; i++) {
      if (checked[keyOf(diag.id, gIdx, i)]) n++;
    }
    return { count: n, min: g.min, met: n >= g.min, ratio: Math.min(1, n / g.min) };
  }

  // 진단 하나의 종합 채점.
  //   groupLogic 'AND' — 모든 항목군을 충족해야 하고, 진행률은 가장 뒤처진 군을 따른다
  //   groupLogic 'OR'  — 한 항목군만 충족해도 되고, 진행률은 가장 앞선 군을 따른다
  //   anyChecked       — 하나라도 체크됐는지(결과 목록에 띄울지 판단용)
  // DSM에는 "개수"만이 아니라 "그중 특정 항목이 반드시 포함되어야 한다"는 조건이
  // 있다 — 주요우울장애는 우울 기분 또는 흥미상실 중 1개, 조현병은 망상·환각·
  // 와해된 언어 중 1개. 개수만 세면 그런 핵심 증상 없이도 기준 충족이 떠서
  // DSM이 인정하지 않는 결과가 나온다(2026-08-16 교차 확인으로 발견).
  // 해당 진단의 data.js에 requiredAny로 적혀 있고, 여기서 함께 판정한다.
  function requiredMissing(diag, checked) {
    if (!diag.requiredAny || !diag.requiredAny.length) return [];
    return diag.requiredAny.filter(function (req) {
      var n = 0;
      req.indexes.forEach(function (i) {
        if (checked[keyOf(diag.id, req.group, i)]) n++;
      });
      return n < (req.min || 1);
    }).map(function (req) { return req.label; });
  }

  function diagnosisScore(diag, checked) {
    var groupResults = diag.groups.map(function (g, idx) {
      return groupSatisfied(diag, idx, checked);
    });
    var met = diag.groupLogic === 'OR'
      ? groupResults.some(function (r) { return r.met; })
      : groupResults.every(function (r) { return r.met; });

    // 필수 포함 조건을 못 채우면 개수를 채웠더라도 충족이 아니다.
    var missing = requiredMissing(diag, checked);
    if (missing.length) met = false;
    var ratios = groupResults.map(function (r) { return r.ratio; });
    var ratio = diag.groupLogic === 'OR'
      ? Math.max.apply(null, ratios)
      : Math.min.apply(null, ratios);
    var anyChecked = groupResults.some(function (r) { return r.count > 0; });
    return {
      met: met, ratio: ratio, groupResults: groupResults, anyChecked: anyChecked,
      requiredMissing: missing,   // 비어 있지 않으면 "핵심 증상 미포함"
    };
  }

  // 진단 목록을 결과 패널용으로 정렬한다. 체크가 하나도 없는 진단은 제외.
  //
  // 규칙: ① 기준을 충족한 것 먼저 ② 체크된 항목이 많은 순 ③ 충족 비율 높은 순
  //
  // ②가 있는 이유: 처음에는 ①③만 썼는데, 그러면 **요구 항목이 적은 진단이
  // 부당하게 앞선다.** 망상장애는 항목 1개만 체크해도 100% 충족이라 1위가 되고,
  // 9개 중 5개를 체크해야 충족되는 주요우울장애가 뒤로 밀린다(2026-08-16 실측).
  // 상담자가 실제로 많이 확인한 진단이 앞에 오는 편이 임상 직관에 맞고,
  // 정량 질문을 상위 몇 개에만 던지는 구조에서 특히 중요하다.
  function rankDiagnoses(diagnoses, checked) {
    return diagnoses
      .map(function (d) {
        var s = diagnosisScore(d, checked);
        var n = 0;
        s.groupResults.forEach(function (r) { n += r.count; });
        s.checkedCount = n;
        return { d: d, s: s };
      })
      .filter(function (x) { return x.s.anyChecked; })
      .sort(function (a, b) {
        return (b.s.met - a.s.met)
          || (b.s.checkedCount - a.s.checkedCount)
          || (b.s.ratio - a.s.ratio);
      });
  }

  var api = {
    keyOf: keyOf,
    groupSatisfied: groupSatisfied,
    requiredMissing: requiredMissing,
    diagnosisScore: diagnosisScore,
    rankDiagnoses: rankDiagnoses,
  };

  // 브라우저에서는 전역(window.HututiScoring), node 테스트에서는 module.exports로
  // 같은 객체를 노출한다 — 동치 테스트를 브라우저 없이 돌리기 위함.
  root.HututiScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
