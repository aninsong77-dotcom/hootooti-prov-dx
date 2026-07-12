# TICKET-3 — 채팅 이벤트 루프 + `sessionStorage` 영속화

파일: `js/ai-ui.js`
선행 티켓: TICKET-1(신규 `analyzeWithAI` 시그니처), TICKET-2(신규 채팅 DOM)
스프린트: Sprint 3 (이번 트랙 최대 위험 지점)

## AS-IS (재확인 결과)

`js/ai-ui.js`는 총 580행이며, 이 티켓이 손대는 범위와 **절대 손대지 않는 범위**가 명확히 나뉜다.

**손대지 않는 범위(engine-selector 산출물, 94~410행 — 82~93행·109행 DOM 참조 취득부는 아래 TO-BE §1에서 별도로 다룸)**: `formatBytes`/`formatRemaining`(`:7-16`), `buildEngineDescription`(`:24-33`), `updateEngineDisplay`(`:37-57`, 단 `#ai-result-title` 참조 부분만 예외적으로 손질 — 아래 §3 참고), `playDing`(`:59-80`), DOM 참조 취득 중 엔진 관련 변수(`:94-108`), `renderOllamaFailure()`(`:128-150`), 디버그 토글(`:152-182`), "AI 선택다운" 버튼·팝오버·다운로드 확인 다이얼로그 전체 로직(`:184-410`, `updateEngineSelectButtonState`·`statusLine`·`renderEngineOptionButtons`·`renderPopoverContent`·`handleEngineOptionClick`·각종 이벤트 바인딩).

**재작성 대상(412~527행)**:

```js
// js/ai-ui.js:82-109 (일부 — 제거/교체 대상만 발췌)
var btn = document.getElementById('ai-analyze-btn');
var notesInput = document.getElementById('notes-input');
var resultCard = document.getElementById('ai-result-card');
var resultText = document.getElementById('ai-result-text');
var copyBtn = document.getElementById('copy-ai-result-btn');
var emptyHint = document.getElementById('results-empty-hint');
var followUpBox = document.getElementById('ai-followup-box');
var followUpQuestionsEl = document.getElementById('ai-followup-questions');
var followUpAnswerEl = document.getElementById('ai-followup-answer');
var followUpSubmitBtn = document.getElementById('ai-followup-submit-btn');
if (!btn || !notesInput) return;
```

```js
// js/ai-ui.js:412-527
var lastNoteText = '';

function showFollowUp(followUpQuestionsText) { /* ... */ }

if (copyBtn) { copyBtn.addEventListener('click', function () { /* resultText.textContent 복사 */ }); }

btn.addEventListener('click', async function () {
  var noteText = notesInput.value.trim();
  lastNoteText = noteText;
  /* ... analyzeWithAI(noteText, onProgress) 단발 호출 ... */
});

if (followUpSubmitBtn) {
  followUpSubmitBtn.addEventListener('click', async function () {
    /* ... analyzeWithAI(lastNoteText, null, answerText) 2차 분석 1회 ... */
  });
}
```

`:529-579` `fitNotesActionsRow()` — `.notes-actions` 셀렉터 대상. TICKET-2가 이 클래스명을 `.chat-actions`로 바꿨으므로(`02-chat-ui-markup-and-style.md` §1) 이 함수의 대상 셀렉터도 함께 갱신 필요(00-overview.md §5 위험 #6).

## TO-BE

### 1. DOM 참조 취득부 교체 (`:82-109` 대응)

**Critical 수정(계획 리뷰 반영)**: `statusEl`(`#ai-status`)은 `js/ai-ui.js:85`에서 선언되는데, 이 줄은 82~93행("제거/교체 대상" 블록, `btn`/`notesInput`/`resultCard` 계열과 함께 있음) 안에 있다. `#ai-status` 자체는 TICKET-2가 그대로 유지한 요소이므로(`02-chat-ui-markup-and-style.md` §1 "유지·재배치" 목록) **삭제하면 안 되고 재선언해야 한다** — 아래 TO-BE 블록에 `statusEl` 선언을 명시적으로 추가한다. 94~108행은 `engineSelectBtn`부터 `ollamaDebugCopyBtn`까지 **엔진/실패배너 관련 변수만** 있는 구간이며(`statusEl`은 포함되지 않음), 이 구간은 그대로 둔다.

```js
var chatMessagesEl = document.getElementById('chat-messages');
var chatEmptyHintEl = document.getElementById('chat-empty-hint');
var chatInputEl = document.getElementById('chat-input');
var chatSendBtn = document.getElementById('chat-send-btn');
var chatSufficientBtn = document.getElementById('chat-sufficient-btn');
var statusEl = document.getElementById('ai-status'); // :85에서 이 줄만 재선언(그 외 82-93행 변수는 제거)
// engineSelectBtn 등 94-108행의 엔진/실패배너 관련 변수 선언은 원본 그대로 유지 — 수정하지 않는다.
if (!chatSendBtn || !chatInputEl || !chatMessagesEl) return;
```

`updateAnalyzeBtnEnabled()`(`:115-119`, `notesInput` 참조)는 `chatSendBtn`이 `chatInputEl.value`가 비어 있으면 비활성화하는 형태로 대체하되, Enter 전송과 함께 동작해야 하므로 아래 §4의 전송 트리거 함수 안에 통합한다(별도 함수로 남기지 않아도 됨 — 구현자 재량).

### 2. 대화 상태 모델 (신규 모듈 스코프 변수)

```js
// conversation: [{ role: 'user'|'assistant', text: string, hasFollowUp: boolean }]
// hasFollowUp: 그 assistant 턴이 후속질문을 포함했는지 — 렌더링 시 ChatMessage.AIFollowUp
//              변형 스타일 적용 여부 판단에만 쓴다(00-overview.md §4.3 옵션 1과 별개 —
//              여기서는 "표시"용, 종료 판정은 TICKET-1이 확정한 방식을 그대로 따른다).
var conversation = [];
var isConversationFinalized = false; // "충분함" 버튼 또는 AI 자체 판단으로 종료된 상태
var STORAGE_KEY = 'houtoti-chat-conversation-v1';
```

**스키마 버전 필드(`-v1` 접미사)**: 00-overview.md §4.5가 "구체적 방식 미확정"이라 했던 부분 중, 키 이름 자체에 버전을 접미어로 붙이는 가장 단순한 방식을 채택한다(요구사항 §4가 명시한 "권고 수준"을 넘지 않는 최소 구현 — 이후 스키마가 바뀌면 키 이름의 숫자만 올리고, 구코드는 새 키를 찾지 못해 자연히 [빈 대화 상태]로 시작하므로 별도 파싱 버전 검증 로직 없이도 방어가 성립한다는 것이 이 선택의 근거).

### 3. 렌더링 함수 (기존 문자열 조립 컨벤션 재사용, `js/main.js`의 `renderDiagnosis()` 패턴과 동일 스타일)

```js
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderConversation() {
  if (conversation.length === 0) {
    chatMessagesEl.innerHTML = '';
    if (chatEmptyHintEl) chatMessagesEl.appendChild(chatEmptyHintEl);
    return;
  }
  chatMessagesEl.innerHTML = conversation.map(function (turn) {
    var cls = 'chat-message ' + turn.role;
    if (turn.role === 'assistant' && !turn.hasFollowUp) cls += ' final-diagnosis';
    return '<div class="' + cls + '">' + escapeHtml(turn.text) + '</div>';
  }).join('');
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
```

`turn.hasFollowUp`은 `splitFollowUpSection()`(TICKET-1, 변경 없음)의 반환값 `followUpQuestionsText !== null`로 채워진다 — "질문이 없다"는 곧 그 턴이 최종 진단에 준한다는 뜻이므로 `.final-diagnosis` 스타일을 입힌다(TICKET-2 §3의 `.chat-message.final-diagnosis` 클래스, "충분함" 강제 종결 응답도 항상 이 스타일이 적용됨 — `forceConclusion` 응답은 애초에 `FOLLOWUP_MARKER` 섹션을 만들지 않으므로 `hasFollowUp`이 항상 `false`).

`ChatMessage.AIFollowUp` 변형은 별도 시각 스타일을 강제하지 않고 **기본 `.chat-message.assistant` 그대로 둔다** — structure.md §2.3이 확정한 것은 "통짜 텍스트로 한 번에 표시"(내용 측면)이지 별도 배경색 변형을 요구하지 않았으므로, 시각적으로는 `.final-diagnosis`(최종 진단 강조)만 구분하고 나머지는 동일 스타일을 쓰는 것으로 이 티켓에서 확정한다(임의 결정 아님 — structure.md 원문이 색상 등 시각 구분을 요구하지 않았음을 근거로 함).

### 4. 전송 이벤트 (기존 `btn.addEventListener('click', ...)` 대체, `:441-496` 대응)

```js
async function sendTurn(userText, forceConclusion) {
  if (!forceConclusion) {
    conversation.push({ role: 'user', text: userText });
    renderConversation();
  }
  saveConversationToStorage();

  chatSendBtn.disabled = true;
  chatSendBtn.classList.add('loading');
  chatSufficientBtn.disabled = true;
  statusEl.hidden = true;

  try {
    var answer = await analyzeWithAI(conversation, function (loaded, total) {
      /* 기존 다운로드 진행률 표시 로직(:454-476) 그대로 재사용 */
    }, forceConclusion);

    var split = splitFollowUpSection(answer);
    var hasFollowUp = !!split.followUpQuestionsText;
    // 후속질문이 있으면 본문+질문을 하나의 말풍선(통짜 텍스트)으로 합쳐 보여준다
    // (structure.md §2.3 "통짜 텍스트" 확정 사항).
    var displayText = hasFollowUp
      ? split.mainText + '\n\n[추가로 확인하고 싶은 사항]\n' + split.followUpQuestionsText
      : split.mainText;

    conversation.push({ role: 'assistant', text: displayText, hasFollowUp: hasFollowUp });
    // 주의: 아래 한 줄은 00-overview.md §4.3 "옵션 1(프롬프트 내재화 — 질문 없음을 곧 종료 신호로
    // 재사용)"을 택했을 때의 예시일 뿐이다. 종료 감지 메커니즘은 TICKET-1이 옵션 1~3 중 무엇을
    // 채택했는지에 따라 이 조건문 자체를 교체해야 한다(예: 옵션 2를 택했다면 별도 분류 호출
    // 결과로 판정하고, 이 줄의 `!hasFollowUp`만으로 판정하지 않는다 — §4.3 표 참고).
    if (!hasFollowUp) isConversationFinalized = true; // 자연 종료(옵션 1 예시) 또는 강제 종결(forceConclusion)
    renderConversation();
    saveConversationToStorage();
    updateEngineDisplay();
    updateChatInputAvailability();
    playDing();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = '이번 턴에서 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
    // structure.md §2.1 "오류 상태" 요건 — 실패한 이 턴만 재시도 가능해야 하므로
    // 방금 push한 user 턴은 conversation에 유지한 채 재시도 버튼/재전송을 허용한다.
  } finally {
    chatSendBtn.disabled = false;
    chatSendBtn.classList.remove('loading');
    chatSufficientBtn.disabled = isConversationFinalized;
  }
}

function updateChatInputAvailability() {
  var disabled = isConversationFinalized;
  chatInputEl.disabled = disabled;
  chatSendBtn.disabled = disabled || chatInputEl.value.trim() === '';
  chatSufficientBtn.disabled = disabled;
}

chatSendBtn.addEventListener('click', function () {
  var text = chatInputEl.value.trim();
  if (!text || isConversationFinalized) return;
  chatInputEl.value = '';
  sendTurn(text, false);
});

chatInputEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSendBtn.click();
  }
});

chatInputEl.addEventListener('input', updateChatInputAvailability);

if (chatSufficientBtn) {
  chatSufficientBtn.addEventListener('click', function () {
    if (isConversationFinalized || conversation.length === 0) return;
    sendTurn(null, true); // forceConclusion — 사용자 발화 추가 없이 즉시 최종 결론 요청
  });
}
```

**§2.2 "먼저 오는 쪽이 우선" 구현 근거**: `isConversationFinalized`는 AI 자연 종료(`hasFollowUp === false`)와 "충분함" 버튼 클릭 두 경로 모두에서 동일하게 `true`로 세팅되고, 두 경로 모두 `chatSufficientBtn`/`chatSendBtn`을 즉시 비활성화하므로 "먼저 발생한 쪽"이 자연스럽게 이후 입력을 막는다 — 별도의 경합(race) 처리 로직 없이 boolean 플래그 하나로 충분하다(AI 응답 대기 중에는 두 버튼 모두 `disabled`라 사용자가 동시에 두 트리거를 낼 수 없음).

### 5. `sessionStorage` 저장·복원

```js
function saveConversationToStorage() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conversation: conversation, finalized: isConversationFinalized }));
  } catch (e) {
    /* 용량 초과 등 — 00-overview.md §4.5, 이번 범위에서 심각하게 다루지 않음.
       조용히 무시(대화 자체는 메모리에서 계속 이어지되, 새로고침 시 유실될 뿐 앱이 죽지 않음). */
  }
}

function restoreConversationFromStorage() {
  var raw;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return false;
  }
  if (!raw) return false;

  try {
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.conversation)) return false;
    var valid = parsed.conversation.every(function (t) {
      return t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string';
    });
    if (!valid) return false;
    conversation = parsed.conversation;
    isConversationFinalized = !!parsed.finalized;
    return true;
  } catch (e) {
    return false; // JSON.parse 실패 — 조용히 [빈 대화 상태]로 (requirements.md §4 권고 그대로 구현)
  }
}
```

`restoreConversationFromStorage()`가 `false`를 반환하면 `conversation = []`인 채로 `renderConversation()`을 호출해 [빈 대화 상태]로 자연스럽게 진입한다(별도 분기 불필요 — `renderConversation()`이 이미 빈 배열을 처리).

### 6. 초기화 순서 (기존 `DOMContentLoaded` 핸들러 안에 통합)

```js
document.addEventListener('DOMContentLoaded', function () {
  // ... 기존 엔진 선택 관련 초기화(:184-410, 변경 없음) ...

  restoreConversationFromStorage();
  renderConversation();
  updateChatInputAvailability();
  updateEngineDisplay();
});
```

기존 엔진 선택 블록의 `DOMContentLoaded` 리스너와 이 티켓의 채팅 초기화는 **같은 핸들러 함수 안에 나란히 배치**하되, 엔진 선택 블록 코드는 한 줄도 수정하지 않는다(00-overview.md §5 위험 #5 대응).

### 7. `window.__hututiChat` 브릿지 (00-overview.md §4.2)

```js
if (typeof window !== 'undefined') {
  window.__hututiChat = {
    getConversation: function () { return conversation.slice(); },
    isFinalized: function () { return isConversationFinalized; },
    resetConversation: function () {
      conversation = [];
      isConversationFinalized = false;
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
      renderConversation();
      updateChatInputAvailability();
    },
  };
}
```

`resetConversation()`은 TICKET-4의 `clearNotes()` 재구성이 호출한다(§ 다른 티켓과의 연결 참고). 이 브릿지는 `js/ai.js`가 이미 노출한 `window.__hututiEngine`(engine-selector 산출물)과 **이름 충돌 없이 독립적으로** 공존한다.

### 8. `updateEngineDisplay()` 수정 (`:37-57`, 유일하게 손대는 기존 엔진 코드)

```js
function updateEngineDisplay() {
  var badge = document.getElementById('ai-mode-badge');
  var usingOllama = currentEngine() === 'ollama';
  if (badge) {
    badge.textContent = usingOllama
      ? '로컬 엔진 (Ollama · Qwen3-4B)'
      : '브라우저 내 로컬 AI (Kanana)';
  }
  // titleEl(#ai-result-title) 참조 블록(:48-56) 삭제 — TICKET-2에서 해당 요소 자체를 제거함.
}
```

이 함수는 엔진 선택 로직(82~410행)이 아니라 표시 갱신 유틸이므로 이 티켓 범위에 포함되지만, **삭제만 하고 새 로직을 추가하지 않는** 최소 수정이라 00-overview.md §5 위험 #5의 "82~410행 불변" 원칙과 모순되지 않는다(37~57행은 그 범위 밖).

### 9. `fitNotesActionsRow()` 대상 셀렉터 갱신 (`:529-579`, 위험 #6 대응)

```js
function fitNotesActionsRow() {
  var row = document.querySelector('.chat-actions'); // 기존 '.notes-actions' → TICKET-2가 바꾼 클래스명
  if (!row) return;
  // 이하 로직 변경 없음
}
```

## 다른 티켓과의 연결

- TICKET-1에서 받는 것: `analyzeWithAI(conversation, onProgress, forceConclusion)` 신규 시그니처, `splitFollowUpSection()`(변경 없음), 실제 채택된 종료 감지 옵션(1~3 중 TICKET-1이 기록한 것 — 이 티켓의 `hasFollowUp` 판정 로직이 그 선택에 맞춰 조정될 수 있음, 예: 옵션 2를 택했다면 별도 분류 호출 결과를 `sendTurn()`에 추가로 반영해야 함).
- TICKET-2에서 받는 것: `#chat-messages`/`#chat-empty-hint`/`#chat-input`/`#chat-send-btn`/`#chat-sufficient-btn` DOM, `.chat-actions` 클래스명(구 `.notes-actions`).
- TICKET-4에 주는 것: `window.__hututiChat.getConversation()`, `.isFinalized()`, `.resetConversation()` — `js/main.js`의 `saveResult()`/`clearNotes()`가 소비.
- 공유 파일 주의: `js/ai-ui.js`는 이 티켓 하나만 수정한다(이후 티켓 없음). 단, **82~410행(엔진 선택·실패 배너)은 이 티켓에서도 읽기만 하고 실질 수정하지 않는다** — 리뷰 시 이 구간에 diff가 있다면 그 자체가 스코프 이탈 신호.

## 완료 기준

- [ ] `#notes-input`/`#ai-analyze-btn`/`#ai-result-card` 하위 DOM 참조(82~93행, `#ai-status`/`statusEl` 재선언 제외) 제거, 신규 채팅 DOM 참조로 교체
- [ ] `conversation`/`isConversationFinalized`/`STORAGE_KEY` 모듈 스코프 변수 도입
- [ ] `renderConversation()` 구현 — 빈 대화/일반 턴/최종 진단 스타일 분기
- [ ] `sendTurn(userText, forceConclusion)` 구현 — 일반 전송과 "충분함" 강제 종결 두 경로 통합
- [ ] Enter 키 전송(Shift+Enter는 줄바꿈) 동작
- [ ] `sessionStorage` 저장(매 turn 경계)·복원(`DOMContentLoaded`)·스키마 방어(파싱 실패 시 조용히 빈 대화) 구현
- [ ] `window.__hututiChat` 브릿지(`getConversation`/`isFinalized`/`resetConversation`) 노출
- [ ] `updateEngineDisplay()`에서 `#ai-result-title` 참조 블록 삭제(그 외 변경 없음)
- [ ] `fitNotesActionsRow()`의 대상 셀렉터를 `.chat-actions`로 갱신
- [ ] **94~410행(엔진 선택·실패 배너 로직, `statusEl` 재선언이 포함된 82~93행·109행 DOM 참조 취득부는 제외) diff 없음 확인** — 회귀 방지 최우선 체크(계획 리뷰 Warning 1 반영: 82~93행·109행은 위 항목대로 실질 diff가 나는 것이 정상이며, 이 항목은 그 나머지 구간의 불변을 확인하는 것)
- [ ] `index.html`의 `js/ai-ui.js?v=27` → `?v=28`, `js/ai-ui.js:5`의 `./ai.js?v=15` → `?v=16` 갱신

## 테스트 항목

- **대화 종료 조건 경합**(요구사항 §5 1순위): AI가 마지막 응답에서 자연 종료(질문 없음)한 직후 "충분함" 버튼을 거의 동시에 눌러도 오류 없이 하나의 결과만 최종 상태로 반영되는지.
- **자연어 종료 의도 오탐/미탐**(요구사항 §5 2순위): TICKET-1이 택한 옵션 기준으로 "그만 물어봐 주세요"류 발화 다수 시나리오 테스트. 옵션 1 채택 시, 토큰 한도에 걸려 응답이 중간에 잘려 `FOLLOWUP_MARKER` 섹션 자체가 누락된 경우(TICKET-1 §4 "세 번째 오판 원인")도 별도로 재현해, 실제로 "질문 없음"과 혼동되는지 확인.
- **컨텍스트 한도 초과**(요구사항 §5 3순위): 10턴 이상 인위적으로 누적시켜 `N_CTX=4096` 근접 시 오류 메시지 없이 처리되는지.
- **`sessionStorage` 저장·복원**(요구사항 §5 6순위): 새로고침, `checklist.html`/`icd11.html`/`about.html` 왕복 후 대화가 순서·역할·내용 손실 없이 이어지는지. 새 탭에서는 비어 있는지.
- **스키마 불일치 방어**(요구사항 §5 7순위): 콘솔에서 `sessionStorage.setItem('houtoti-chat-conversation-v1', '{broken')` 같은 손상값을 주입 후 새로고침 시 오류 없이 [빈 대화 상태]로 시작하는지.
- **엔진 전환 시 일관성**(요구사항 §5 5순위): 대화 중 Ollama를 껐다 켰을 때 `updateEngineDisplay()`가 매 응답마다 갱신되고 대화 자체가 깨지지 않는지.
- **엔진 선택·실패 배너 회귀**(최우선): "AI 선택다운" 버튼·팝오버·다운로드 확인·실패 배너·디버그 토글이 전부 기존과 동일하게 동작하는지.
- 조립 검증: 콘솔에서 `window.__hututiChat.getConversation()`, `.isFinalized()`, `.resetConversation()` 호출이 선언대로 동작하는지.
