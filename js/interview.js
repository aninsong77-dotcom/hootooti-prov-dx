/* ==========================================================================
   interview.js — 알고리즘 문답 화면 (메인)

   화면 틀은 chat.html의 대화 레이아웃을 그대로 쓰되, 말을 지어내는 AI 대신
   **알고리즘이 정해진 질문을 말풍선으로 던진다.** 상담자는 타이핑 대신 버튼을
   누르고, 답한 말풍선은 위에 쌓여 지나온 판단을 그대로 되짚을 수 있다.

   흐름: 소견 입력(선택) → 게이트 23문항 → 정밀 체크리스트 → 정량 질문(기간·연령·
         빈도·기능손상) → AI 설명 1회

   설계 = docsPlan/quantified-criteria/{requirements,structure}.md
   앞 트랙의 위저드 화면(js/wizard.js)을 대체한다. 로직(scoring·gates·criteria)은
   그대로 재사용하고 화면만 바뀐 것이다.

   AI는 맨 마지막 1회만 부른다. 대화가 누적되지 않으므로 프롬프트가 커질 구조
   자체가 없고, 과거 채팅 방식이 겪던 (ABORT) 크래시가 발생하지 않는다.

   일반 스크립트(비-module)다 — 파일을 직접 열어도(file://) 동작해야 하기 때문.
   그 환경에서는 window.__hututiInterviewAI가 없고, AI 단계만 건너뛴다.

   의존(먼저 로드돼야 함): data.js · scoring.js · gates.js · criteria.js ·
                          criteria-engine.js
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'hututi.interview.v1';

  var S = null;   // 상태
  var el = {};
  var coverageGaps = null;   // 문항이 81개 진단을 모두 덮는지 (브릿지로 노출)

  // AI가 답을 만드는 동안의 상태. 토큰이 오는 대로 화면에 흘려 넣어 "살아 있음"을
  // 보이고, 그동안 입력창을 잠가 사용자의 질문이 조용히 버려지지 않게 한다
  // (2026-08-16 "멈춘 것처럼 보이고 이후 대꾸가 없다" 보고 대응).
  var stream = null;         // { kind:'explain'|'ask', text:'' }
  var streamNode = null;     // 부분 응답을 직접 갱신할 DOM 노드

  var ANSWER_KR = { yes: '예', no: '아니오', unknown: '확인 안 됨' };

  // AI에 넘길 후보 수 상한 (structure.md §3.3 프롬프트 크기 상한)
  var MAX_CANDIDATES = 5;
  // 기간·빈도 등을 실제로 물어볼 후보 수. 후보마다 2~3개씩 물으므로 5개면 입력이
  // 최대 15개까지 늘어 체감이 크게 길어진다. 3개로 줄여 6~9개로 줄인다.
  // 여기서 빠진 후보도 목록에는 그대로 남고 "미확인"으로 표시되므로, 상담자가
  // 필요하면 순위를 올린 뒤(체크를 더 하면) 다시 물을 수 있다.
  var MAX_PARAM_CANDIDATES = 3;

  /* ---------------------------------------------------------------- 상태 */

  // 소견을 나눠 받는 다섯 갈래. 상담자가 면담을 이 구조로 진행하게 돕고,
  // 동시에 어느 영역을 정성껏 물어야 할지 가르는 신호가 된다.
  var NOTE_FIELDS = [
    { key: 'thought', kr: '생각', hint: '예) 자꾸 최악을 떠올림, 집중이 안 됨' },
    { key: 'behavior', kr: '행동', hint: '예) 외출을 피함, 확인을 반복함' },
    { key: 'feeling', kr: '감정', hint: '예) 가라앉아 있음, 사소한 일에 화가 남' },
    { key: 'belief', kr: '신념·경험', hint: '예) 자신이 무가치하다고 여김, 누가 감시한다고 느낌' },
    { key: 'somatic', kr: '신체', hint: '예) 잠을 못 잠, 입맛이 없음, 자주 피로함' },
  ];

  function blank() {
    return {
      phase: 'notes',          // notes | gates | quick | checklist | params | done
      notes: '',               // 다섯 칸을 합친 텍스트 (정렬·저장용)
      notesByCat: {},          // { thought, behavior, feeling, belief, somatic }
      order: null,             // 정성껏 묻는 문항 순서 (focus)
      quickOrder: null,        // 빠른 확인 목록 문항
      ranking: null,           // 키워드 정렬 근거
      idx: 0,
      answers: {},             // { gateId: yes|no|unknown }
      checked: {},             // { 'diagId::g::i': true }
      common: {},              // { age, onsetAge }
      params: {},              // { diagId: { duration, frequency, impairment, dailyTime, exceptions } }
      paramQueue: [],
      paramIdx: 0,
      aiText: '',
      followUp: [],            // 문답 종료 후 AI와 오간 추가 대화 [{role,text}]
    };
  }

  function save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 실패해도 진행은 막지 않는다 */ }
  }
  function load() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.phase) ? s : null;
    } catch (e) { return null; }
  }
  function clearSaved() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  /* ------------------------------------------------------------ 공통 도우미 */

  function esc(s) {
    return String(s == null ? '' : s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
  }
  function attr(s) { return esc(s).split('"').join('&quot;'); }
  function findDiag(id) {
    for (var i = 0; i < DIAGNOSES.length; i++) if (DIAGNOSES[i].id === id) return DIAGNOSES[i];
    return null;
  }
  function gateById(id) {
    for (var i = 0; i < HututiGates.GATES.length; i++) if (HututiGates.GATES[i].id === id) return HututiGates.GATES[i];
    return null;
  }

  // 게이트 답변 → 확인 대상 / 후순위 진단
  //
  // **답하지 않은 문항은 "아니오"가 아니라 "확인 안 됨"으로 본다.** 빠른 확인
  // 목록을 훑고 그냥 넘어간 경우가 여기 해당한다 — 안 물어본 것을 없는 것으로
  // 처리하면 그 진단이 조용히 사라진다. 목록을 실제로 줄이려면 상담자가
  // "모두 해당 없음"을 눌러 명시적으로 아니오를 표시해야 한다.
  function partition() {
    var inc = {};
    HututiGates.GATES.forEach(function (g) {
      var a = S.answers[g.id];
      if (a === undefined || a === null) a = 'unknown';
      if (a === 'yes' || a === 'unknown') {
        HututiGates.resolveDiagIds(g, DIAGNOSES).forEach(function (id) { inc[id] = true; });
      }
    });
    var included = [], deferred = [];
    DIAGNOSES.forEach(function (d) { (inc[d.id] ? included : deferred).push(d); });
    return { included: included, deferred: deferred };
  }

  function countItems(d) {
    var total = 0, done = 0;
    d.groups.forEach(function (g, gi) {
      g.items.forEach(function (_, ii) {
        total++;
        if (S.checked[HututiScoring.keyOf(d.id, gi, ii)]) done++;
      });
    });
    return { total: total, done: done, unknown: total - done };
  }

  // 정량 판정에 넘길 입력 (공통 연령 + 진단별 값)
  function inputFor(diagId) {
    var p = S.params[diagId] || {};
    return {
      age: S.common.age,
      onsetAge: S.common.onsetAge,
      met: p.met || {},
      impairment: p.impairment,
      confirmations: p.confirmations || {},
      exceptions: p.exceptions || {},
    };
  }

  function evaluateFor(diagId) {
    return HututiCriteriaEngine.evaluate(HututiCriteria.get(diagId), inputFor(diagId));
  }

  // 지금까지의 입력을 한 줄로 요약한 지문. AI 요약을 만든 시점의 지문과 다르면
  // 그 요약은 낡은 것이다(체크를 고쳤는데 예전 설명이 그대로 남아 오해를 부른다).
  function fingerprint() {
    return [
      Object.keys(S.checked).sort().join(','),
      JSON.stringify(S.answers),
      JSON.stringify(S.params),
      JSON.stringify(S.common),
    ].join('|');
  }

  // 증상 채점 상위 후보
  function ranked() {
    return HututiScoring.rankDiagnoses(DIAGNOSES, S.checked);
  }

  /* ------------------------------------------------------------- 말풍선 렌더 */

  // 대화 전체를 상태로부터 다시 그린다. 새로고침 복원과 되돌아가기가 같은 경로를
  // 타므로 화면과 상태가 어긋날 수 없다.
  function render() {
    var h = [];

    h.push(notesBubble());

    if (S.phase !== 'notes') {
      h.push(notesEchoBubble());
      h.push(orderNoticeBubble());
    }

    if (S.order) h.push(gateBubbles());
    if (S.phase === 'quick' || S.phase === 'checklist' || S.phase === 'params' || S.phase === 'done') {
      h.push(quickBubble());
    }
    if (S.phase === 'checklist' || S.phase === 'params' || S.phase === 'done') h.push(checklistBubble());
    if (S.phase === 'params' || S.phase === 'done') h.push(paramBubbles());
    if (S.phase === 'done') { h.push(doneBubble()); h.push(followUpBubbles()); h.push(streamBubble()); }

    // 다시 그리기 전에 보던 위치를 기억한다. 맨 아래를 보고 있었으면 새 말풍선을
    // 따라가고, 위쪽에서 뭔가 고치는 중이었으면 그 자리를 지킨다 — 무조건 맨
    // 아래로 보내면 체크하다가 화면이 튀어 다시 찾아야 한다(2026-08-16 보고).
    var wasAtBottom = (el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight) < 60;
    var prevScroll = el.messages.scrollTop;

    el.messages.innerHTML = h.join('');
    bindMessageEvents();
    renderResults();
    syncInputBar();
    save();

    el.messages.scrollTop = wasAtBottom ? el.messages.scrollHeight : prevScroll;
  }

  function bubbleAssistant(inner, extraClass) {
    return '<div class="chat-message assistant ' + (extraClass || '') + '">' + inner + '</div>';
  }
  function bubbleUser(text) {
    return '<div class="chat-message user">' + esc(text) + '</div>';
  }

  // 소견을 다섯 갈래로 나눠 받는다. 나눠 적으면 상담자가 면담에서 빠뜨리는
  // 영역이 줄고, 어느 문항을 정성껏 물어야 할지 가르는 신호도 좋아진다.
  function notesBubble() {
    var body = '<div class="bubble-q">내담자에 대해 관찰하거나 보고받은 내용을 <b>상담자님 판단으로</b> 적어 주세요.</div>' +
      '<div class="bubble-covers">갈래를 나눠 적으면 관련된 문항을 먼저 자세히 여쭙고, ' +
      '나머지는 목록으로 묶어 빠르게 훑도록 해 드립니다. <b>비워두셔도 됩니다</b> — ' +
      '적지 않은 영역도 사라지지 않고 확인 목록에 남습니다.</div>';

    if (S.phase === 'notes') {
      body += '<div class="bubble-fields">';
      NOTE_FIELDS.forEach(function (f) {
        body += '<div class="note-field"><label class="note-label t-' + f.key + '">' + f.kr + '</label>' +
          '<textarea class="note-input" data-note="' + f.key + '" rows="1" placeholder="' + attr(f.hint) + '">' +
          esc((S.notesByCat || {})[f.key] || '') + '</textarea></div>';
      });
      body += '</div>';
      body += '<div class="bubble-actions">' +
        '<button type="button" class="btn btn-primary" data-act="start-notes">이 소견으로 문진 시작</button>' +
        '<button type="button" class="btn" data-act="start-blank">소견 없이 시작</button></div>';
    }
    return bubbleAssistant(body, 'bubble-notes');
  }

  function notesEchoBubble() {
    var lines = [];
    NOTE_FIELDS.forEach(function (f) {
      var v = (S.notesByCat || {})[f.key];
      if (v && v.trim()) lines.push('<b>' + f.kr + '</b> ' + esc(v.trim()));
    });
    if (!lines.length) return bubbleUser('(소견 없이 시작)');
    return '<div class="chat-message user note-echo">' + lines.join('<br>') + '</div>';
  }

  function orderNoticeBubble() {
    if (!S.notes || !S.notes.trim()) return '';
    var hit = (S.ranking || []).filter(function (r) { return r.hits.length; });
    if (!hit.length) {
      return bubbleAssistant('소견에서 특정 영역을 가리키는 표현을 찾지 못했습니다. ' +
        '문항을 <b>기본 순서로 모두</b> 여쭙겠습니다.', 'bubble-note');
    }
    var parts = hit.slice(0, 5).map(function (r) {
      return '<b>' + esc(gateById(r.gateId).label) + '</b>(' + esc(r.hits.join('·')) + ')';
    });
    return bubbleAssistant('소견에서 ' + parts.join(', ') + ' 관련 표현을 찾았습니다. ' +
      '이 영역 <b>' + (S.order ? S.order.length : 0) + '문항</b>을 먼저 자세히 여쭙고, ' +
      '나머지 <b>' + (S.quickOrder ? S.quickOrder.length : 0) + '문항</b>은 뒤에서 목록으로 묶어 빠르게 확인합니다. ' +
      '<button type="button" class="linklike" data-act="reset-order">전부 하나씩 묻기</button>', 'bubble-note');
  }

  // 소견에 걸리지 않은 영역. 없애지 않고 한 말풍선에 모아 빠르게 훑게 한다.
  // 답하지 않고 넘어간 문항은 "확인 안 됨"으로 남아 진단이 사라지지 않는다.
  // 목록을 실제로 줄이려면 "모두 해당 없음"을 눌러 명시적으로 표시해야 한다.
  function quickBubble() {
    if (!S.quickOrder || !S.quickOrder.length) return '';
    var isCurrent = S.phase === 'quick';

    var body = '<div class="bubble-q">소견에서 언급되지 않은 영역입니다. 해당하는 것이 있는지만 빠르게 확인해 주세요.</div>' +
      '<div class="bubble-covers">답하지 않고 넘어가면 <b>“확인 안 됨”</b>으로 남아 확인 목록에 그대로 포함됩니다. ' +
      '해당 사항이 없다고 판단하시면 아래 버튼으로 한 번에 표시하실 수 있습니다.</div>';

    body += '<div class="quick-list">';
    S.quickOrder.forEach(function (gid) {
      var g = gateById(gid);
      var a = S.answers[gid];
      body += '<div class="quick-row"><div class="quick-label">' +
        '<span class="wizard-chip">' + esc(g.label) + '</span>' +
        '<span class="quick-q">' + esc(g.question) + '</span></div>' +
        '<div class="quick-btns">' +
        ['yes', 'no', 'unknown'].map(function (v) {
          return '<button type="button" class="btn btn-compact btn-choice' + (a === v ? ' is-picked' : '') + '"' +
            (isCurrent ? '' : ' disabled') +
            ' data-act="answer-quick" data-gate="' + attr(gid) + '" data-val="' + v + '">' + ANSWER_KR[v] + '</button>';
        }).join('') + '</div></div>';
    });
    body += '</div>';

    if (isCurrent) {
      var unanswered = S.quickOrder.filter(function (gid) { return !S.answers[gid]; }).length;
      body += '<div class="bubble-actions">' +
        '<button type="button" class="btn" data-act="quick-all-no">여기 있는 항목 모두 해당 없음</button>' +
        '<button type="button" class="btn btn-primary" data-act="quick-done">확인을 마쳤습니다 — 다음 단계로</button>' +
        (unanswered ? '<span class="wizard-note">미응답 ' + unanswered + '개는 “확인 안 됨”으로 처리됩니다.</span>' : '') +
        '</div>';
    }
    return bubbleAssistant(body, 'bubble-quick');
  }

  // 게이트: 답한 문항은 선택 결과를 단 채로 남고, 현재 문항만 버튼이 활성화된다.
  function gateBubbles() {
    var out = [];
    for (var i = 0; i < S.order.length; i++) {
      if (i > S.idx) break;                       // 아직 도달하지 않은 문항은 그리지 않는다
      var g = gateById(S.order[i]);
      var answered = S.answers[g.id];
      var isCurrent = (i === S.idx) && S.phase === 'gates';

      var covers = HututiGates.resolveDiagIds(g, DIAGNOSES).map(function (id) {
        var d = findDiag(id); return d ? d.name_kr : id;
      });

      var body = '<div class="bubble-head"><span class="bubble-step">' + (i + 1) + ' / ' + S.order.length + '</span>' +
        '<span class="wizard-chip">' + esc(g.label) + '</span></div>' +
        '<div class="bubble-q">' + esc(g.question) + '</div>' +
        '<div class="bubble-covers">해당하면 확인할 진단 ' + covers.length + '개 — ' + esc(covers.join(', ')) + '</div>';

      body += '<div class="bubble-answers">' +
        ['yes', 'no', 'unknown'].map(function (v) {
          var on = answered === v ? ' is-picked' : '';
          var dis = isCurrent ? '' : ' disabled';
          return '<button type="button" class="btn btn-answer btn-answer-' + v + on + '"' + dis +
            ' data-act="answer" data-gate="' + attr(g.id) + '" data-val="' + v + '">' + ANSWER_KR[v] + '</button>';
        }).join('') + '</div>';

      if (isCurrent) {
        body += '<div class="bubble-foot"><span>“확인 안 됨”은 “아니오”와 다르게 처리됩니다 — 확인하지 못한 영역은 뒤에서 그대로 확인 대상이 됩니다.</span>';
        if (i > 0) body += ' <button type="button" class="linklike" data-act="back">← 이전 문항 고치기</button>';
        body += '</div>';
        // 마지막 focus 문항이면 다음에 무엇이 오는지 알려준다
        if (i === S.order.length - 1 && S.quickOrder && S.quickOrder.length) {
          body += '<div class="bubble-covers">답하시면 나머지 ' + S.quickOrder.length + '개 영역을 목록으로 묶어 빠르게 확인합니다.</div>';
        }
      } else if (answered) {
        body += '<div class="bubble-foot"><button type="button" class="linklike" data-act="goto" data-idx="' + i + '">이 문항으로 돌아가 고치기</button></div>';
      }

      out.push(bubbleAssistant(body, 'bubble-gate'));
    }
    return out.join('');
  }

  // 정밀 체크리스트를 말풍선 안에 넣는다.
  function checklistBubble() {
    var part = partition();
    var yes = 0, unk = 0;
    HututiGates.GATES.forEach(function (g) {
      var a = S.answers[g.id];
      if (a === 'yes') yes++;
      else if (a === 'unknown' || a === undefined || a === null) unk++;   // 무응답도 미확인
    });

    var body = '<div class="bubble-q">문항 응답을 반영해 확인이 필요한 진단을 골랐습니다. 해당하는 증상 항목에 체크해 주세요.</div>' +
      '<div class="bubble-covers">“예” ' + yes + '개 · “확인 안 됨” ' + unk + '개 → 확인 대상 <b>' + part.included.length + '</b>개 진단. ' +
      '체크하지 않은 항목은 “증상 없음”이 아니라 <b>미확인</b>으로 다룹니다.</div>';

    body += '<div class="bubble-checklist">' +
      (part.included.length ? categoryBlocks(part.included, true)
        : '<p class="wizard-empty">“예” 또는 “확인 안 됨”으로 답한 문항이 없습니다. 아래에서 직접 펼쳐 확인해 주세요.</p>') +
      '</div>';

    body += '<div class="bubble-foot">' +
      '<button type="button" class="linklike" data-act="toggle-deferred">“아니오”로 답한 진단 ' + part.deferred.length + '개도 확인하기 ▾</button>' +
      '<div class="bubble-deferred" data-deferred hidden>' +
      '<p class="wizard-note">문항 하나로 진단을 완전히 배제하지 않기 위해 지우지 않고 남겨두었습니다.</p>' +
      categoryBlocks(part.deferred, false) + '</div></div>';

    if (S.phase === 'checklist') {
      body += '<div class="bubble-actions"><button type="button" class="btn btn-primary" data-act="to-params">체크를 마쳤습니다 — 다음 단계로</button></div>';
    }
    return bubbleAssistant(body, 'bubble-checklist-wrap');
  }

  function categoryBlocks(list, open) {
    var byCat = {};
    list.forEach(function (d) { (byCat[d.category] = byCat[d.category] || []).push(d); });
    return Object.keys(byCat).map(function (cat) {
      var ds = byCat[cat];
      return '<section class="category' + (open ? ' open' : '') + '">' +
        '<div class="category-header" data-act="toggle-cat"><div class="category-title-row">' +
        '<span class="category-title">' + esc(cat) + '</span>' +
        '<span class="category-count">' + ds.length + '개 진단</span></div>' +
        '<svg class="category-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<div class="category-body">' + ds.map(diagnosisCard).join('') + '</div></section>';
    }).join('');
  }

  function diagnosisCard(d) {
    var groups = d.groups.map(function (g, gi) {
      var items = g.items.map(function (it, ii) {
        var key = HututiScoring.keyOf(d.id, gi, ii);
        var id = 'chk-' + key.split('::').join('-');
        var on = !!S.checked[key];
        // 항목에는 갈래 표시를 붙이지 않는다. 생각·행동·감정·신념·신체 구분은
        // **맨 처음 소견을 나눠 적게 하는 용도**로만 쓴다(사용자 결정 2026-08-16) —
        // 체크 단계에서는 항목 문구만 읽고 판단하는 편이 방해가 적다.
        return '<label class="item' + (on ? ' checked' : '') + '" for="' + id + '">' +
          '<input type="checkbox" id="' + id + '" data-act="check" data-diag="' + attr(d.id) + '" data-g="' + gi + '" data-i="' + ii + '"' +
          (on ? ' checked' : '') + '><span>' + esc(it) + '</span></label>';
      }).join('');
      var lab = g.label ? g.label : (d.groups.length > 1 ? ('항목군 ' + (gi + 1)) : '증상 항목');
      return '<div class="group"><div class="group-label">' + esc(lab) +
        ' <span class="group-progress" data-progress="' + attr(d.id) + ':' + gi + '">(0/' + g.min + ' 이상 필요)</span></div>' +
        items + '</div>';
    }).join(d.groupLogic === 'OR' ? '<div class="group-or-sep">— 또는 —</div>' : '');

    return '<article class="diagnosis" data-diag-id="' + attr(d.id) + '">' +
      '<div class="diagnosis-head"><div class="diagnosis-name">' + esc(d.name_kr) +
      '<span class="diagnosis-name-en">' + esc(d.name_en) + '</span></div>' +
      '<span class="badge badge-partial" data-badge="' + attr(d.id) + '">미충족</span></div>' +
      groups +
      '<div class="diagnosis-meta"><div><b>기간 기준</b> ' + esc(d.duration) + '</div>' +
      (d.other ? '<div><b>추가 확인사항</b> ' + esc(d.other) + '</div>' : '') + '</div></article>';
  }

  /* --------------------------------------------------- 정량 질문 (기간·연령 등) */

  // 상위 후보 중 계산 가능한 축이 있는 진단만 묻는다. 81개를 다 물으면 문항이 폭발한다.
  function buildParamQueue() {
    return ranked().slice(0, MAX_PARAM_CANDIDATES)
      .filter(function (x) { return HututiCriteria.hasComputableAxis(HututiCriteria.get(x.d.id)); })
      .map(function (x) { return x.d.id; });
  }

  // 연령을 묻는 후보가 하나라도 있으면 공통 질문을 먼저 낸다.
  function needsAge() {
    return S.paramQueue.some(function (id) {
      var c = HututiCriteria.get(id);
      if (!c) return false;
      if (c.age && c.age.kind === 'diagnosis') return true;
      if (c.duration && c.duration.minIfUnder) return true;
      return false;
    });
  }
  function needsOnsetAge() {
    return S.paramQueue.some(function (id) {
      var c = HututiCriteria.get(id);
      return !!(c && c.age && c.age.kind === 'onset');
    });
  }

  function paramBubbles() {
    var out = [];

    // 공통: 연령
    var askAge = needsAge(), askOnset = needsOnsetAge();
    if (askAge || askOnset) {
      var done = (!askAge || S.common.age != null) && (!askOnset || S.common.onsetAge != null);
      var body = '<div class="bubble-q">내담자 연령을 알려주세요. 진단마다 기준이 달라지는 경우가 있어 한 번만 여쭙습니다.</div><div class="bubble-fields">';
      if (askAge) body += fieldNumber('age', '현재 연령(만 나이)', '세', S.common.age);
      if (askOnset) body += fieldNumber('onsetAge', '증상이 처음 나타난 나이', '세', S.common.onsetAge);
      body += '</div>';
      if (!done) body += '<div class="bubble-actions"><button type="button" class="btn btn-primary" data-act="save-common">저장</button>' +
        '<button type="button" class="btn" data-act="skip-common">모르겠습니다 — 건너뛰기</button></div>';
      else body += '<div class="bubble-foot"><button type="button" class="linklike" data-act="edit-common">고치기</button></div>';
      out.push(bubbleAssistant(body, 'bubble-param'));
      if (!done && !S.common._skipped) return out.join('');   // 연령을 먼저 받는다
    }

    for (var i = 0; i < S.paramQueue.length; i++) {
      if (i > S.paramIdx) break;
      out.push(paramBubbleFor(S.paramQueue[i], i));
    }
    return out.join('');
  }

  function fieldNumber(name, label, unit, value) {
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<span class="field-input"><input type="number" min="0" step="1" data-field="' + name + '" value="' +
      (value == null ? '' : attr(value)) + '"><span class="field-unit">' + esc(unit) + '</span></span></label>';
  }

  function paramBubbleFor(diagId, i) {
    var d = findDiag(diagId);
    var c = HututiCriteria.get(diagId);
    var res = evaluateFor(diagId);
    var isCurrent = (i === S.paramIdx) && S.phase === 'params';
    var p = S.params[diagId] || {};

    var body = '<div class="bubble-head"><span class="bubble-step">' + (i + 1) + ' / ' + S.paramQueue.length + '</span>' +
      '<span class="wizard-chip">' + esc(d.name_kr) + '</span></div>' +
      '<div class="bubble-q">‘' + esc(d.name_kr) + '’ 판정을 위해 확인이 필요한 항목입니다.</div>' +
      '<div class="bubble-covers">기준 원문 — ' + esc(c.source.duration || '(기간 규정 없음)') + '</div>';

    if (isCurrent) {
      // 기준을 문장으로 보여주고 예/아니오를 받는다. 숫자·단위 입력을 없앤 이유는
      // criteria-engine.js 파일 주석 참고(입력 부담 + 단위 경계 판정 불가).
      // 질문 문장은 엔진이 규칙에서 조립해 주므로 여기서 만들지 않는다.
      body += '<div class="bubble-fields">';
      var ax = res.axes;

      ['duration', 'frequency', 'dailyTime'].forEach(function (k) {
        var a = ax[k];
        if (!a || a.status === 'NA' || a.status === 'QUALITATIVE') return;
        var cur = (p.met || {})[k];
        body += yesNoRow(HututiCriteriaEngine.AXIS_KR[k], a.question || a.need, 'pick-met',
          { axis: k }, cur);
      });

      if (ax.impairment && ax.impairment.status !== 'NA') {
        body += yesNoRow(HututiCriteriaEngine.AXIS_KR.impairment,
          ax.impairment.question || ax.impairment.need, 'pick-impairment', {}, p.impairment);
      }

      // 예/아니오로 답하는 진단기준 조건. 안내 문구로만 두면 읽고 넘기게 되므로
      // 실제로 답을 받아 판정에 넣는다.
      if (c.confirmations && c.confirmations.length) {
        c.confirmations.forEach(function (cf) {
          body += yesNoRow('추가 조건', cf.text, 'pick-confirm', { cid: cf.id },
            (p.confirmations || {})[cf.id]);
        });
      }

      if (c.exceptions) {
        c.exceptions.forEach(function (e) {
          var on = p.exceptions && p.exceptions[e.id];
          body += '<div class="field-row"><label class="item' + (on ? ' checked' : '') + '">' +
            '<input type="checkbox" data-act="pick-exception" data-exc="' + attr(e.id) + '"' + (on ? ' checked' : '') + '>' +
            '<span>' + esc(e.label) + '</span></label></div>';
        });
      }
      body += '</div>';
      body += '<div class="bubble-actions"><button type="button" class="btn btn-primary" data-act="save-param" data-diag="' + attr(diagId) + '">저장하고 다음</button>' +
        '<button type="button" class="btn" data-act="skip-param">모르겠습니다 — 건너뛰기</button></div>';
    } else {
      body += axisSummary(res);
      body += '<div class="bubble-foot"><button type="button" class="linklike" data-act="goto-param" data-idx="' + i + '">이 항목 고치기</button></div>';
    }

    if (res.notes && res.notes.length) {
      body += '<div class="bubble-notes"><b>직접 확인할 것</b><ul>' +
        res.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    }
    return bubbleAssistant(body, 'bubble-param');
  }

  // 기준 한 줄 = 질문 + [예][아니오][확인 안 됨]. 세 축이 모두 같은 모양이라
  // 상담자가 형태를 한 번만 익히면 된다.
  function yesNoRow(kindLabel, question, act, data, cur) {
    var attrs = Object.keys(data || {}).map(function (k) {
      return ' data-' + k + '="' + attr(data[k]) + '"';
    }).join('');
    var btn = function (val, text, on) {
      return '<button type="button" class="btn btn-compact btn-choice' + (on ? ' is-picked' : '') +
        '" data-act="' + act + '"' + attrs + ' data-val="' + val + '">' + text + '</button>';
    };
    return '<div class="field-row">' +
      '<span class="field-label"><em>' + esc(kindLabel) + '</em> ' + esc(question) + '</span>' +
      '<span class="field-input">' +
      btn('true', '예', cur === true) +
      btn('false', '아니오', cur === false) +
      btn('unknown', '확인 안 됨', cur === undefined) +
      '</span></div>';
  }

  function axisSummary(res) {
    var K = HututiCriteriaEngine.AXIS_KR, T = HututiCriteriaEngine.STATUS_KR;
    var rows = Object.keys(res.axes).filter(function (k) { return res.axes[k].status !== 'NA'; });
    if (!rows.length) return '<div class="bubble-covers">자동으로 판정할 수 있는 항목이 없습니다.</div>';
    return '<div class="axis-list">' + rows.map(function (k) {
      var a = res.axes[k];
      return '<div class="axis-row"><span class="axis-name">' + K[k] + '</span>' +
        '<span class="axis-badge s-' + a.status + '">' + T[a.status] + '</span>' +
        '<span class="axis-reason">' + esc(a.reason || a.need || '') + '</span></div>';
    }).join('') + '</div>';
  }

  function doneBubble() {
    var body = '<div class="bubble-q">문답이 끝났습니다. 오른쪽에 정리된 결과를 확인해 주세요.</div>' +
      '<div class="bubble-covers">이 결과는 <b>가진단(참고용 후보)</b>이며 실제 진단이 아닙니다. ' +
      '최종 판단은 자격을 갖춘 임상가의 면담·병력·감별진단을 통해 내려야 합니다.</div>';

    if (S.aiError) {
      body += '<div class="bubble-notes"><b>AI 응답 실패</b><br>' + esc(S.aiError).split('\n').join('<br>') + '</div>';
    }
    // 체크나 응답을 고친 뒤에도 기간·빈도를 다시 물어볼 수 있어야 한다.
    // 이 버튼이 없으면 불러오기로 이어 작업할 때 정량 판정이 예전 상태로 굳는다.
    var freshQueue = buildParamQueue();
    var queueChanged = freshQueue.join(',') !== (S.paramQueue || []).join(',');
    if (!stream) {
      body += '<div class="bubble-actions">' +
        '<button type="button" class="btn btn-compact" data-act="redo-params">기간·빈도 다시 확인하기</button>' +
        (queueChanged ? '<span class="wizard-note">체크가 바뀌어 <b>확인할 진단이 달라졌습니다.</b></span>'
          : '<span class="wizard-note">체크를 고치셨다면 눌러서 다시 확인해 주세요.</span>') +
        '</div>';
    }

    if (S.aiText) {
      var stale = S.aiStamp && S.aiStamp !== fingerprint();
      if (stale) {
        body += '<div class="bubble-notes"><b>아래 정리는 예전 내용입니다</b><br>' +
          '요약을 만든 뒤 체크나 응답이 바뀌었습니다. “다시 정리받기”를 눌러 갱신해 주세요.</div>';
      }
      body += '<div class="bubble-ai"><b>AI 정리</b>' + (stale ? ' <span class="stale-tag">갱신 필요</span>' : '') +
        (S.aiTruncated ? ' <span class="cut-tag">뒷부분 잘림</span>' : '') +
        '<div class="wizard-ai-output' + (stale ? ' is-stale' : '') + '">' + esc(S.aiText) + '</div>' +
        (S.aiTruncated ? '<p class="cut-note">분량 제한에 걸려 <b>뒷부분이 잘렸습니다.</b> “다시 정리받기”를 누르면 새로 만듭니다.</p>' : '') +
        '</div>';
      if (!stream) {
        body += '<div class="bubble-actions"><button type="button" class="btn btn-compact' + (stale ? ' btn-primary' : '') +
          '" id="ai-explain-btn" data-act="ai">다시 정리받기</button>' +
          '<span class="wizard-note">아래 입력창으로 더 물어보실 수 있습니다.</span></div>';
      }
    } else if (stream) {
      // 생성 중에는 버튼을 내려 중복 호출을 막는다(아래 스트리밍 말풍선이 상태를 보여준다).
    } else if (window.__hututiInterviewAI && window.__hututiInterviewAI.available) {
      body += '<div class="bubble-actions"><button type="button" class="btn btn-primary" id="ai-explain-btn" data-act="ai">' +
        '<span class="ai-btn-label">AI 설명 받기</span><span class="ai-btn-spinner" aria-hidden="true"></span></button>' +
        '<span class="wizard-note">확정된 결과를 문장으로 정리해 줍니다. 아래 입력창으로 더 물어보실 수도 있습니다.</span></div>';
    } else {
      // 왜 AI 기능이 없는지 화면에 분명히 밝힌다 — 입력창이 잠긴 이유가
      // 보이지 않으면 고장으로 오해한다.
      body += '<div class="bubble-notes"><b>이 환경에서는 AI 정리를 쓸 수 없습니다</b><br>' +
        '파일을 브라우저로 직접 열면(주소가 <code>file://</code>로 시작) 브라우저가 AI 관련 파일 로드를 차단합니다. ' +
        '웹 주소로 접속하시면 “AI 설명 받기” 버튼과 추가 질문 입력창이 나타납니다. ' +
        '<b>판정 결과와 결과 저장은 지금 그대로 사용하실 수 있습니다.</b></div>';
    }
    return bubbleAssistant(body, 'bubble-done');
  }

  // AI가 답을 만드는 동안 보이는 말풍선. 토큰이 오는 대로 여기 쌓인다.
  function streamBubble() {
    if (!stream) return '';
    return bubbleAssistant(
      '<div class="stream-head"><span class="stream-dot"></span>' +
      (stream.kind === 'explain' ? '결과를 정리하고 있습니다' : '답을 만들고 있습니다') +
      ' <button type="button" class="linklike" data-act="ai-cancel">취소</button></div>' +
      '<div class="wizard-ai-output" id="ai-stream">' + esc(stream.text) + '</div>',
      'bubble-stream');
  }

  // 문답이 끝난 뒤 오간 추가 대화. 여기부터는 입력창이 다시 살아난다.
  function followUpBubbles() {
    var out = [];
    (S.followUp || []).forEach(function (t) {
      out.push(t.role === 'user' ? bubbleUser(t.text) : bubbleAssistant(esc(t.text).split('\n').join('<br>')));
    });
    // 대화가 길어지면 과거 채팅이 겪던 문맥 한도 문제가 다시 생길 수 있다.
    // 넘치기 전에 미리 알린다(오래된 턴은 ai.js의 예산 가드가 걷어낸다).
    var turns = (S.followUp || []).filter(function (t) { return t.role === 'user'; }).length;
    if (turns >= 6) {
      out.push(bubbleAssistant(
        '대화가 길어지고 있습니다. 이 상태로 계속하면 오래된 대화부터 자동으로 잘려 나갑니다 — ' +
        '중요한 내용은 <b>결과 저장</b>으로 남겨두시고, 새 내담자라면 <b>처음부터 다시</b>를 눌러 주세요.',
        'bubble-note'));
    }
    return out.join('');
  }

  /* ------------------------------------------------------------ 결과 패널 */

  function renderResults() {
    // 체크리스트 배지·진행률
    DIAGNOSES.forEach(function (d) {
      var badge = el.messages.querySelector('[data-badge="' + d.id + '"]');
      if (!badge) return;
      var s = HututiScoring.diagnosisScore(d, S.checked);
      if (s.met) { badge.textContent = '기준 충족 가능성'; badge.className = 'badge badge-met'; }
      else if (s.requiredMissing && s.requiredMissing.length) {
        // 개수는 채웠는데 핵심 증상이 빠진 경우 — 이유를 밝히지 않으면 왜 충족이
        // 안 되는지 알 수 없다.
        badge.textContent = '핵심 증상 미포함';
        badge.className = 'badge badge-partial';
        badge.title = s.requiredMissing.join(', ') + ' 중 최소 1개가 필요합니다';
      } else {
        badge.textContent = s.anyChecked ? ('부분 일치 ' + Math.round(s.ratio * 100) + '%') : '미충족';
        badge.className = 'badge badge-partial';
      }
      s.groupResults.forEach(function (r, gi) {
        var p = el.messages.querySelector('[data-progress="' + d.id + ':' + gi + '"]');
        if (p) p.textContent = '(' + r.count + '/' + r.min + ' 이상 필요)';
      });
    });

    var list = ranked();
    el.resultsCount.textContent = list.filter(function (x) { return x.s.met; }).length;

    if (!list.length) {
      el.resultsList.innerHTML = '<div class="results-empty">증상 항목에 체크하면<br>결과가 여기에 표시됩니다.</div>';
      return;
    }

    var T = HututiCriteriaEngine.STATUS_KR, K = HututiCriteriaEngine.AXIS_KR;
    el.resultsList.innerHTML = list.slice(0, 25).map(function (x, i) {
      var c = countItems(x.d);
      var res = evaluateFor(x.d.id);
      var axes = Object.keys(res.axes)
        .filter(function (k) { return res.axes[k].status !== 'NA'; })
        .map(function (k) { return '<span class="axis-badge s-' + res.axes[k].status + '">' + K[k] + ' ' + T[res.axes[k].status] + '</span>'; })
        .join('');
      if (!axes && res.overall === 'QUALITATIVE') {
        axes = '<span class="axis-badge s-QUALITATIVE">기간·기타 직접 확인 필요</span>';
      }
      var reqMiss = (x.s.requiredMissing || []).length
        ? '<div class="result-req">' + esc(x.s.requiredMissing.join(', ')) + ' 중 최소 1개가 필요합니다</div>' : '';
      return '<div class="result-item ' + (x.s.met ? 'is-met' : '') + '">' +
        '<div class="result-line"><span class="result-rank">' + (i + 1) + '</span>' +
        '<span class="result-name">' + esc(x.d.name_kr) +
        '<span class="result-cat">' + esc(x.d.category) + ' · 확인 ' + c.done + '개 / 미확인 ' + c.unknown + '개</span></span>' +
        '<span class="result-score">' + (x.s.met ? '증상 충족' : Math.round(x.s.ratio * 100) + '%') + '</span></div>' + reqMiss +
        (axes ? '<div class="result-axes">' + axes + '</div>' : '') + '</div>';
    }).join('');
  }

  /* ------------------------------------------------------------ 이벤트 */

  function bindMessageEvents() {
    var root = el.messages;

    root.querySelectorAll('[data-act]').forEach(function (n) {
      var act = n.dataset.act;
      if (act === 'check') return;              // change 이벤트로 따로 처리
      if (act === 'pick-exception') return;
      n.addEventListener('click', function (e) { onAction(act, n, e); });
    });
    root.querySelectorAll('input[data-act="check"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var k = HututiScoring.keyOf(cb.dataset.diag, cb.dataset.g, cb.dataset.i);
        if (cb.checked) S.checked[k] = true; else delete S.checked[k];
        cb.closest('.item').classList.toggle('checked', cb.checked);
        if (S.phase === 'done') {
          // 문답이 끝난 뒤 체크를 고치면 AI 정리가 낡고 확인 대상도 달라진다.
          // 그 안내를 갱신하려면 다시 그려야 한다(스크롤 위치는 render가 지킨다).
          render();
        } else {
          renderResults();
          save();
        }
      });
    });
    root.querySelectorAll('input[data-act="pick-exception"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var bubble = cb.closest('.bubble-param');
        var diagId = bubble.querySelector('[data-act="save-param"]');
        if (!diagId) return;
        var id = diagId.dataset.diag;
        S.params[id] = S.params[id] || {};
        S.params[id].exceptions = S.params[id].exceptions || {};
        S.params[id].exceptions[cb.dataset.exc] = cb.checked;
        save();
      });
    });
  }

  function onAction(act, node) {
    if (act === 'start-notes' || act === 'start-blank') {
      var by = {};
      if (act === 'start-notes') {
        el.messages.querySelectorAll('textarea[data-note]').forEach(function (t) {
          by[t.dataset.note] = t.value;
        });
      }
      S.notesByCat = by;
      S.notes = NOTE_FIELDS.map(function (f) { return by[f.key] || ''; })
        .filter(function (v) { return v.trim(); }).join(' ');
      beginGates(act === 'start-notes' && !!S.notes.trim());
      return;
    }
    if (act === 'answer') {
      S.answers[node.dataset.gate] = node.dataset.val;
      if (S.idx < S.order.length - 1) S.idx++;
      else afterFocusGates();
      render();
      return;
    }
    if (act === 'answer-quick') {
      S.answers[node.dataset.gate] = node.dataset.val;
      render();
      return;
    }
    if (act === 'quick-all-no') {
      // 상담자가 명시적으로 "해당 없음"을 표시하는 행동. 조용한 배제가 아니다.
      // 그래도 "아니오"는 완전 배제가 아니라 후순위·접힘일 뿐이다.
      S.quickOrder.forEach(function (gid) { if (!S.answers[gid]) S.answers[gid] = 'no'; });
      render();
      return;
    }
    if (act === 'quick-done') { S.phase = 'checklist'; render(); return; }
    if (act === 'back') { if (S.idx > 0) S.idx--; render(); return; }
    if (act === 'goto') { S.idx = parseInt(node.dataset.idx, 10); S.phase = 'gates'; render(); return; }
    if (act === 'reset-order') { beginGates(false); return; }
    if (act === 'toggle-cat') { node.closest('.category').classList.toggle('open'); return; }
    if (act === 'toggle-deferred') {
      var box = node.parentNode.querySelector('[data-deferred]');
      box.hidden = !box.hidden;
      node.textContent = box.hidden ? node.textContent.replace('▴', '▾') : node.textContent.replace('▾', '▴');
      return;
    }
    if (act === 'to-params') {
      S.paramQueue = buildParamQueue();
      S.paramIdx = 0;
      S.phase = S.paramQueue.length ? 'params' : 'done';
      render();
      return;
    }
    if (act === 'save-common' || act === 'skip-common') {
      var bubble = node.closest('.bubble-param');
      if (act === 'save-common') {
        bubble.querySelectorAll('input[data-field]').forEach(function (inp) {
          var v = inp.value === '' ? null : Number(inp.value);
          S.common[inp.dataset.field] = (v == null || isNaN(v)) ? null : v;
        });
      }
      S.common._skipped = true;
      render();
      return;
    }
    if (act === 'edit-common') { S.common._skipped = false; render(); return; }
    if (act === 'pick-confirm') {
      var did = paramDiagOf(node);
      if (!did) return;
      S.params[did] = S.params[did] || {};
      S.params[did].confirmations = S.params[did].confirmations || {};
      var cval = node.dataset.val;
      if (cval === 'unknown') delete S.params[did].confirmations[node.dataset.cid];
      else S.params[did].confirmations[node.dataset.cid] = (cval === 'true');
      markPicked(node);
      save();
      renderResults();
      return;
    }
    // 기준 충족 여부(기간·빈도·하루 소요시간)를 예/아니오로 받는다.
    if (act === 'pick-met' || act === 'pick-impairment') {
      var pid = paramDiagOf(node);
      if (!pid) return;
      S.params[pid] = S.params[pid] || {};
      var val = node.dataset.val;
      var answer = (val === 'unknown') ? undefined : (val === 'true');
      if (act === 'pick-impairment') {
        if (answer === undefined) delete S.params[pid].impairment;
        else S.params[pid].impairment = answer;
      } else {
        S.params[pid].met = S.params[pid].met || {};
        if (answer === undefined) delete S.params[pid].met[node.dataset.axis];
        else S.params[pid].met[node.dataset.axis] = answer;
      }
      markPicked(node);
      save();
      renderResults();
      return;
    }
    if (act === 'save-param' || act === 'skip-param') {
      if (S.paramIdx < S.paramQueue.length - 1) S.paramIdx++;
      else S.phase = 'done';
      render();
      return;
    }
    if (act === 'goto-param') { S.paramIdx = parseInt(node.dataset.idx, 10); S.phase = 'params'; render(); return; }
    if (act === 'redo-params') {
      S.paramQueue = buildParamQueue();
      S.paramIdx = 0;
      S.phase = S.paramQueue.length ? 'params' : 'done';
      render();
      return;
    }
    if (act === 'ai') { runAI(); return; }
    if (act === 'ai-cancel') {
      if (window.__hututiInterviewAI && window.__hututiInterviewAI.cancel) window.__hututiInterviewAI.cancel();
      return;
    }
  }

  // 이 버튼이 어느 진단의 말풍선에 있는지
  function paramDiagOf(node) {
    var bubble = node.closest('.bubble-param');
    var save = bubble && bubble.querySelector('[data-act="save-param"]');
    return save ? save.dataset.diag : null;
  }

  function markPicked(node) {
    node.parentNode.querySelectorAll('.btn-choice').forEach(function (x) { x.classList.remove('is-picked'); });
    node.classList.add('is-picked');
  }

  // 답은 버튼을 누를 때마다 바로 저장되므로 따로 걷을 것이 없다.
  // (숫자·단위 입력창이 있던 시절의 흔적을 제거했다.)

  /* ------------------------------------------------------------ 진행 제어 */

  // 문항을 두 층으로 나눈다.
  //   focus  소견에 걸린 영역 — 하나씩 정성껏 묻는다
  //   quick  걸리지 않은 영역 — 목록으로 묶어 빠르게 훑는다(생략이 아니다)
  //
  // 소견이 없거나 아무것도 안 걸리면 전부 focus다 — 무엇이 덜 중요한지 알 수
  // 없는 상태에서 임의로 뒤로 미루면 안 되기 때문이다.
  function beginGates(useKeywords) {
    var r = HututiGates.rankGates(useKeywords ? S.notes : '', DIAGNOSES);
    S.ranking = r.map(function (x) { return { gateId: x.gate.id, hits: x.hits }; });

    var hit = r.filter(function (x) { return x.hits.length; });
    if (!useKeywords || !hit.length) {
      S.order = r.map(function (x) { return x.gate.id; });
      S.quickOrder = [];
    } else {
      S.order = hit.map(function (x) { return x.gate.id; });
      S.quickOrder = r.filter(function (x) { return !x.hits.length; }).map(function (x) { return x.gate.id; });
    }
    S.idx = 0;
    S.phase = 'gates';
    render();
  }

  // focus 문항이 끝난 뒤 갈 곳
  function afterFocusGates() {
    S.phase = (S.quickOrder && S.quickOrder.length) ? 'quick' : 'checklist';
  }

  // 입력창은 문답이 끝난 뒤에만 살아난다 — AI에게 추가로 묻는 용도다.
  // 소견은 첫 말풍선의 다섯 칸에서 받고(갈래를 나눠 받아야 하므로 한 줄 입력창으로는
  // 안 된다), 문답 중에는 버튼으로만 답한다. 문답 중에 자유 입력을 받아 AI를 부르면
  // 과거 채팅처럼 호출이 누적돼 느려지고 (ABORT)로 죽는다.
  function syncInputBar() {
    var hasAI = !!(window.__hututiInterviewAI && window.__hututiInterviewAI.available);
    var busy = !!stream;
    var canAsk = S.phase === 'done' && hasAI && !busy;
    el.input.disabled = !canAsk;
    el.send.disabled = !canAsk;

    if (busy) {
      el.input.placeholder = 'AI가 답하는 중입니다 — 끝나면 다시 입력하실 수 있습니다';
    } else if (canAsk) {
      el.input.placeholder = '결과에 대해 더 물어보실 수 있습니다 — 예) 양극성장애는 왜 후보에서 낮은가요?';
    } else if (S.phase === 'done') {
      el.input.placeholder = 'AI를 사용할 수 없는 환경입니다(파일로 직접 열었을 때). 결과는 그대로 사용하실 수 있습니다';
    } else if (S.phase === 'notes') {
      el.input.placeholder = '소견은 위 말풍선의 다섯 칸에 나눠 적어 주세요';
    } else {
      el.input.placeholder = '문항의 버튼을 눌러 답해 주세요 — 문답이 끝나면 여기서 질문하실 수 있습니다';
    }
  }

  function resetAll() {
    clearSaved();
    S = blank();
    el.input.value = '';
    render();
  }

  /* ------------------------------------------------------------ 결과 저장 */

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildReport() {
    var now = new Date(), L = [];
    var T = HututiCriteriaEngine.STATUS_KR, K = HututiCriteriaEngine.AXIS_KR;

    L.push('후투티 — 문진 결과');
    L.push('생성일시: ' + now.toLocaleString('ko-KR'));
    L.push('');
    L.push('※ 이 문서는 상담·임상 전문가가 내담자를 위해 사용하는 보조 자료이며');
    L.push('  일반인의 자가진단용이 아닙니다. 결과는 가진단(참고용 후보)일 뿐');
    L.push('  실제 진단이 아니며, 최종 판단은 자격을 갖춘 임상가가 면담·병력·');
    L.push('  감별진단을 포함한 종합적 평가를 거쳐 내려야 합니다.');
    L.push('※ 진단 기준 문구는 DSM-5-TR(APA, 2022)의 개념을 AI의 도움으로 재서술한');
    L.push('  것으로 APA 공식 문서가 아니며 임상 전문가의 검증을 거치지 않았습니다.');
    L.push('');
    L.push('----------------------------------------');
    L.push('');

    var noteLines = [];
    NOTE_FIELDS.forEach(function (f) {
      var v = (S.notesByCat || {})[f.key];
      if (v && v.trim()) noteLines.push('  ' + f.kr + ': ' + v.trim());
    });
    if (noteLines.length) { L.push('[입력한 소견]'); noteLines.forEach(function (l) { L.push(l); }); L.push(''); }

    if (S.common.age != null || S.common.onsetAge != null) {
      L.push('[내담자 정보]');
      if (S.common.age != null) L.push('  현재 연령: 만 ' + S.common.age + '세');
      if (S.common.onsetAge != null) L.push('  증상 발현 나이: ' + S.common.onsetAge + '세');
      L.push('');
    }

    L.push('[문진 응답]');
    (S.order || []).forEach(function (gid) {
      var g = gateById(gid);
      L.push('  ' + (ANSWER_KR[S.answers[gid]] || '무응답') + '\t' + g.label);
    });
    L.push('');

    L.push('[진단별 결과]');
    var list = ranked();
    if (!list.length) L.push('  체크된 증상이 없습니다.');
    list.forEach(function (x, i) {
      var c = countItems(x.d), res = evaluateFor(x.d.id);
      L.push('  ' + (i + 1) + '. [' + x.d.category + '] ' + x.d.name_kr + ' (' + x.d.name_en + ')');
      if ((x.s.requiredMissing || []).length) {
        L.push('     ※ ' + x.s.requiredMissing.join(', ') + ' 중 최소 1개가 필요합니다 (핵심 증상 미포함)');
      }
      L.push('     증상: ' + (x.s.met ? '기준 충족 가능성' : '부분 일치 ' + Math.round(x.s.ratio * 100) + '%') +
        ' — 확인 ' + c.done + '개 / 미확인 ' + c.unknown + '개 (미확인은 "증상 없음"이 아닙니다)');
      Object.keys(res.axes).forEach(function (k) {
        var a = res.axes[k];
        if (a.status === 'NA') return;
        L.push('     ' + K[k] + ': ' + T[a.status] + (a.reason ? ' — ' + a.reason : (a.need ? ' — 필요: ' + a.need : '')));
      });
      if (res.qualitativeReason) L.push('     ' + res.qualitativeReason);
      (res.notes || []).forEach(function (n) { L.push('     · 직접 확인: ' + n); });
      L.push('     기간 기준(원문): ' + x.d.duration);
      L.push('');
    });

    if (S.aiText) {
      L.push('----------------------------------------');
      L.push('');
      L.push('[AI 정리]');
      L.push(S.aiText.trim());
      L.push('');
    }
    if (S.followUp && S.followUp.length) {
      L.push('----------------------------------------');
      L.push('');
      L.push('[추가 질의응답]');
      S.followUp.forEach(function (t) {
        L.push((t.role === 'user' ? '상담자: ' : 'AI: ') + t.text.trim());
        L.push('');
      });
    }
    return L.join('\n');
  }

  /* ------------------------------------------------------------------- AI */

  function runAI() {
    if (!window.__hututiInterviewAI || !window.__hututiInterviewAI.available) return;
    window.__hututiInterviewAI.explain();
  }

  // wizard-ai를 대체하는 브릿지. 일반 스크립트인 이 파일과 module인 AI 연동 파일은
  // 서로 import할 수 없으므로 window로 연결한다(기존 __hututiEngine과 같은 패턴).
  function exposeBridge() {
    window.__hututiSession = {
      getSnapshot: function () {
        var T = HututiCriteriaEngine.STATUS_KR, K = HututiCriteriaEngine.AXIS_KR;
        return {
          notes: S.notes,
          candidates: ranked().slice(0, MAX_CANDIDATES).map(function (x) {
            var d = x.d, c = countItems(d), res = evaluateFor(d.id), ev = [];
            d.groups.forEach(function (g, gi) {
              g.items.forEach(function (it, ii) {
                if (S.checked[HututiScoring.keyOf(d.id, gi, ii)]) ev.push(it);
              });
            });
            return {
              id: d.id, name_kr: d.name_kr, name_en: d.name_en, category: d.category,
              met: x.s.met, ratio: x.s.ratio,
              checkedCount: c.done, unknownCount: c.unknown,
              evidence: ev,
              duration: d.duration, other: d.other || '',
              // 정량 판정 결과 — AI가 "무엇을 더 확인해야 하는지"까지 설명할 수 있게 한다
              criteriaOverall: T[res.overall] || res.overall,
              criteriaAxes: Object.keys(res.axes)
                .filter(function (k) { return res.axes[k].status !== 'NA'; })
                .map(function (k) { return K[k] + ': ' + T[res.axes[k].status] + (res.axes[k].reason ? ' (' + res.axes[k].reason + ')' : (res.axes[k].need ? ' (필요: ' + res.axes[k].need + ')' : '')); }),
              checkNotes: res.notes || [],
            };
          }),
        };
      },
      // ── 생성 중 화면 갱신 ────────────────────────────────────────────
      // 토큰마다 전체를 다시 그리면 무거우므로, 시작할 때 한 번만 그리고
      // 이후에는 그 노드의 텍스트만 직접 바꾼다.
      streamBegin: function (kind) {
        stream = { kind: kind, text: '' };
        S.aiError = '';
        render();
        streamNode = document.getElementById('ai-stream');
      },
      streamChunk: function (chunk) {
        if (!stream) return;
        stream.text += chunk;
        if (!streamNode) streamNode = document.getElementById('ai-stream');
        if (streamNode) {
          streamNode.textContent = stream.text;
          el.messages.scrollTop = el.messages.scrollHeight;
        }
      },
      // text가 있으면 성공, 없으면 errorText를 남긴다. 어느 쪽이든 화면을 정리한다.
      // meta: { truncated, reason, tokens } — 분량이 차서 잘렸는지 엔진이 알려준 값.
      // truncated가 true일 때만 알린다. null(판단 근거 없음)이면 아무 말도 하지
      // 않는다 — 멀쩡한 결과를 잘렸다고 하면 상담자가 공연히 의심하게 된다.
      streamEnd: function (text, errorText, meta) {
        var kind = stream ? stream.kind : null;
        var partial = stream ? stream.text : '';
        stream = null;
        streamNode = null;
        var body = text || partial || '';
        var cut = !!(meta && meta.truncated === true);
        if (kind === 'explain') {
          if (body) { S.aiText = body; S.aiStamp = fingerprint(); S.aiTruncated = cut; }
          if (errorText) S.aiError = errorText;
        } else if (kind === 'ask') {
          S.followUp = S.followUp || [];
          S.followUp.push({ role: 'assistant', text: body || errorText || '(응답 없음)', truncated: cut });
        }
        save();
        render();
      },
      // AI 연동 파일(module)이 준비되면 이걸 불러 화면을 다시 그리게 한다.
      // 그 파일은 외부 CDN에서 wllama를 받아온 뒤에야 실행되므로, 첫 렌더보다
      // 늦게 끝나는 일이 흔하다. 알려주는 통로가 없으면 입력창이 잠긴 채로,
      // "AI 설명 받기" 버튼도 없는 채로 굳는다(2026-08-16 확인).
      refresh: function () { if (S) render(); },
      coverageGaps: function () { return coverageGaps; },
      getFollowUp: function () { return (S.followUp || []).slice(); },
      pushFollowUp: function (role, text) {
        S.followUp = S.followUp || [];
        S.followUp.push({ role: role, text: text });
        save();
        render();
      },
      reset: resetAll,
    };
  }

  /* ------------------------------------------------------------------ 초기화 */

  function cache() {
    el.messages = document.getElementById('chat-messages');
    el.input = document.getElementById('chat-input');
    el.send = document.getElementById('chat-send-btn');
    el.resultsList = document.getElementById('results-list');
    el.resultsCount = document.getElementById('results-count');
  }

  function bind() {
    // 입력창은 문답 종료 후 AI 질문 전용이다(syncInputBar 주석 참고).
    function onSend() {
      if (S.phase !== 'done') return;
      var q = el.input.value.trim();
      if (!q) return;
      if (!window.__hututiInterviewAI || !window.__hututiInterviewAI.available) return;
      // 생성 중에 들어온 질문을 대화에 밀어 넣으면 답이 영영 오지 않는 말풍선이
      // 남는다. 넣지 않고 이유만 알린다.
      if (stream) {
        setSaveStatus('AI가 답하는 중입니다. 끝난 뒤에 다시 보내 주세요.', true);
        return;
      }
      el.input.value = '';
      S.followUp = S.followUp || [];
      S.followUp.push({ role: 'user', text: q });
      save();
      render();
      window.__hututiInterviewAI.ask(q);
    }

    el.send.addEventListener('click', onSend);
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });

    document.getElementById('restart-btn').addEventListener('click', function () {
      if (confirm('지금까지 입력한 내용이 모두 지워집니다. 처음부터 다시 시작할까요?')) resetAll();
    });
    document.getElementById('save-btn').addEventListener('click', saveAll);
    document.getElementById('load-session-btn').addEventListener('click', function () {
      document.getElementById('load-session-input').click();
    });
    document.getElementById('load-session-input').addEventListener('change', loadSessionFile);
  }

  /* ------------------------------------------------- 세션 저장·불러오기 (JSON) */

  // 진행 상태를 파일로 남겨 두었다가 나중에 다시 꺼내 이어서 작업할 수 있게 한다.
  //
  // **주의**: 이 파일에는 내담자의 증상 정보가 그대로 담긴다. 지금까지 이 도구는
  // 탭을 닫으면 아무것도 남지 않았는데, 저장하면 그 원칙에서 벗어나는 것이므로
  // 상담자가 스스로 판단해 보관 위치와 삭제를 관리해야 한다. 화면에도 명시한다.
  var SESSION_FORMAT = 'hututi.interview.session';
  var SESSION_VERSION = 1;

  // 같은 날 여러 건을 저장해도 덮어쓰지 않도록 시각까지 넣는다.
  function fileStem() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '후투티-문진-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function setSaveStatus(text, isError) {
    var box = document.getElementById('save-status');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || '';
    box.classList.toggle('is-error', !!isError);
  }

  function buildSessionJson() {
    return JSON.stringify({
      format: SESSION_FORMAT,
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      appNote: '후투티 문진 진행 상태입니다. 내담자 증상 정보가 담겨 있으니 보관에 주의하십시오.',
      state: S,
    }, null, 2);
  }

  // 한 번에 두 파일을 저장한다.
  //   .txt  사람이 읽는 결과 요약 (기록·공유용)
  //   .json 진행 상태 전체 (나중에 불러와 이어서 작업)
  // 둘을 따로 눌러 저장하게 하면 한쪽만 저장하고 나중에 이어할 수 없게 되는 일이
  // 생긴다. 늘 같이 남기는 편이 안전하다.
  async function saveAll() {
    var stem = fileStem();
    var files = [
      { name: stem + '.txt', body: buildReport(), type: 'text/plain' },
      { name: stem + '.json', body: buildSessionJson(), type: 'application/json' },
    ];

    // 폴더를 직접 고를 수 있으면 그렇게 한다(크롬·엣지에서 웹으로 접속한 경우).
    // 파일을 직접 열었을 때(file://)는 이 창이 응답하지 않는 것이 확인돼
    // 곧바로 내려받기로 간다(2026-08-16 실측).
    var canPickFolder = !!window.showDirectoryPicker && location.protocol !== 'file:';
    if (canPickFolder) {
      try {
        var dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        for (var i = 0; i < files.length; i++) {
          var fh = await dir.getFileHandle(files[i].name, { create: true });
          var w = await fh.createWritable();
          await w.write(files[i].body);
          await w.close();
        }
        setSaveStatus('선택하신 폴더에 저장했습니다 — ' + stem + '.txt · ' + stem + '.json');
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { setSaveStatus(''); return; }  // 사용자가 취소
        setSaveStatus('폴더에 저장하지 못해 다운로드 폴더로 대신 저장합니다.', true);
        // 아래 내려받기로 넘어간다
      }
    }

    // 폴더 선택을 못 쓰는 환경 — 브라우저 기본 다운로드 폴더로 두 개를 내려받는다.
    // 연속 다운로드라 브라우저가 "여러 파일 허용" 확인을 물을 수 있다.
    files.forEach(function (f, i) {
      setTimeout(function () { downloadText(f.body, f.name); }, i * 250);
    });
    if (!canPickFolder) {
      setSaveStatus('다운로드 폴더에 두 파일을 저장합니다 — ' + stem + '.txt · ' + stem + '.json' +
        (location.protocol === 'file:' ? ' (폴더 선택은 웹 주소로 접속했을 때 가능합니다)' : ''));
    }
  }

  function loadSessionFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                       // 같은 파일을 다시 골라도 동작하도록
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        alert('파일을 읽지 못했습니다. 후투티에서 저장한 .json 파일이 맞는지 확인해 주세요.');
        return;
      }
      if (!parsed || parsed.format !== SESSION_FORMAT || !parsed.state || !parsed.state.phase) {
        alert('후투티 문진 파일이 아닙니다.');
        return;
      }
      if (parsed.version > SESSION_VERSION) {
        alert('이 파일은 더 새로운 버전에서 저장되었습니다. 일부 내용이 열리지 않을 수 있습니다.');
      }
      var when = parsed.savedAt ? new Date(parsed.savedAt).toLocaleString('ko-KR') : '알 수 없음';
      if (!confirm('저장 시각: ' + when + '\n\n지금 진행 중인 내용을 덮어쓰고 이 파일을 불러올까요?')) return;

      S = Object.assign(blank(), parsed.state);
      save();
      render();
    };
    reader.readAsText(file, 'utf-8');
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('chat-messages') || !document.getElementById('results-list')) return;

    // 진단이 추가됐는데 문항에 안 넣으면 그 진단은 문진에서 영영 보이지 않는다.
    // 결과를 브릿지에 실어 두어(콘솔 출력 없이) 필요할 때 확인할 수 있게 한다 —
    // 평소 검증은 자동 테스트(게이트 커버리지 검사)가 담당한다.
    coverageGaps = HututiGates.findCoverageGaps(DIAGNOSES);

    cache();
    bind();
    exposeBridge();
    S = load() || blank();
    render();
  });

})();
