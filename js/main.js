/* ==========================================================================
   후투티 — 상담사를 위한 가진단 툴 — 애플리케이션 로직
   본 스크립트는 브라우저 메모리 상태만 사용하며(새로고침 시 초기화),
   서버로 어떠한 데이터도 전송하지 않습니다. 지금의 "가진단" 기능은 아직
   AI가 아니라 단순 키워드 겹침 비교이며, 전부 이 파일 안에서만 계산됩니다.
   (추후 로컬 LLM이 연결되면 이 부분만 교체될 예정)
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

  var STOPWORDS = {};
  ['그리고','그래서','그러나','하지만','그런데','또한','매우','너무','정말','자주','계속',
   '최근','이전','이후','등을','등이','등은','등','것을','것이','것은','것','같은','같이',
   '대한','대해','으로','에서','에게','부터','까지','에는','에도','에서도','에서의','합니다',
   '했다','한다','있다','없다','됩니다','되었다','하며','하고','하는','하지','않고','않았다',
   '많이','많은','조금','약간','거의','전혀','스스로','자신','때문에','위해','통해','관련'
  ].forEach(function(w){ STOPWORDS[w] = true; });

  var checked = {};
  var checkedCount = 0;
  var lastCandidates = [];
  var lastNoteText = '';
  var ITEM_INDEX = null;

  var $root, $results, $resultsCount, $checkCounter, $search, $notesInput,
      $candidatesCard, $candidatesList;

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

  function buildItemIndex(){
    if(ITEM_INDEX) return ITEM_INDEX;
    ITEM_INDEX = [];
    DIAGNOSES.forEach(function(d){
      d.groups.forEach(function(g, gi){
        g.items.forEach(function(text, ii){
          ITEM_INDEX.push({
            diagId: d.id, gi: gi, ii: ii, text: text,
            category: d.category, name_kr: d.name_kr, name_en: d.name_en,
            keywords: tokenize(text)
          });
        });
      });
    });
    return ITEM_INDEX;
  }

  function tokenize(text){
    var cleaned = String(text).replace(/[.,!?;:()\[\]"'"'·\/\\-]/g, ' ');
    var parts = cleaned.split(/\s+/);
    var out = [];
    for(var i=0;i<parts.length;i++){
      var t = parts[i].trim();
      if(t.length>=2 && !STOPWORDS[t]) out.push(t);
    }
    return out;
  }

  function matchScore(noteTokens, itemTokens){
    var score = 0;
    var matched = [];
    itemTokens.forEach(function(it){
      for(var j=0;j<noteTokens.length;j++){
        var nt = noteTokens[j];
        if(it.indexOf(nt) !== -1 || nt.indexOf(it) !== -1){
          score++;
          matched.push(it);
          break;
        }
      }
    });
    return { score: score, matched: matched };
  }

  function computeCandidates(noteText){
    var noteTokens = tokenize(noteText);
    if(noteTokens.length === 0) return [];

    var index = buildItemIndex();
    var perDiag = {};
    index.forEach(function(entry){
      var m = matchScore(noteTokens, entry.keywords);
      if(m.score === 0) return;
      if(!perDiag[entry.diagId]){
        perDiag[entry.diagId] = {
          diagId: entry.diagId, name_kr: entry.name_kr, name_en: entry.name_en,
          category: entry.category, totalScore: 0, evidences: []
        };
      }
      perDiag[entry.diagId].totalScore += m.score;
      perDiag[entry.diagId].evidences.push({ text: entry.text, gi: entry.gi, ii: entry.ii, matched: m.matched });
    });

    var list = Object.keys(perDiag).map(function(k){ return perDiag[k]; });
    list.sort(function(a,b){ return b.totalScore - a.totalScore; });
    list = list.slice(0, 8);
    list.forEach(function(c){
      c.evidences.sort(function(a,b){ return b.matched.length - a.matched.length; });
      c.evidences = c.evidences.slice(0, 3);
    });
    return list;
  }

  function runDiagnosisAssist(){
    lastNoteText = $notesInput.value;
    $candidatesCard.hidden = false;
    lastCandidates = computeCandidates(lastNoteText);

    if(lastNoteText.replace(/\s/g,'') === ''){
      $candidatesList.innerHTML = '<div class="candidates-empty">먼저 위 칸에 내담자 소견을 입력해 주세요.</div>';
      return;
    }
    if(lastCandidates.length === 0){
      $candidatesList.innerHTML = '<div class="candidates-empty">겹치는 키워드를 찾지 못했습니다. 아래 "정밀 체크리스트"에서 직접 확인해 보세요.</div>';
      return;
    }
    renderCandidates(lastCandidates);
  }

  function renderCandidates(candidates){
    $candidatesList.innerHTML = candidates.map(function(c, idx){
      var evidenceHtml = c.evidences.map(function(e){
        var kw = e.matched.length ? ('<b>[' + e.matched.slice(0,3).join(', ') + ']</b> ') : '';
        return '<div>' + kw + e.text + '</div>';
      }).join('');
      return '\n      <div class="candidate-item" data-diag-id="' + c.diagId + '">' +
        '\n        <div class="candidate-item-head">' +
        '\n          <span class="candidate-rank">' + (idx+1) + '</span>' +
        '\n          <span class="candidate-name">' + c.name_kr + '</span>' +
        '\n          <span class="candidate-cat">' + c.category + ' · ' + c.name_en + '</span>' +
        '\n        </div>' +
        '\n        <div class="candidate-evidence">' + evidenceHtml + '</div>' +
        '\n        <div class="candidate-actions">' +
        '\n          <button class="btn check-in-list-btn" data-diag-id="' + c.diagId + '">정밀 체크리스트에서 확인</button>' +
        '\n        </div>' +
        '\n      </div>';
    }).join('');

    Array.prototype.forEach.call($candidatesList.querySelectorAll('.check-in-list-btn'), function(btn){
      btn.addEventListener('click', function(){
        window.location.href = 'checklist.html?focus=' + encodeURIComponent(btn.dataset.diagId);
      });
    });
  }

  function flashDiagnosis(diagId){
    var card = $root.querySelector('[data-diag-id="' + diagId + '"]');
    if(!card) return;
    var cat = card.closest('.category');
    if(cat) cat.classList.add('open');
    card.scrollIntoView({ behavior:'smooth', block:'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }

  function formatCandidatesAsText(){
    if(lastCandidates.length === 0) return '';
    return lastCandidates.map(function(c, idx){
      var lines = [(idx+1) + '. [' + c.category + '] ' + c.name_kr + ' (' + c.name_en + ')'];
      c.evidences.forEach(function(e){
        var kw = e.matched.length ? ('[' + e.matched.slice(0,3).join(', ') + '] ') : '';
        lines.push('   - ' + kw + e.text);
      });
      return lines.join('\n');
    }).join('\n\n');
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
    $notesInput.value = '';
    $candidatesCard.hidden = true;
    $candidatesList.innerHTML = '';
    lastCandidates = [];
    lastNoteText = '';
  }

  function saveResult(){
    var now = new Date();
    var lines = [];
    lines.push('후투티 — 상담사를 위한 가진단 결과');
    lines.push('생성일시: ' + now.toLocaleString('ko-KR'));
    lines.push('');
    lines.push('※ 이 결과는 가진단(참고용 후보)이며 실제 진단이 아닙니다. 최종 판단은 반드시');
    lines.push('  자격을 갖춘 임상가의 면담·병력·감별진단을 통해 내려야 합니다.');
    lines.push('※ 현재 버전은 로컬 AI가 아직 연결되지 않아 키워드 겹침 비교로 만든 임시 결과입니다.');
    lines.push('');
    lines.push('[입력한 소견]');
    lines.push(lastNoteText.trim() || '(입력 없음)');
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('');
    lines.push('[가진단 후보]');
    lines.push('');

    if(lastCandidates.length === 0){
      lines.push('후보가 없습니다. 먼저 "가진단 받기"를 눌러 결과를 생성해 주세요.');
    } else {
      lastCandidates.forEach(function(c, idx){
        lines.push((idx+1) + '. [' + c.category + '] ' + c.name_kr + ' (' + c.name_en + ')');
        c.evidences.forEach(function(e){
          var kw = e.matched.length ? ('[' + e.matched.slice(0,3).join(', ') + '] ') : '';
          lines.push('   - ' + kw + e.text);
        });
        lines.push('');
      });
    }

    downloadText(lines.join('\n'), '후투티-가진단결과-' + now.toISOString().slice(0,10) + '.txt');
  }

  function initAssistPage(){
    $notesInput = document.getElementById('notes-input');
    $candidatesCard = document.getElementById('candidates-card');
    $candidatesList = document.getElementById('candidates-list');

    document.getElementById('analyze-btn').addEventListener('click', runDiagnosisAssist);
    document.getElementById('clear-notes-btn').addEventListener('click', clearNotes);
    document.getElementById('save-result-btn').addEventListener('click', saveResult);
    document.getElementById('copy-candidates-btn').addEventListener('click', function(e){
      copyToClipboard(formatCandidatesAsText(), e.currentTarget);
    });
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

    var focusId = new URLSearchParams(window.location.search).get('focus');
    if(focusId) flashDiagnosis(focusId);
  }

  document.addEventListener('DOMContentLoaded', function(){
    if(document.getElementById('notes-input')) initAssistPage();
    if(document.getElementById('checklist-root')) initChecklistPage();
  });

})();
