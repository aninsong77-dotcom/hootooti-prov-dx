# 00-overview.md — symptom-chat-interview 구현 계획 개요

> 근거 문서: `docsPlan/symptom-chat-interview/requirements.md`, `docsPlan/symptom-chat-interview/structure.md`
> 코드베이스 전수 조사: `index.html`, `js/ai.js`, `js/ai-ui.js`, `js/main.js`, `css/style.css` **재확인 완료(본 계획 작성 시점, engine-selector 트랙 6개 티켓 병합 반영 후)**
> 이 문서는 계획 문서입니다. 코드는 작성하지 않습니다.

---

## 0. 재확인 메모 — 기획 시점과 현재 코드의 차이

`requirements.md`·`structure.md`는 `engine-selector` 트랙 구현 **이전**에 조사됐다고 명시돼 있으나, 실제로는 이미 완료된 상태를 상당히 정확히 반영하고 있었다(문서 자체가 "engine-selector 먼저 구현 후 착수" 순서를 이미 전제). 본 재조사로 확인한 차이점만 기록한다:

- 버전 쿼리가 문서 작성 시점보다 올라가 있다: `index.html`은 `js/main.js?v=7`, `js/ai-ui.js?v=27`을 로드하고, `js/ai-ui.js:5`는 `./ai.js?v=15`를 import한다(`css/style.css?v=24`). 이번 트랙의 각 티켓은 **이 최신 번호에서부터** 올려야 한다(옛 번호 기준으로 착각하지 말 것).
- `js/ai.js`에 `OLLAMA_MODELS` 레지스트리(`:192-218`), `getSelectedModelId`/`setSelectedModelId`/`listOllamaModels`(`:224-236`), `detectOllama(forceRefresh)`(`:251`), `getOllamaConnectionState`/`getLastOllamaError`/`isModelInstalled`/`getInstalledModelNames`(`:295-310`), `pullOllamaModel`(`:395`), `window.__hututiEngine` 브릿지(`:519-528`)가 이미 존재한다 — 이번 트랙은 이 구조를 **그대로 재사용**하며 건드리지 않는다(단, `analyzeWithAI()` 시그니처 재설계 시 이 함수들과의 호출 관계는 유지해야 함).
- `index.html`에 "AI 선택다운" 버튼(`#engine-select-btn`, `:70-72`)과 중앙 모달(`#engine-select-overlay`, `:113-121`)이 이미 반영돼 있고, 키워드 기반 "가진단 받기" 버튼(`#analyze-btn`)·전용 카드(`#candidates-card`)는 **이미 제거되어 있다**(`js/main.js:6-9` 주석이 이를 명시). 이 항목은 재확인만 하고 본 계획의 티켓에서 제외한다.
- `js/ai-ui.js`는 1~5행에서 `ai.js`의 신규 export 전체를 import하고 있고, 82~410행에 엔진 선택 팝오버·다운로드 확인 다이얼로그·Ollama 실패 배너·디버그 토글 로직이 이미 존재한다. 이번 트랙이 재작성할 대상은 **412행 이후**(`lastNoteText`, `showFollowUp()`, `btn.addEventListener('click', ...)`, `followUpSubmitBtn` 핸들러)와 82~109행의 DOM 참조 취득부(신규 채팅 DOM으로 교체) 뿐이다. 82~410행(엔진 선택 관련)은 **손대지 않는다**.

## 1. 요구사항 요약 (재확인)

증상 소견 입력을 1회성 질의응답 구조에서 **완전 채팅형 UI**로 전면 교체한다. 핵심 변경 4가지:

1. **UI**: `#notes-input` textarea + `#ai-result-card`(결과+1회성 후속질문 박스) → 말풍선 대화 목록 + 하단 채팅 입력창. `#ai-analyze-btn` 제거, 전송 동작이 그 역할 흡수.
2. **다회 순환**: 후속질문 ↔ 답변을 고정 라운드 없이 반복, AI 자체 판단(가설연역 기준 충족 또는 사용자 자연어 종료 의도 인식) 또는 상담사 "충분함" 버튼 중 먼저 오는 쪽에서 종료.
3. **히스토리 전달**: `analyzeWithAI()`를 대화 배열 전체를 받는 구조로 재설계(요약 압축 없음, 옵션 A 확정).
4. **영속화(신규, 이번 계획 최우선)**: 대화를 `sessionStorage`에 저장 — 새로고침·`checklist.html`/`icd11.html`/`about.html` 왕복 후에도 유지, 탭 종료 시에만 소실.

부수적으로 "결과 저장"은 "최초 소견 + 최종 진단 결과"만 저장(대화 전체 아님)하는 형태로 재구성된다.

**임의로 결론내지 않고 impl 단계 옵션만 제시할 항목** (`requirements.md` §4, 아래 §4에서 옵션 나열):
- 사용자 자연어 종료 의도 감지 메커니즘
- `sessionStorage` 스키마 버전 불일치 방어(권고 수준만 확정, 구체 방식 미확정)
- `sessionStorage` 5~10MB 용량 한도(인지만, 이번 범위 심각 고려 대상 아님)

## 2. 코드베이스 재확인 결과 (현재 상태 정확한 재기록)

### `js/ai.js` (589행)
- `:116-117` `FOLLOWUP_MARKER = '### 추가확인질문'`, `FOLLOWUP_NONE_TEXT = '(추가 질문 없음)'` — 후속질문 섹션 구분자. **후속질문 "분리 표시"용으로는 재사용 가능**하나, "충분함(종료)" 판정에는 쓰지 않기로 확정됨(`structure.md` §3.3).
- `:126-178` `buildSystemPrompt(dictionaryText, isFollowUp)` — `isFollowUp` boolean 하나로 1차(후속질문 생성 포함)/2차(최종 결론만) **두 단계만** 존재. 다회 순환·자연어 종료 인식을 지원하려면 이 이분법 자체를 재설계해야 함(TICKET-1 핵심).
- `:542-588` `analyzeWithAI(noteText, onProgress, followUpAnswerText)` — 매 호출 `noteText` + (있으면) `followUpAnswerText` 하나만으로 system/user 메시지 쌍 하나를 새로 만든다(`:546-549`). 대화 히스토리 누적 없음. `:560-571`에서 `detectOllama()` → 성공 시 `analyzeWithOllama(systemPrompt, userMessage)` 호출(2개 메시지만 `/api/chat`에 실림, `:341-344`), 실패 시 `:573-587`에서 wllama `createChatCompletion()`에 마찬가지로 2개 메시지만 전달.
- `:53-78` `pickRelevantDiagnoses(noteText, limit)` — 현재는 **최초 소견 텍스트 하나**로만 진단 사전을 추린다. 대화가 누적되면 이후 턴에서도 이 함수를 그대로 쓸지, 누적 텍스트 전체로 다시 계산할지는 TICKET-1에서 설계 결정 필요(§4.1).
- `:31` `N_CTX = 4096` — 대화 누적 시 초과 가능(요구사항 §5 테스트 필수 대상).
- `:532-540` `splitFollowUpSection(answerText)` — 마커 기준으로 `mainText`/`followUpQuestionsText` 분리, 그대로 재사용 가능.
- 엔진 관련 export(`detectOllama`, `pullOllamaModel`, `OLLAMA_MODELS` 등, engine-selector 산출물)는 **변경 대상 아님**, `analyzeWithAI()` 내부에서 호출하는 방식만 유지.

### `js/ai-ui.js` (580행)
- `:1-5` import 목록 — engine-selector 산출물 전체(`detectOllama`, `listOllamaModels`, `setSelectedModelId` 등) + 기존 `analyzeWithAI`, `splitFollowUpSection`. 신규 `analyzeWithAI` 시그니처에 맞춰 import 자체는 그대로 두되 호출부만 바뀜.
- `:82-109` DOM 참조 취득 — `btn`(`#ai-analyze-btn`, 제거 대상), `notesInput`(`#notes-input`, 제거 대상), `resultCard`/`resultText`/`followUpBox`/`followUpQuestionsEl`/`followUpAnswerEl`/`followUpSubmitBtn`(전부 채팅 DOM으로 교체) — **엔진 관련 참조(`engineSelectBtn` 등, `:94-108`)는 그대로 유지**.
- `:115-119` `updateAnalyzeBtnEnabled()` — `notesInput` 참조, 채팅 입력창 전송 버튼 활성/비활성 로직으로 대체 필요.
- `:412-527` — 재작성 대상 핵심 구간: `lastNoteText`(모듈 변수, `conversation[0]`으로 대체), `showFollowUp()`, `#ai-analyze-btn` 클릭 핸들러(단발 분석), `#ai-followup-submit-btn` 클릭 핸들러(2차 분석 1회) — 이 세 부분을 채팅 이벤트 루프 하나로 통합.
- `:37-57` `updateEngineDisplay()`, `:59-80` `playDing()` — 그대로 재사용(채팅 흐름에서도 AI 응답 도착 시 호출).
- `:529-579` 버튼 행 자동 맞춤(`fitNotesActionsRow`) — `.notes-actions`가 사라지면(또는 축소되면) 이 로직의 대상 셀렉터가 유효한지 재확인 필요(§5 위험 #6).

### `index.html` (143행)
- `:59-84` `.assist-card` 내부 — `#notes-input`(textarea), `.notes-actions`(`#ai-analyze-btn`/`#clear-notes-btn`/`#save-result-btn`/`#engine-select-btn`), `#ollama-failure-banner`, `#ai-status` — **채팅 컨테이너로 전면 교체 대상은 `#notes-input`과 `#ai-analyze-btn`뿐**. `#clear-notes-btn`·`#save-result-btn`·`#engine-select-btn`·`#ollama-failure-banner`·`#ai-status`는 유지(단, `#clear-notes-btn`의 동작 의미는 TICKET-4에서 재정의됨, §5 위험 #7).
- `:87-108` `<aside class="assist-results-panel">` — `#ai-result-card`(결과+후속질문 박스) + `#results-empty-hint` — 채팅 메시지 목록(`ChatContainer`)으로 교체.
- `:113-121` `#engine-select-overlay`, `:123-131` `#download-confirm-overlay` — **그대로 유지**(engine-selector 산출물, 이번 트랙과 무관).
- `:133-135` 스크립트 로드 순서 — `js/data.js` → `js/main.js`(비-module) → `js/ai-ui.js`(module). 이 순서 자체는 유지(엔진 브릿지 타이밍 보장 조건, engine-selector TICKET-4 설계와 동일 전제).

### `js/main.js` (369행, 단일 IIFE)
- `:38` `lastNoteText`(모듈 변수) — `saveResult()`가 `#notes-input`이 사라진 뒤에도 소견을 참조할 방법이 필요(§4.2 브릿지 설계).
- `:280-286` `clearNotes()` — `$notesInput.value`를 비우고 `results-empty-hint`를 다시 보이는 로직. `#notes-input` 자체가 사라지므로 전면 재작성 필요(§5 위험 #7).
- `:288-333` `saveResult()` — `:298`에서 `($notesInput ? $notesInput.value.trim() : '') || lastNoteText.trim()`로 소견 누락을 방지하는 보정 로직(과거 버그 수정 지점, `requirements.md` §1 언급). `#notes-input`이 사라지면 이 전제 자체가 무너지므로 **회귀 재발 방지가 TICKET-4의 최우선 순위**(요구사항 §5 "결과 저장 데이터 무결성" 테스트 필수 대상과 직결). `:306-321`에서 `window.__hututiEngine` 브릿지를 이미 안전하게 소비하고 있는 기존 패턴을 그대로 참고할 수 있음.
- `:335-340` `initAssistPage()` — `$notesInput = document.getElementById('notes-input')`부터 시작. `#notes-input`이 사라지면 이 취득 자체가 `null`이 되어 이후 로직이 깨지므로 반드시 함께 수정.
- `initChecklistPage()`(`:342-361`)는 별도 페이지 전용 — **영향 없음**(재확인 완료).

### `css/style.css` (1100행)
- `:276-296` `.notes-textarea` — 제거 또는 채팅 입력창 스타일로 전환.
- `:588-625` `.ai-result-text`, `.ai-followup-box` 관련 스타일 — 채팅 버블 스타일 신규 작성 시 참고 후 폐기 검토.
- `:627-678` `.candidates-card`, `.candidates-head`, `.candidates-badge` — `#ai-result-card`가 이 클래스를 썼으므로(`index.html:88`), 채팅 컨테이너 교체 시 함께 정리 필요. **단, `.copy-btn`(`:653-668`)은 최종 진단 결과 복사 기능에 재사용 가능**.
- `:237-242` `.assist-results-empty` — `#results-empty-hint`용, 채팅 "빈 대화 상태" UI로 대체.
- 채팅 버블·입력창·"충분함" 버튼 스타일은 전부 **신규 작성**.

## 3. 영향 파일 및 레이어

| 파일 | 레이어 | 이번 트랙에서의 역할 |
|---|---|---|
| `js/ai.js` | AI 연동 로직(module) | `analyzeWithAI()` 대화 배열 수신으로 재설계, `buildSystemPrompt()` 다회 순환+자연어 종료 인식 대응, 진단 사전 그라운딩 재계산 범위 결정 |
| `index.html` | 마크업 | `#notes-input`/`#ai-analyze-btn`/`#ai-result-card`/`#ai-followup-box`/`#results-empty-hint` 제거, `ChatContainer`/`ChatMessage`/`ChatInputBar`/"충분함" 버튼 마크업 신규, `<script>` 버전 쿼리 갱신 |
| `css/style.css` | 스타일 | 채팅 버블·입력창·"충분함" 버튼 신규 스타일, 옛 카드/박스 스타일 정리 |
| `js/ai-ui.js` | 이벤트/UI 로직(module) | 채팅 이벤트 루프 신규 작성(412~527행 대체), `sessionStorage` 저장/복원, 종료조건 판정 소비 — **엔진 선택·실패 배너 로직(82~410행)은 불변** |
| `js/main.js` | 비-module 애플리케이션 로직(IIFE) | `saveResult()`/`clearNotes()` 재구성, 대화 배열 브릿지 소비 |

레이어 교차: AI 연동(ai.js) + 마크업(index.html) + 스타일(css) + 이벤트 로직(ai-ui.js) + 비-module 로직(main.js) — 5개 파일, 4개 레이어. 이번 트랙은 `engine-selector` 병합 이후 착수가 확정돼 있었고(`structure.md` §서두), 재조사 결과 실제로 병합 완료 상태에서 시작한다.

## 4. 핵심 설계 결정 (impl-planner 단계 확정 사항 + 미결정 옵션 제시)

### 4.1 진단 사전 그라운딩(`pickRelevantDiagnoses`) 재계산 범위 — **TICKET-1에서 확정 권장, 강제 아님**

현재 `pickRelevantDiagnoses(noteText, limit)`는 최초 소견 텍스트 하나만 본다. 다회 순환에서 두 가지 선택지가 있다:
- **A. 최초 소견 고정**: `conversation[0].text`만 계속 사용 — 구현 단순, 최초 그라운딩 유지.
- **B. 누적 재계산**: 매 턴 `conversation`의 모든 `user` 텍스트를 합쳐 재계산 — 후속 답변에 새로운 키워드가 나오면 더 정확한 후보를 반영할 수 있으나 매 턴 계산 비용 증가(단, `DIAGNOSES` 배열이 크지 않아 성능 문제는 아님).

이 결정은 요구사항 문서에 명시적으로 열려 있지 않지만 대화 배열 재설계에 종속되는 세부 구현이므로, **TICKET-1 구현 시점에 정하되(임의 추정 아님, 코드 검토 기반 자연스러운 확장) 어느 쪽을 택하든 회귀는 없음**(B가 더 요구사항 취지에 부합 — "히스토리 전체 활용"). 확정은 아니며 TICKET-1 문서에서 구체화한다.

### 4.2 `conversation` 배열의 소유권과 `main.js` 브릿지 — **engine-selector TICKET-4와 동형 문제, 방향만 반대**

`engine-selector`에서는 `js/ai.js`(module)의 `currentEngine()`을 `js/main.js`(비-module)가 못 불러오는 문제를 `window.__hututiEngine` 전역 브릿지로 해결했다(TICKET-4). 이번 트랙은 **정반대 방향의 동형 문제**가 생긴다: `conversation` 배열은 채팅 이벤트 루프를 갖는 `js/ai-ui.js`(module) 스코프에 있는데, `saveResult()`(`js/main.js`, 비-module)가 "최초 소견 + 최종 진단 결과"를 만들려면 이 배열을 읽어야 한다.

**해결 방향(TICKET-3에서 구현, 기존 패턴 재사용)**: `js/ai-ui.js`가 `window.__hututiChat = { getConversation: function(){ return conversation.slice(); }, ... }` 형태로 읽기 전용 스냅샷 접근자를 전역에 노출하고, `js/main.js`는 `window.__hututiEngine`을 방어적으로 참조하던 기존 패턴(`js/main.js:311-321`)과 동일한 방식으로 `window.__hututiChat`을 안전하게 참조한다. 스크립트 로드 순서(`data.js`→`main.js`→`ai-ui.js` module)상 `main.js`의 톱레벨 코드는 `ai-ui.js`보다 먼저 실행되지만, `saveResult()` 자체는 버튼 클릭 이벤트 핸들러 내부에서만 실행되므로 실제 호출 시점엔 `ai-ui.js`가 이미 로드되어 있음이 보장된다(engine-selector TICKET-4 §4.1 타이밍 근거와 동일 논리).

`sessionStorage` 자체(저장·복원)는 `js/ai-ui.js` 안에서 완결(브라우저 전역 API라 모듈 경계 문제 없음) — 브릿지가 필요한 것은 오직 "지금 이 순간의 `conversation` 배열을 `main.js`가 읽는" 경우뿐이다.

### 4.3 대화 종료(충분함) 판정 메커니즘 — **미확정 유지, 3가지 옵션만 제시 (`requirements.md` §4 그대로 존중)**

원칙(마커/JSON 미채택, 자연어 응답 기반 판단)은 확정됐고, 정확한 감지 메커니즘은 이 계획에서 결론내지 않는다. TICKET-1 구현 시 아래 중 하나를 선택(또는 조합)해야 한다:

- **옵션 1. 프롬프트 내재화**: `buildSystemPrompt()`에 "사용자가 종료를 원하면(자연어로 표현하면) 더 묻지 말고 곧바로 최종 결론을 내라"는 지시를 추가하고, 결과적으로 해당 턴의 응답에 후속질문 섹션이 비게 됨(`splitFollowUpSection()`의 `followUpQuestionsText === null`)을 "이번 턴은 종료됨"의 판정 신호로 재사용. **장점**: 추가 API 호출 없음, 기존 함수 재사용. **단점**: "질문이 정말 없어서" 안 나온 것과 "사용자가 종료를 원해서" 안 나온 것을 구분하지 못함(둘 다 UI 동작은 같으므로 실질적 문제는 없을 수 있음).
- **옵션 2. 별도 분류 프롬프트**: 사용자의 매 턴 발화를 AI에게 별도로 "이 발화가 대화 종료를 원하는 의도인가?"만 짧게 묻는 추가 호출을 두고, 그 결과에 따라 분기. **장점**: 종료 의도 판별이 명시적이고 오탐 원인 추적이 쉬움. **단점**: 매 턴 API 호출이 2배로 늘어(로컬 엔진이라 비용은 없지만 지연 시간 증가), 구조가 복잡해짐.
- **옵션 3. 하이브리드**: 옵션 1을 기본으로 하되, 프롬프트에 "사용자가 종료를 원하면 응답 맨 앞에 정해진 표시(예: 내부 처리용 접두어)를 붙이라"는 지시를 추가해 코드가 그 표시만 벗겨내고 판정. **주의**: 이는 "마커 방식"에 가까워질 수 있어 `requirements.md` §2.2의 "마커 방식 미채택" 확정과 긴장 관계가 있음 — 채택 시 사용자에게 "겉보기엔 자연어이나 내부적으로 약한 마커를 쓴다"는 점을 명확히 알리고 재확인받아야 함(임의 채택 금지).

TICKET-1 문서에서 이 세 옵션을 다시 제시하고, 구현자가(또는 사용자 재확인 후) 하나를 선택하는 절차를 명시한다.

### 4.4 상담사 "충분함" 버튼 — 최종 진단 강제 트리거 (확정 가능, 낮은 위험)

"충분함" 버튼 클릭은 AI 판단을 기다리지 않고 **즉시** 최종 진단 요청을 보낸다. 이는 기존 `isFollowUp=true` 2차 분석 모드(후속질문 섹션 생략, 최종 결론만)와 사실상 동일한 프롬프트 모드이므로, `buildSystemPrompt()`에 `forceConclusion` 같은 별도 플래그를 하나 더 두어(`isFollowUp`과는 별개 개념 — 대화 중 어느 시점에서든 강제 종결 가능해야 함) 재사용하는 방향으로 TICKET-1에서 확정한다. 이 부분은 요구사항이 이미 확정한 동작(§2.2 "먼저 오는 쪽이 우선")을 구현하는 세부 설계일 뿐이라 임의 결정 범주에 들지 않는다.

### 4.5 `sessionStorage` 스키마 방어 — 권고 수준만 확정, 구체 방식 미확정

`requirements.md` §4가 명시한 대로, "파싱 실패 시 조용히 새 대화로 시작"이라는 **권고만** 확정하고 버전 필드 부여 여부·정확한 검증 로직은 TICKET-3에서 정한다(예: 단순 `Array.isArray()` + 각 항목 `role`/`text` 필드 존재 확인 정도의 얕은 검증도 가능, 별도 `schemaVersion` 필드를 두는 것도 가능 — 둘 다 열어둠).

## 5. 위험 지점

| # | 위험 | 영향 티켓 | 완화 방향 |
|---|---|---|---|
| 1 | `buildSystemPrompt()`의 `isFollowUp` 이분법(`js/ai.js:126-178`)을 다회 순환 + 자연어 종료 인식 + "충분함" 강제 종결(§4.4) 세 가지를 모두 지원하도록 재설계 — 설계가 꼬이면 후속질문이 무한 반복되거나 최종 결론이 안 나오는 회귀 위험 | TICKET-1 | 프롬프트 모드를 "진행 중(후속질문 가능)" / "강제 종결(충분함 버튼)" 두 플래그로 명확히 분리하고, AI 자체 판단에 의한 종료는 옵션 1~3(§4.3) 중 선택한 메커니즘이 "진행 중" 모드의 응답을 사후 검사하는 방식으로 설계 |
| 2 | 종료 의도 감지 메커니즘 미확정(§4.3) — 어떤 옵션을 선택하든 오탐(사용자가 종료를 원치 않았는데 종료)·미탐(명확히 원했는데 못 알아챔) 리스크 존재(요구사항 §5 "테스트 필수 대상" 1순위로 명시) | TICKET-1, TICKET-3 | TICKET-1 구현 시 선택한 옵션을 문서에 남기고, TICKET-3의 테스트 항목에 오탐/미탐 케이스를 구체적 예시 발화로 명시 |
| 3 | `N_CTX=4096`(`js/ai.js:31`) 컨텍스트 한도 — 요약 압축 없이 전체 누적 전달(§2.7 확정)이므로 대화가 길어지면 한도 초과 가능 | TICKET-1 | 초과 시 처리(오래된 턴 잘라내기 등)는 이번 트랙에서 확정하지 않되, 최소한 오류 없이 "대화가 길어져 응답이 불완전할 수 있습니다" 수준의 안내로 조용히 실패하지 않게 방어(TICKET-1 최소 요건) |
| 4 | `conversation` 배열의 모듈 소유권 문제(§4.2) — `js/ai-ui.js`(module) ↔ `js/main.js`(비-module) 브릿지 설계 실수 시 "결과 저장" 시 소견 또는 최종 진단이 누락되는 회귀(과거 "저장 시 소견 누락" 버그와 동일 계열, 요구사항 §5 명시) | TICKET-3, TICKET-4 | `window.__hututiChat` 브릿지 부재 시에도 `saveResult()`가 예외 없이 "(대화 내용을 불러올 수 없습니다)" 등으로 방어적으로 동작하도록 `window.__hututiEngine` 기존 패턴(`js/main.js:311-321`)을 그대로 답습 |
| 5 | `js/ai-ui.js`가 이미 580행(엔진 선택·실패 배너 로직 82~410행 포함)인 상태에서 채팅 이벤트 루프를 같은 파일에 추가 — 변수명 충돌(`lastNoteText` 등 삭제 대상과 신규 `conversation` 변수), DOM 참조 취득부(82~109행)의 일부만 교체하며 나머지(엔진 관련)를 실수로 건드릴 위험 | TICKET-3 | 82~410행(엔진 선택·실패 배너)은 **읽기만 하고 수정하지 않음**을 티켓 문서에 명시, 신규 채팅 로직은 별도 함수로 캡슐화해 `DOMContentLoaded` 핸들러 안에서 기존 블록과 나란히(뒤섞이지 않게) 배치 |
| 6 | `fitNotesActionsRow()`(`js/ai-ui.js:529-579`)가 `.notes-actions` 셀렉터를 대상으로 동작 — 채팅 UI 전환 후에도 `#clear-notes-btn`/`#save-result-btn`/`#engine-select-btn`이 `.notes-actions` 안에 남는지, 아니면 채팅 입력창 쪽으로 이동하는지에 따라 이 로직이 계속 유효할지 갈림 | TICKET-2, TICKET-3 | TICKET-2에서 `.notes-actions`(또는 대체 컨테이너)의 최종 위치를 명확히 정하고, TICKET-3에서 `fitNotesActionsRow()` 대상 셀렉터가 여전히 유효한지 확인 |
| 7 | `#clear-notes-btn`의 의미 변화 — "소견 지우기"(현재)에서 "대화 초기화"(채팅 UI에서 자연스러운 대응 동작)로 실질적 기능이 바뀌지만, 이는 요구사항 문서가 명시적으로 확정한 항목이 아님 | TICKET-4 | 버튼 자체를 유지하되 라벨·동작(대화 전체 초기화 + `sessionStorage` 클리어)을 TICKET-4에서 재정의하고, 완료 보고 시 이 판단을 사용자에게 명시적으로 알림(임의 확정 아님을 투명하게) |
| 8 | `saveResult()`(`js/main.js:288-333`)의 소견 누락 방어 로직(`:298`, `$notesInput` 참조)이 `#notes-input` 제거로 전제가 무너짐 — 과거 버그(`requirements.md` §1)가 다른 형태로 재발할 위험 | TICKET-4 | `conversation[0].text`를 새로운 단일 진실 소스로 명확히 고정하고, `window.__hututiChat` 브릿지 부재까지 포함한 3단 방어(정상 → 브릿지 없음 → 대화 없음) 순서로 재작성 |
| 9 | `?v=` 캐시 버스팅 값 갱신 누락 — `index.html`의 `js/main.js?v=7`, `js/ai-ui.js?v=27`과 `js/ai-ui.js:5`의 `./ai.js?v=15` 세 지점 모두 각 티켓에서 갱신 필요 | TICKET-1~4 전체 | 각 티켓 완료 기준에 "버전 쿼리 갱신 완료" 항목 명시 |
| 10 | Ollama/wllama 엔진이 대화 진행 중 전환되는 경우(`currentEngine()` 판정 변화, 요구사항 §5 명시) — 이미 누적된 `conversation` 배열은 엔진과 무관한 순수 텍스트 배열이므로 이론적으로는 문제없어야 하나, `updateEngineDisplay()`가 매 응답마다 갱신되는지 채팅 루프에서도 빠짐없이 호출되는지 확인 필요 | TICKET-3 | 채팅 응답 수신 콜백 안에 `updateEngineDisplay()` 호출을 반드시 포함(기존 두 호출부 `:485`, `:514`와 동일한 지점에 대응하는 신규 콜백 안) |

## 6. 의존성 그래프 및 스프린트 그룹핑

```
Sprint 1 (로직 기반 — UI 없음)
  TICKET-1 (js/ai.js — analyzeWithAI 재설계 + 종료판정 프롬프트)

Sprint 2 (골격 — Sprint 1과 파일 겹치지 않아 이론상 병행 가능하나, 단일 에이전트 순차 구현 원칙 유지)
  TICKET-2 (index.html + css/style.css — 채팅 UI 마크업·스타일 골격, 로직 없음)

Sprint 3 (행동 — Sprint 1·2 완료 후 시작, 이번 트랙 최대 위험 지점)
  TICKET-3 (js/ai-ui.js — 채팅 이벤트 루프 + sessionStorage 저장/복원 + 종료조건 소비)

Sprint 4 (저장 — Sprint 3의 브릿지에 의존)
  TICKET-4 (js/main.js — saveResult()/clearNotes() 재구성)
```

**실행 순서**: TICKET-1 → TICKET-2 → TICKET-3 → TICKET-4 (전부 순차). TICKET-1·TICKET-2는 서로 다른 파일이라 병렬 착수도 가능하지만, TICKET-3이 두 티켓의 산출물(신규 `analyzeWithAI` 시그니처 + 신규 DOM 구조)을 동시에 소비하므로 순서 자체보다 "TICKET-3 착수 전 1·2 모두 완료" 조건이 중요하다. 순차 구현을 기본 원칙으로 유지한다(engine-selector 트랙과 동일한 방침).

## 7. 공유 수정 파일 매트릭스

| 파일 | TICKET-1 | TICKET-2 | TICKET-3 | TICKET-4 |
|---|---|---|---|---|
| `js/ai.js` | ✅ | - | - | - |
| `index.html` | - | ✅(구조) | ✅(버전쿼리만) | - |
| `css/style.css` | - | ✅ | - | - |
| `js/ai-ui.js` | - | - | ✅ | - |
| `js/main.js` | - | - | - | ✅ |

`js/ai-ui.js`는 TICKET-3 하나만 수정하지만, 82~410행(엔진 선택·실패 배너, engine-selector 산출물)은 **읽기 전용 참조만** 하고 실질 수정은 하지 않는다는 점을 각주로 남긴다(§5 위험 #5).

## 8. 테스트 계획 (스프린트별, `tester` 에이전트 실행 기준)

빌드 시스템 없는 순수 정적 HTML/JS 프로젝트이므로 `npm run build` 등은 없다. 로컬 정적 서버로 `index.html`을 열고 브라우저 콘솔·수동 조작으로 검증한다.

**Sprint 1 완료 시 (TICKET-1, UI 미반영)**
- 콘솔에서 `analyzeWithAI(conversation, onProgress)`를 새 배열 인자로 직접 호출해 기존과 동일하게 Ollama/wllama 양쪽 경로가 회귀 없이 동작하는지 확인.
- 대화 배열을 인위적으로 3~4턴 누적시켜 호출했을 때 `/api/chat`·wllama `messages` 배열에 실제로 전체 히스토리가 실리는지(네트워크 탭·콘솔 로그로) 확인.
- "충분함" 강제 종결 모드(§4.4)로 호출 시 후속질문 섹션 없이 최종 결론만 나오는지 확인.
- 선택한 종료 감지 옵션(§4.3)에 따라, "그만 물어봐 주세요" 류 발화를 마지막 턴에 넣었을 때 응답이 실제로 후속질문 없이 종료되는지 확인.

**Sprint 2 완료 시 (TICKET-2, 정적 마크업만)**
- 채팅 컨테이너·말풍선·입력창·"충분함" 버튼이 화면에 정상 렌더링되는지(빈 상태 목업 데이터로 육안 확인, JS 로직 없이 정적 확인).
- 반응형(모바일 폭)에서 레이아웃이 깨지지 않는지.

**Sprint 3 완료 시 (TICKET-3, 채팅 루프 + 영속화 반영)**
- **대화 종료 조건 경합**: AI 자체 판단 신호와 "충분함" 버튼 클릭이 거의 동시에 발생할 때 실제로 먼저 온 쪽이 우선 적용되는지(요구사항 §5 1순위 항목).
- **자연어 종료 의도 오탐/미탐**: 종료를 원하지 않는 발화("그런데 혹시 하나 더 확인해볼까요?")에서 오판하지 않는지, 명확히 종료를 원하는 발화에서 놓치지 않는지(요구사항 §5 2순위).
- **컨텍스트 한도 초과 처리**: 대화를 인위적으로 길게 만들어(10턴 이상) `N_CTX` 한도 근접·초과 시 오류 없이 처리되는지.
- **`sessionStorage` 저장·복원 정확성**: 새로고침, `checklist.html`/`icd11.html`/`about.html` 왕복 후 대화가 순서·역할·내용 손실 없이 이어지는지. 새 탭에서는 대화가 비어 있는지(세션 격리 확인).
- **스키마 불일치 방어**: `sessionStorage` 값을 브라우저 콘솔에서 강제로 손상시킨 뒤 새로고침 시 오류 없이 [빈 대화 상태]로 시작하는지.
- **엔진 전환 시 대화 일관성**: 대화 진행 중 Ollama를 껐다 켰을 때 `updateEngineDisplay()`가 매 응답마다 갱신되고 대화 자체는 깨지지 않는지.
- **기존 엔진 선택·실패 배너 회귀 확인**: 이번 트랙이 82~410행을 건드리지 않았는지, "AI 선택다운" 버튼·팝오버·다운로드 확인 다이얼로그가 여전히 정상 동작하는지(회귀 없음이 최우선).
- 조립 검증: `window.__hututiChat` 브릿지가 선언한 대로 콘솔에서 호출 가능한지.

**Sprint 4 완료 시 (TICKET-4, 저장 로직)**
- **결과 저장 데이터 무결성**: "최초 소견 + 최종 진단 결과"가 실제로 빠짐없이 `.txt`에 포함되는지(과거 "저장 시 소견 누락" 버그 재발 방지, 요구사항 §5 4순위).
- **`window.__hututiChat` 부재 시 방어 동작**: 브릿지가 없는 예외 상황을 콘솔에서 인위적으로 만들어 `saveResult()`가 오류 없이 방어적으로 동작하는지.
- **"가진단 받기" 제거 회귀 확인(재확인)**: `clearNotes()`/`initAssistPage()` 재작성이 이미 제거된 키워드 기반 가진단 관련 잔재를 되살리지 않는지(요구사항 §5 5순위).
- **`#clear-notes-btn` 재정의 동작 확인**: 클릭 시 대화 전체 초기화 + `sessionStorage` 클리어가 실제로 함께 일어나는지.

## 9. 아키텍처 문서 갱신 계획

별도 아키텍처 문서 체계(`{{ARCHITECTURE_DIR}}`)가 없는 순수 정적 프로젝트임을 `requirements.md` §6·`structure.md` §7에서 이미 확인했다. 이 트랙 완료 후 별도 아키텍처 문서 갱신 대상은 없다. 다만 `js/ai.js`의 `analyzeWithAI()` 시그니처가 "소견 1개+답변 1개" → "대화 배열 전체"로 바뀌는 구조적 변경이므로, 코드 상단 헤더 주석(`js/ai.js:1-19`)과 `js/main.js:1-10` 헤더 주석에 이 변경을 반영해 향후 재조사 시 혼선이 없게 한다(각 관련 티켓의 완료 기준에 포함).

## 10. 검증 체크리스트

- [x] 요구사항 재확인(§1~2) — `requirements.md`·`structure.md` 및 실제 코드 5개 파일 재확인 완료(engine-selector 병합 후 최신 상태 기준)
- [x] 영향 파일·레이어 전수 조사(§3)
- [x] 핵심 설계 결정(§4) — 브릿지 방향(§4.2)·"충분함" 강제 종결(§4.4)은 확정, 그라운딩 재계산 범위(§4.1)는 TICKET-1 위임, 종료 감지 메커니즘(§4.3)·스키마 방어(§4.5)는 요구사항 지시대로 미확정 유지
- [x] 위험 지점 식별(§5) — 10건
- [x] 의존성 그래프·스프린트 그룹핑(§6) — 순차 4티켓
- [x] 공유 수정 파일 매트릭스(§7)
- [x] 테스트 계획(§8) — 스프린트별
- [x] 아키텍처 문서 갱신 계획(§9) — 해당 없음(코드 헤더 주석 갱신으로 대체)
- [x] 사용자 확인 완료 — TICKET-1부터 순차로 티켓 문서(01~04) 작성 완료

## 11. 티켓 목록

| # | 티켓명 | 파일 |
|---|---|---|
| TICKET-1 | `analyzeWithAI()` 대화 배열 재설계 + 종료판정 프롬프트 | `js/ai.js` |
| TICKET-2 | 채팅 UI 마크업·스타일 골격 | `index.html`, `css/style.css` |
| TICKET-3 | 채팅 이벤트 루프 + `sessionStorage` 영속화 | `js/ai-ui.js` |
| TICKET-4 | 결과 저장·초기화 로직 재구성 | `js/main.js` |
