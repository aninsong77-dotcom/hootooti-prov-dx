# TICKET-4 — 결과 저장·초기화 로직 재구성

파일: `js/main.js`
선행 티켓: TICKET-3(`window.__hututiChat` 브릿지)
스프린트: Sprint 4 (마지막)

## AS-IS (재확인 결과)

```js
// js/main.js:38
var lastNoteText = '';
```

```js
// js/main.js:280-286
function clearNotes(){
  $notesInput.value = '';
  lastNoteText = '';
  var aiCard = document.getElementById('ai-result-card');
  var hint = document.getElementById('results-empty-hint');
  if(hint && aiCard && aiCard.hidden) hint.hidden = false;
}
```

```js
// js/main.js:288-333
function saveResult(){
  var now = new Date();
  var lines = [];
  lines.push('후투티 — 상담사를 위한 가진단 결과');
  lines.push('생성일시: ' + now.toLocaleString('ko-KR'));
  lines.push('');
  lines.push('※ 이 결과는 가진단(참고용 후보)이며 실제 진단이 아닙니다. ...');
  lines.push('');
  lines.push('[입력한 소견]');
  lines.push(($notesInput ? $notesInput.value.trim() : '') || lastNoteText.trim() || '(입력 없음)');
  lines.push('');
  lines.push('----------------------------------------');
  lines.push('');

  var aiResultCard = document.getElementById('ai-result-card');
  var aiResultText = document.getElementById('ai-result-text');
  if(aiResultCard && !aiResultCard.hidden && aiResultText && aiResultText.textContent.trim() !== ''){
    var engineLabel = '(엔진 확인 불가)';
    if(window.__hututiEngine && typeof window.__hututiEngine.currentEngine === 'function'){
      /* ... 엔진 판정 ... */
    }
    lines.push('[AI 분석 결과 (' + engineLabel + ')]');
    lines.push('');
    lines.push(aiResultText.textContent.trim());
    lines.push('');
  } else {
    lines.push('AI 분석 결과가 없습니다. 먼저 "AI 분석"을 눌러 결과를 생성해 주세요.');
    lines.push('키워드 기반 가진단은 더 이상 제공하지 않습니다 — 정밀 체크리스트(checklist.html)에서 직접 확인해 주세요.');
    lines.push('');
  }

  downloadText(lines.join('\n'), '후투티-가진단결과-' + now.toISOString().slice(0,10) + '.txt');
}
```

```js
// js/main.js:335-340
function initAssistPage(){
  $notesInput = document.getElementById('notes-input');
  document.getElementById('clear-notes-btn').addEventListener('click', clearNotes);
  document.getElementById('save-result-btn').addEventListener('click', saveResult);
}
```

`js/main.js:363-365` `DOMContentLoaded` 리스너 — `document.getElementById('notes-input')`가 존재하면 `initAssistPage()`를 호출하는데, TICKET-2가 `#notes-input`을 제거했으므로 **이 판별 조건 자체가 깨진다**(항상 false가 되어 `initAssistPage()`가 영영 호출되지 않음) — 이 티켓의 최우선 수정 대상.

## TO-BE

### 1. `initAssistPage()` 진입 판별 조건 교체

```js
// js/main.js:363-365 대응
document.addEventListener('DOMContentLoaded', function(){
  if(document.getElementById('chat-messages')) initAssistPage();
  if(document.getElementById('checklist-root')) initChecklistPage();
});
```

`#notes-input` 대신 TICKET-2가 신설한 `#chat-messages`(index.html 전용 요소, `checklist.html`에는 없음)로 판별한다.

### 2. `initAssistPage()` — `$notesInput` 참조 제거

```js
function initAssistPage(){
  // $notesInput = document.getElementById('notes-input');  // 삭제 — 더 이상 존재하지 않음
  document.getElementById('clear-notes-btn').addEventListener('click', clearNotes);
  document.getElementById('save-result-btn').addEventListener('click', saveResult);
}
```

`$notesInput`/`lastNoteText`(모듈 스코프 변수, `:38`, `:40`)는 **완전히 삭제**한다 — `conversation[0].text`가 유일한 진실 소스가 된다(00-overview.md §4.2).

### 3. `clearNotes()` → "대화 초기화"로 재정의

```js
function clearNotes(){
  if(window.__hututiChat && typeof window.__hututiChat.resetConversation === 'function'){
    window.__hututiChat.resetConversation();
  }
  // window.__hututiChat 부재 시(예외 상황)에도 조용히 무시 — 오류로 막지 않음.
}
```

**§5 위험 #7 관련 투명성 고지**: `#clear-notes-btn`은 기존에 "소견 textarea 지우기"였으나, 채팅 UI에서는 지울 개별 textarea가 없으므로 "대화 전체 초기화"로 의미가 바뀐다. 이는 `requirements.md`가 명시적으로 확정한 항목이 아니라 채팅 UI 전환에 따른 **자연스러운 귀결**로 이 티켓에서 판단한 것이며, 완료 보고 시 이 판단을 사용자에게 다시 한번 알린다(00-overview.md §5 위험 #7).

### 4. `saveResult()` — `conversation` 배열 기반으로 재작성

```js
function saveResult(){
  var now = new Date();
  var lines = [];
  lines.push('후투티 — 상담사를 위한 가진단 결과');
  lines.push('생성일시: ' + now.toLocaleString('ko-KR'));
  lines.push('');
  lines.push('※ 이 결과는 가진단(참고용 후보)이며 실제 진단이 아닙니다. 최종 판단은 반드시');
  lines.push('  자격을 갖춘 임상가의 면담·병력·감별진단을 통해 내려야 합니다.');
  lines.push('');

  // 3단 방어: 브릿지 자체 부재 → 대화 없음 → 정상. 과거 "저장 시 소견 누락" 버그
  // (js/main.js:298의 보정 로직)와 동일한 계열의 회귀를 방지하는 것이 최우선 목표.
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
```

**저장 대상 재확인(`requirements.md` §2.3, `structure.md` §3.4 확정 사항)**: 대화 전체(모든 턴)가 아니라 **"최초 소견(`conversation`의 첫 `user` 턴) + 최종 진단(마지막 `assistant` 턴)"만** 추출한다 — 중간 후속질문·답변 턴은 저장 텍스트에 포함하지 않는다. `window.__hututiEngine` 브릿지 소비 방식(`:306-321`)은 기존 코드를 그대로 재사용한다(엔진 정보 판정 로직 자체는 변경 없음).

## 다른 티켓과의 연결

- TICKET-3에서 받는 것: `window.__hututiChat.getConversation()`(스냅샷 배열), `.isFinalized()`(이 티켓에서는 사용하지 않지만 향후 "결과 저장" 버튼을 대화 미종료 시 비활성화하는 등의 확장에 쓸 수 있음, 이번 범위에서는 강제하지 않음 — 요구사항이 "대화 종료 후"로 한정하지 않았으므로 진행 중에도 저장 가능하게 둔다), `.resetConversation()`.
- 후행 티켓 없음(Sprint 4가 마지막).
- 공유 파일 주의: `js/main.js`는 이 티켓 하나만 수정한다. `initChecklistPage()`(`:342-361`)는 이 티켓과 무관하므로 손대지 않는다(재확인 완료).

## 완료 기준

- [ ] `js/main.js:363-365`의 `initAssistPage()` 진입 판별을 `#notes-input` → `#chat-messages`로 교체
- [ ] `$notesInput`/`lastNoteText` 모듈 스코프 변수 삭제
- [ ] `clearNotes()`를 `window.__hututiChat.resetConversation()` 호출로 재구성(브릿지 부재 시 방어)
- [ ] `saveResult()`를 `conversation` 배열 기반(최초 소견 + 최종 진단)으로 재작성, 3단 방어(브릿지 없음/대화 없음/정상) 포함
- [ ] `js/main.js:1-10` 헤더 주석에 "채팅 대화 배열(`window.__hututiChat`) 기반으로 전환" 한 줄 추가(00-overview.md §9)
- [ ] `index.html`의 `js/main.js?v=7` → `?v=8` 갱신(계획 리뷰 Warning 2 반영 — `js/main.js`를 직접 재작성하는 유일한 티켓이므로 이 버전 쿼리를 올리는 책임도 이 티켓에 있음, 00-overview.md §5 위험 #9)

## 테스트 항목

- **결과 저장 데이터 무결성**(요구사항 §5 4순위): 최초 소견을 입력하고 후속질문 2~3턴을 거쳐 최종 진단까지 받은 뒤 "결과 저장" 클릭 — `.txt` 파일에 최초 소견과 최종 진단이 모두 빠짐없이 들어있는지(중간 턴은 없어도 됨).
- **`window.__hututiChat` 부재 시 방어**: 콘솔에서 `delete window.__hututiChat` 실행 후 "결과 저장" 클릭 — 예외로 죽지 않고 "대화 내용을 불러올 수 없습니다" 문구로 안내되는지.
- **"가진단 받기" 제거 회귀 재확인**(요구사항 §5 5순위): `clearNotes()`/`initAssistPage()` 재작성이 이미 삭제된 `runDiagnosisAssist()` 등 키워드 기반 가진단 관련 코드를 되살리지 않았는지(git diff로 확인).
- **`#clear-notes-btn` 재정의 동작**: 클릭 시 대화 전체가 사라지고(`renderConversation()` 결과 [빈 대화 상태]), 새로고침해도 다시 나타나지 않는지(sessionStorage 실제로 비워졌는지).
- **`checklist.html` 회귀 없음**: `initChecklistPage()` 관련 동작이 이번 변경으로 영향받지 않았는지(스모크 테스트).
