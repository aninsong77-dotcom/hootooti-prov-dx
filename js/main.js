/* ==========================================================================
   후투티 — 상담사를 위한 가진단 툴 — 애플리케이션 로직
   본 스크립트는 브라우저 메모리 상태만 사용하며(새로고침 시 초기화),
   서버로 어떠한 데이터도 전송하지 않습니다. 정밀 체크리스트(checklist.html)
   페이지 로직과, 소견 입력 화면의 지우기·결과 저장 버튼을 담당한다.
   AI 분석 자체는 js/ai.js·js/ai-ui.js가 담당(이 파일은 그 결과를 저장할
   때만 관여). 과거 있던 키워드 겹침 기반 "가진단 받기" 기능은 제거되었고
   (정밀 체크리스트로 직접 이동해 확인하는 방식으로 대체), 그 기능 전용
   함수(computeCandidates 등)도 함께 삭제했다.
   symptom-chat-interview 트랙(TICKET-4)에서 채팅 대화 배열
   (window.__hututiChat 브릿지) 기반으로 전환 — 소견 입력 textarea가
   사라지고 결과 저장·초기화가 대화 스냅샷을 읽는 구조로 바뀌었다.
   ========================================================================== */

(function(){
  'use strict';

  var CATEGORY_ORDER = [
    '신경발달장애',
    '조현병 스펙트럼 및 기타 정신병적 장애',
    '양극성 및 관련 장애',
    '우울장애',
    '불안장애',
    '강박 및 관련 장애',
    '외상 및 스트레스 관련 장애',
    '해리장애',
    '신체증상 및 관련 장애',
    '급식 및 섭식장애',
    '배설장애',
    '수면-각성장애',
    '성기능부전',
    '성별불쾌감',
    '파괴적, 충동조절 및 품행장애',
    '물질관련 및 중독장애',
    '신경인지장애',
    '성격장애'
  ];

  var checked = {};
  var checkedCount = 0;

  var $root, $results, $resultsCount, $checkCounter, $search;

  function keyOf(diagId, g, i){ return diagId + '::' + g + '::' + i; }
  function checkboxId(diagId, g, i){ return 'chk-' + keyOf(diagId, g, i).split('::').join('-'); }

  function groupSatisfied(diag, gIdx){
    var g = diag.groups[gIdx];
    var n = 0;
    for(var i=0;i<g.items.length;i++){ if(checked[keyOf(diag.id,gIdx,i)]) n++; }
    return { count:n, min:g.min, met: n>=g.min, ratio: Math.min(1, n/g.min) };
  }

  function diagnosisScore(diag){
    var groupResults = diag.groups.map(function(g,idx){ return groupSatisfied(diag, idx); });
    var met = diag.groupLogic === 'OR'
      ? groupResults.some(function(r){ return r.met; })
      : groupResults.every(function(r){ return r.met; });
    var ratios = groupResults.map(function(r){ return r.ratio; });
    var ratio = diag.groupLogic === 'OR' ? Math.max.apply(null, ratios) : Math.min.apply(null, ratios);
    var anyChecked = groupResults.some(function(r){ return r.count>0; });
    return { met: met, ratio: ratio, groupResults: groupResults, anyChecked: anyChecked };
  }

  function buildChecklist(){
    var byCategory = {};
    DIAGNOSES.forEach(function(d){
      if(!byCategory[d.category]) byCategory[d.category] = [];
      byCategory[d.category].push(d);
    });

    var cats = CATEGORY_ORDER.filter(function(c){ return !!byCategory[c]; });

    var html = '';
    cats.forEach(function(cat, ci){
      var diags = byCategory[cat];
      var romanIdx = String(ci+1);
      if(romanIdx.length < 2) romanIdx = '0' + romanIdx;
      var diagHtml = diags.map(function(d){ return renderDiagnosis(d); }).join('');
      html += '\n      <section class="category" data-cat="' + escapeAttr(cat) + '">' +
        '\n        <div class="category-header" data-toggle>' +
        '\n          <div class="category-title-row">' +
        '\n            <span class="category-index">' + romanIdx + '</span>' +
        '\n            <span class="category-title">' + cat + '</span>' +
        '\n            <span class="category-count">' + diags.length + '개 진단</span>' +
        '\n          </div>' +
        '\n          <svg class="category-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '\n            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '\n          </svg>' +
        '\n        </div>' +
        '\n        <div class="category-body">' + diagHtml + '</div>' +
        '\n      </section>';
    });
    $root.innerHTML = html;

    var first = $root.querySelector('.category');
    if(first) first.classList.add('open');

    Array.prototype.forEach.call($root.querySelectorAll('[data-toggle]'), function(el){
      el.addEventListener('click', function(){
        el.closest('.category').classList.toggle('open');
      });
    });

    Array.prototype.forEach.call($root.querySelectorAll('input[type=checkbox]'), function(cb){
      cb.addEventListener('change', onCheckboxChange);
    });
  }

  function renderDiagnosis(d){
    var groupsHtml = d.groups.map(function(g, gi){
      var itemsHtml = g.items.map(function(it, ii){
        var id = checkboxId(d.id, gi, ii);
        return '<label class="item" for="' + id + '">' +
          '<input type="checkbox" id="' + id + '" data-diag="' + d.id + '" data-g="' + gi + '" data-i="' + ii + '">' +
          '<span>' + it + '</span></label>';
      }).join('');
      var label = g.label ? g.label : (d.groups.length>1 ? ('항목군 ' + (gi+1)) : '증상 항목');
      return '<div class="group" data-diag="' + d.id + '" data-gi="' + gi + '">' +
        '<div class="group-label">' + label + ' <span class="group-progress" data-progress="' + d.id + ':' + gi + '">(0/' + g.min + ' 이상 필요)</span></div>' +
        itemsHtml + '</div>';
    }).join(d.groupLogic === 'OR' ? '<div style="font-size:11px;color:var(--gray-500);font-weight:600;margin:2px 0 6px;">— 또는 —</div>' : '');

    var otherHtml = d.other ? ('<div><b>추가 확인사항</b> ' + d.other + '</div>') : '';

    return '\n    <article class="diagnosis" data-diag-id="' + d.id + '">' +
      '\n      <div class="diagnosis-head">' +
      '\n        <div class="diagnosis-name">' + d.name_kr + '<span class="diagnosis-name-en">' + d.name_en + '</span></div>' +
      '\n        <span class="badge badge-partial" data-badge="' + d.id + '">미충족</span>' +
      '\n      </div>' +
      groupsHtml +
      '\n      <div class="diagnosis-meta">' +
      '\n        <div><b>기간 기준</b> ' + d.duration + '</div>' +
      otherHtml +
      '\n      </div>' +
      '\n    </article>';
  }

  function onCheckboxChange(e){
    var cb = e.target;
    var diagId = cb.dataset.diag, g = cb.dataset.g, i = cb.dataset.i;
    var k = keyOf(diagId, g, i);
    if(cb.checked){ if(!checked[k]){ checked[k]=true; checkedCount++; } }
    else { if(checked[k]){ delete checked[k]; checkedCount--; } }
    cb.closest('.item').classList.toggle('checked', cb.checked);
    refreshChecklist();
  }

  function refreshChecklist(){
    updateBadgesAndProgress();
    updateResults();
    $checkCounter.innerHTML = '체크된 증상 <b>' + checkedCount + '</b>개';
  }

  function updateBadgesAndProgress(){
    DIAGNOSES.forEach(function(d){
      var score = diagnosisScore(d);
      var badge = document.querySelector('[data-badge="' + d.id + '"]');
      if(badge){
        if(score.met){
          badge.textContent = '기준 충족 가능성';
          badge.className = 'badge badge-met';
        } else {
          badge.textContent = score.anyChecked ? ('부분 일치 ' + Math.round(score.ratio*100) + '%') : '미충족';
          badge.className = 'badge badge-partial';
        }
      }
      score.groupResults.forEach(function(r, gi){
        var p = document.querySelector('[data-progress="' + d.id + ':' + gi + '"]');
        if(p) p.textContent = '(' + r.count + '/' + r.min + ' 이상 필요)';
      });
    });
  }

  function updateResults(){
    var scored = DIAGNOSES.map(function(d){ return { d: d, s: diagnosisScore(d) }; })
      .filter(function(x){ return x.s.anyChecked; })
      .sort(function(a,b){ return (b.s.met - a.s.met) || (b.s.ratio - a.s.ratio); });

    $resultsCount.textContent = scored.filter(function(x){ return x.s.met; }).length;

    if(scored.length === 0){
      $results.innerHTML = '<div class="results-empty">체크리스트에서 해당하는 증상을<br>선택하면 결과가 여기에 표시됩니다.</div>';
      return;
    }

    $results.innerHTML = scored.slice(0, 25).map(function(x, idx){
      var pct = Math.round(x.s.ratio*100);
      return '<div class="result-item ' + (x.s.met?'is-met':'') + '">' +
        '<span class="result-rank">' + (idx+1) + '</span>' +
        '<span class="result-name">' + x.d.name_kr + '<span class="result-cat">' + x.d.category + '</span></span>' +
        '<span class="result-score">' + (x.s.met ? '충족' : pct+'%') + '</span></div>';
    }).join('');
  }

  function resetAll(){
    checked = {};
    checkedCount = 0;
    Array.prototype.forEach.call($root.querySelectorAll('input[type=checkbox]'), function(cb){
      cb.checked = false;
      cb.closest('.item').classList.remove('checked');
    });
    refreshChecklist();
  }

  function exportChecklist(){
    var scored = DIAGNOSES.map(function(d){ return { d: d, s: diagnosisScore(d) }; })
      .filter(function(x){ return x.s.anyChecked; })
      .sort(function(a,b){ return (b.s.met - a.s.met) || (b.s.ratio - a.s.ratio); });

    var now = new Date();
    var lines = [];
    lines.push('후투티 — 정밀 체크리스트 결과');
    lines.push('생성일시: ' + now.toLocaleString('ko-KR'));
    lines.push('');
    lines.push('※ 참고용 스크리닝 자료이며 실제 진단이 아닙니다. 최종 판단은 임상가가 내려야 합니다.');
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('');

    if(scored.length === 0){
      lines.push('체크된 증상이 없습니다.');
    } else {
      scored.forEach(function(x, idx){
        var pct = Math.round(x.s.ratio*100);
        lines.push((idx+1) + '. [' + x.d.category + '] ' + x.d.name_kr + ' (' + x.d.name_en + ')');
        lines.push('   상태: ' + (x.s.met ? '기준 충족 가능성 있음' : '부분 일치 ' + pct + '%'));
        lines.push('   기간 기준: ' + x.d.duration);
        if(x.d.other) lines.push('   추가 확인사항: ' + x.d.other);
        lines.push('');
      });
    }
    downloadText(lines.join('\n'), '후투티-체크리스트결과-' + now.toISOString().slice(0,10) + '.txt');
  }

  function applySearch(q){
    q = q.trim().toLowerCase();
    var categories = $root.querySelectorAll('.category');
    Array.prototype.forEach.call(categories, function(catEl){
      var catVisible = false;
      var diags = catEl.querySelectorAll('.diagnosis');
      Array.prototype.forEach.call(diags, function(dEl){
        var diagId = dEl.dataset.diagId;
        var d = DIAGNOSES.filter(function(x){ return x.id===diagId; })[0];
        var hay = (d.name_kr + ' ' + d.name_en + ' ' + d.category).toLowerCase();
        var match = q === '' || hay.indexOf(q) !== -1;
        dEl.style.display = match ? '' : 'none';
        if(match) catVisible = true;
      });
      catEl.style.display = catVisible ? '' : 'none';
      if(q !== '' && catVisible) catEl.classList.add('open');
    });
  }

  function escapeAttr(s){ return String(s).split('"').join('&quot;'); }

  function downloadText(text, filename){
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text, btn){
    if(!text) return;
    navigator.clipboard.writeText(text).then(function(){
      var original = btn.textContent;
      btn.textContent = '복사됨';
      btn.classList.add('copied');
      setTimeout(function(){
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    });
  }

  function clearNotes(){
    // TICKET-4: #notes-input이 사라지면서 "소견 지우기"는 "대화 전체
    // 초기화"로 의미가 바뀌었다(00-overview.md §5 위험 #7 — 요구사항이
    // 명시적으로 확정한 항목은 아니며, 채팅 UI 전환에 따른 자연스러운
    // 귀결로 이 티켓에서 판단). window.__hututiChat 브릿지가 없는 예외
    // 상황에서도 조용히 무시하고 오류로 막지 않는다.
    if(window.__hututiChat && typeof window.__hututiChat.resetConversation === 'function'){
      window.__hututiChat.resetConversation();
    }
  }

  function saveResult(){
    var now = new Date();
    var lines = [];
    lines.push('후투티 — 상담사를 위한 가진단 결과');
    lines.push('생성일시: ' + now.toLocaleString('ko-KR'));
    lines.push('');
    lines.push('※ 이 결과는 가진단(참고용 후보)이며 실제 진단이 아닙니다. 최종 판단은 반드시');
    lines.push('  자격을 갖춘 임상가의 면담·병력·감별진단을 통해 내려야 합니다.');
    lines.push('');

    // TICKET-4: 저장 대상은 대화 전체(모든 턴)가 아니라 "최초 소견(첫
    // user 턴) + 최종 진단(마지막 assistant 턴)"만이다(requirements.md
    // §2.3, structure.md §3.4 확정 사항). 3단 방어: 브릿지 자체 부재 →
    // 대화 없음 → 정상. 과거 "저장 시 소견 누락" 버그와 동일 계열의
    // 회귀를 방지하는 것이 최우선 목표(00-overview.md §5 위험 #8).
    var hasBridge = window.__hututiChat && typeof window.__hututiChat.getConversation === 'function';
    var conversation = hasBridge ? window.__hututiChat.getConversation() : [];

    lines.push('[입력한 소견]');
    var firstUserTurn = conversation.filter(function(t){ return t.role === 'user'; })[0];
    lines.push(firstUserTurn ? firstUserTurn.text.trim() : '(입력 없음)');
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('');

    var lastAssistantTurn = conversation.filter(function(t){ return t.role === 'assistant'; }).slice(-1)[0];
    if(!hasBridge){
      lines.push('대화 내용을 불러올 수 없습니다(내부 오류) — 다시 시도하거나 관리자에게 문의해 주세요.');
      lines.push('');
    } else if(lastAssistantTurn && lastAssistantTurn.text.trim() !== ''){
      // TICKET-4: js/ai.js가 노출하는 window.__hututiEngine 브릿지(비-module
      // 환경 대응, 00-overview.md §4.1)를 경유해 실제 사용 엔진과 선택된
      // 모델(생각과정 없음/있음)을 저장 텍스트에 반영한다. 브릿지가 없거나
      // (스크립트 로드 순서가 깨진 예외 상황) 함수가 없는 경우에도 예외를
      // 던지지 않도록 매 단계 방어적으로 접근한다.
      var engineLabel = '(엔진 확인 불가)';
      if(window.__hututiEngine && typeof window.__hututiEngine.currentEngine === 'function'){
        if(window.__hututiEngine.currentEngine() === 'ollama'){
          var modelLabel = (typeof window.__hututiEngine.getSelectedModelLabel === 'function')
            ? window.__hututiEngine.getSelectedModelLabel()
            : null;
          engineLabel = 'Ollama 로컬 엔진' + (modelLabel ? ' · ' + modelLabel : '');
        } else {
          engineLabel = 'Kanana, 브라우저 내 로컬 AI';
        }
      }
      lines.push('[AI 최종 진단 결과 (' + engineLabel + ')]');
      lines.push('');
      lines.push(lastAssistantTurn.text.trim());
      lines.push('');
    } else {
      lines.push('AI 분석 결과가 없습니다. 먼저 대화를 진행해 결과를 생성해 주세요.');
      lines.push('키워드 기반 가진단은 더 이상 제공하지 않습니다 — 정밀 체크리스트(checklist.html)에서 직접 확인해 주세요.');
      lines.push('');
    }

    downloadText(lines.join('\n'), '후투티-가진단결과-' + now.toISOString().slice(0,10) + '.txt');
  }

  function initAssistPage(){
    document.getElementById('clear-notes-btn').addEventListener('click', clearNotes);
    document.getElementById('save-result-btn').addEventListener('click', saveResult);
  }

  function initChecklistPage(){
    $root = document.getElementById('checklist-root');
    $results = document.getElementById('results-list');
    $resultsCount = document.getElementById('results-count');
    $checkCounter = document.getElementById('check-counter');
    $search = document.getElementById('search-input');

    buildChecklist();
    refreshChecklist();

    document.getElementById('reset-btn').addEventListener('click', resetAll);
    document.getElementById('export-btn').addEventListener('click', exportChecklist);
    document.getElementById('expand-all-btn').addEventListener('click', function(){
      Array.prototype.forEach.call($root.querySelectorAll('.category'), function(c){ c.classList.add('open'); });
    });
    document.getElementById('collapse-all-btn').addEventListener('click', function(){
      Array.prototype.forEach.call($root.querySelectorAll('.category'), function(c){ c.classList.remove('open'); });
    });
    $search.addEventListener('input', function(){ applySearch($search.value); });
  }

  document.addEventListener('DOMContentLoaded', function(){
    if(document.getElementById('chat-messages')) initAssistPage();
    if(document.getElementById('checklist-root')) initChecklistPage();
  });

})();
