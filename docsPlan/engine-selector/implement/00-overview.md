# 00-overview.md — engine-selector 구현 계획 개요

> 근거 문서: `docsPlan/engine-selector/requirements.md`, `docsPlan/engine-selector/structure.md`
> 코드베이스 전수 조사: `index.html`, `js/ai.js`, `js/ai-ui.js`, `js/main.js`, `css/style.css` 재확인 완료(본 계획 작성 시점)
> 이 문서는 계획 문서입니다. 코드는 작성하지 않습니다.

---

## 1. 요구사항 요약 (재확인)

"결과 저장" 버튼 옆에 AI 엔진(생각과정 없음/있음) 선택 버튼을 추가하고, 동시에 이번 조사로 드러난 세 가지 문제를 같은 화면 영역이므로 한 트랙으로 묶어 해결한다:

1. `<h2>AI 분석 결과 (Kanana)</h2>`(`index.html:83`)와 저장 텍스트(`js/main.js:461`)가 실제 엔진과 무관하게 "Kanana"로 하드코딩된 버그.
2. `detectOllama()`(`js/ai.js:187-202`)가 모든 실패 원인을 `catch(e){ollamaAvailable=false}` 한 줄로 뭉개 사용자에게 실패 이유를 알리지 않는 문제.
3. 신규: 생각과정 없음(`qwen3:4b-instruct`, 현재 기본)/있음(`qwen3:4b-thinking`) 중 선택 → 미설치 시 앱이 `/api/pull`을 직접 호출해 자동 다운로드(용량 경고 문구 선행) → 토큰 한도 파라미터화.

B안(버튼 1개 → 클릭 시 옵션 노출), 안2(Ollama 미감지 시 버튼 비활성화 + 기존 모달 재사용), 자동 다운로드 채택, 용량 경고 노출은 모두 `requirements.md`에서 확정되어 있다. 남은 미결정은 `/api/pull` 스트리밍 진행률 제공 여부(§4 참고) 하나뿐이다.

## 2. 코드베이스 재확인 결과 (현재 상태 정확한 재기록)

- `js/ai.js:183` `const OLLAMA_MODEL = 'qwen3:4b-instruct';` — 모듈 상수로 고정, 재대입 불가.
- `js/ai.js:185` `let ollamaAvailable = null;` — **한 번 확정되면 페이지 세션 내내 재검사되지 않는다**(`detectOllama()`가 `ollamaAvailable !== null`이면 즉시 캐시값 반환, `js/ai.js:188`). 모델을 여러 개 다루게 되면 이 단일 boolean 캐시 구조 자체를 바꿔야 한다(§5 위험 지점 참고).
- `js/ai.js:187-202` `detectOllama()` — `/api/tags` 호출 → `catch(e){ollamaAvailable=false}`(`:199`)로 모든 실패를 뭉갬. `e` 객체는 어디에도 보존되지 않는다.
- `js/ai.js:213-232` `analyzeWithOllama()` — `num_predict: 1800`(`:226`) 고정.
- `js/ai.js:281-283` `currentEngine()` — `ollamaAvailable === true ? 'ollama' : 'browser'`. export 되어 있어 `js/ai-ui.js`(module)에서는 바로 import 가능하지만 `js/main.js`(비-module, `index.html:161` `<script src="js/main.js?v=5">`)에서는 import 불가.
- `js/ai.js:297-323` `analyzeWithAI()` — `max_tokens: 1800`(`:318`, wllama 경로).
- `js/ai-ui.js:1` — `import { analyzeWithAI, isModelReady, currentEngine, splitFollowUpSection, detectOllama } from './ai.js?v=12';` — module 스크립트, `index.html:162` `<script type="module" src="js/ai-ui.js?v=19">`.
- `js/ai-ui.js:155-160`, `:189-194` — `#ai-mode-badge` 텍스트를 `currentEngine()` 결과로 갱신하는 두 지점. `<h2>`(`#ai-result-card` 안, `index.html:83`)는 이 갱신 로직이 없어 항상 "(Kanana)" 그대로 남는다. **`id` 자체가 없어 새로 부여해야 한다.**
- `index.html:63-71` `.notes-actions` — `#analyze-btn`, `#ai-analyze-btn`, `#clear-notes-btn`, `#save-result-btn` 순서로 `.btn.btn-compact` 배치. `.notes-actions`(`css/style.css:287-293`)는 `flex-wrap:nowrap` — 버튼을 하나 더 추가하면 좁은 화면에서 가로 오버플로 위험이 있음(§5).
- `index.html:73-77` `#ai-engine-info-btn` → `index.html:122-158` `#ai-engine-modal-overlay`(기존 "AI 엔진 안내" 모달, `ollama.com/download` 링크·`ollama pull qwen3:4b-instruct` 안내 이미 포함) — 그대로 재사용 대상.
- `js/main.js:443-486` `saveResult()` — `:461`에 `'[AI 분석 결과 (Kanana, 브라우저 내 로컬 AI)]'` 하드코딩. `js/main.js` 전체가 `(function(){ 'use strict'; ... })()` 단일 IIFE(비-module)로, `checklist.html` 페이지 로직(`initChecklistPage`)도 같은 파일에 있음.
- `css/style.css:294-299` `.btn-compact`, `:306-402` 기존 엔진 안내 모달 스타일. 팝오버·툴팁·비활성화(disabled) 버튼 스타일은 아직 없음(신규 작성 필요).

## 3. 영향 파일 및 레이어

| 파일 | 레이어 | 이번 트랙에서의 역할 |
|---|---|---|
| `js/ai.js` | AI 연동 로직(module) | 모델 레지스트리·선택 상태·토큰 파라미터화·`/api/pull` 호출·`detectOllama()` 실패 분류 재설계·전역 브릿지 노출 |
| `js/ai-ui.js` | 이벤트/UI 로직(module) | 엔진 선택 버튼·팝오버·툴팁·다운로드 확인 다이얼로그·실패 배너·디버그 토글의 이벤트 바인딩, `<h2>` 동적 갱신 |
| `js/main.js` | 비-module 애플리케이션 로직(IIFE) | `saveResult()`의 저장 텍스트 동적화 |
| `index.html` | 마크업 | 신규 버튼·팝오버·다이얼로그·배너 DOM, `<h2>`에 `id` 부여, `<script>` 버전 쿼리(`?v=`) 갱신 |
| `css/style.css` | 스타일 | 신규 컴포넌트 스타일(팝오버·툴팁·비활성화·배너·디버그 토글) |

레이어 교차: AI 연동(ai.js) + 이벤트 로직(ai-ui.js) + 비-module 로직(main.js) + 마크업(index.html) + 스타일(css) — 5개 파일, 4개 레이어. `symptom-chat-interview`와 파일이 겹치지만(`js/ai.js`, `js/ai-ui.js`, `index.html`) 이 트랙을 먼저 구현하기로 확정되어 있으므로 여기서는 고려하지 않는다.

## 4. 핵심 설계 결정 (impl-planner 단계 확정 사항)

### 4.1 `js/main.js`(비-module)에서 `currentEngine()`을 쓰는 방법 — **전역 브릿지 방식 채택**

`requirements.md`가 명시한 미해결 구조적 제약: `js/main.js`는 `<script src="js/main.js">`(비-module)이라 `js/ai.js`의 `export function currentEngine()`을 `import`로 가져올 수 없다.

**검토한 두 방안**:

| 방안 | 내용 | 채택 여부 |
|---|---|---|
| A. 전역 브릿지 | `js/ai.js` 모듈 최상위 스코프(함수 바깥, 톱레벨)에서 `window.__hututiEngine = { currentEngine, getModelLabel }` 형태로 필요한 함수만 전역에 노출. `js/main.js`는 `window.__hututiEngine.currentEngine()`으로 호출 | **채택** |
| B. `js/main.js` 자체를 `type="module"`로 전환 | `index.html:161`의 `<script src="js/main.js?v=5">`를 `type="module"`로 바꾸고 `import { currentEngine } from './ai.js'` | 기각 |

**B를 기각한 이유**: `js/main.js`는 `checklist.html` 페이지 로직(`initChecklistPage`, 526행 근처)까지 포함한 단일 IIFE 파일이며, 엔진 선택 기능과 무관한 `checklist.html`에는 `js/ai.js`가 아예 로드되지 않는다(체크리스트 페이지에 AI 연동 없음). `main.js`를 통째로 module로 바꾸면 (1) module 스크립트는 defer와 동일하게 지연 실행되어 `data.js`·기존 스크립트 로드 순서에 영향을 줄 수 있고, (2) `checklist.html`이 `js/main.js`를 그대로 재사용한다면 그 페이지에도 영향이 번지며, (3) 이 트랙의 목적(엔진 선택 기능)에 비해 변경 반경이 과도하다. 최소 변경 원칙에 따라 A(전역 브릿지)를 채택한다.

**타이밍 안전성**: `js/ai.js`는 `js/ai-ui.js`(module, `index.html:162`)가 import하며 로드된다. module 스크립트는 파서가 문서를 다 읽은 뒤 `DOMContentLoaded` 발생 **전**에 실행되는 것이 스펙 동작이다. `js/main.js`(비-module, `index.html:161`, `ai-ui.js`보다 먼저 위치)는 파싱 중 즉시 실행되지만 `saveResult()` 자체는 `#save-result-btn` 클릭 이벤트 핸들러 안에서만 호출되므로(`initAssistPage()`, `DOMContentLoaded` 리스너 내부, `js/main.js:493-495`), 실제 클릭 시점에는 `js/ai.js` 모듈의 톱레벨 코드가 이미 실행되어 `window.__hututiEngine`이 존재함이 보장된다. 다만 방어적으로 `js/main.js`에서는 `window.__hututiEngine && window.__hututiEngine.currentEngine ? ... : '(엔진 확인 불가)'` 형태로 안전 접근한다(TICKET-4에서 구현 상세 확정).

### 4.2 다중 모델 상태로의 전환 — `ollamaAvailable` 단일 boolean 캐시 폐기

현재 `ollamaAvailable`(전역 module 변수, 한 번 확정되면 세션 내내 캐시)은 **모델 1개**를 전제로 설계되어 있다. 두 모델(`qwen3:4b-instruct`/`qwen3:4b-thinking`)을 다루고 사용자가 다운로드 후 즉시 전환해야 하므로, 이 캐시 구조를 아래처럼 일반화한다(정확한 변수명·자료구조는 TICKET-1에서 확정):

- `/api/tags` 응답의 설치된 모델 목록 자체를 상태로 보존(예: `installedModelNames: Set<string>`).
- "지금 선택된 모델이 설치돼 있는가"는 이 목록에서 매번 파생 계산.
- `/api/pull` 성공 후에는 캐시를 무효화하고 `/api/tags`를 재호출해 목록을 갱신(현재처럼 최초 1회만 확정하고 끝나지 않도록).
- Ollama 자체의 연결 가능 여부(연결 성공/실패)와 "선택한 모델이 설치돼 있는가"는 별개 축이므로 상태를 분리(§5 위험 지점 참고, TICKET-2와 연결).

### 4.3 `/api/pull` 진행률 — 미결정 유지, 설계는 이원화

`requirements.md` §5-1이 명시한 유일한 남은 미결정: Ollama `/api/pull`의 스트리밍 진행률 제공 여부는 이 계획 문서에서 **확정하지 않는다**. TICKET-3에 "실제 API 호출로 스트리밍 여부를 먼저 확인하는 단계"를 선행 작업으로 명시하고, 결과에 따라 두 경로로 분기하도록 설계한다:
- 스트리밍 확인됨 → `ensureModelLoaded()`의 `onProgress` 콜백 패턴(`js/ai.js:245-274`) 및 `js/ai-ui.js`의 `formatBytes`/`formatRemaining`을 재사용해 진행률 UI 구성.
- 스트리밍 미확인/불가 → 완료될 때까지 "다운로드 중입니다..." 같은 불확정 상태 표시로 대체.

### 4.4 분석 시도 시점의 Ollama 상태 재검사 정책 (계획 리뷰 반영, 신규)

**리뷰에서 지적된 공백**: `analyzeWithAI()`(`js/ai.js:297-323`) 내부의 `detectOllama()` 호출(`:307`)은 TICKET-2가 도입하는 `forceRefresh` 인자를 넘기지 않는다. TICKET-3(`/api/pull` 성공 후)과 TICKET-4(모달 오픈 시)만 강제 재검사를 트리거하므로, "세션 초반 Ollama 감지 → 이후 사용자가 Ollama를 끔 → 재검사 트리거 없이 다음 'AI 분석' 클릭"이라는 흔한 경로에서 캐시된 `true`를 그대로 믿고 `analyzeWithOllama()`를 시도해 fetch가 실패한다. `requirements.md` §6·TICKET-4 테스트 항목이 명시한 "분석 도중 Ollama 종료" 통과 조건과 정면으로 모순되므로, 이 공백을 명시적으로 TICKET-2의 스코프에 편입한다(§ 아래 위험 #1 갱신, TICKET-2 문서 §5 참고).

**설계 방향(정확한 구현 방식은 impl 단계에서 확정)**: `analyzeWithAI()`가 Ollama 경로를 시도하기 직전 또는 `analyzeWithOllama()` 호출이 실패했을 때 중 하나의 시점에 `detectOllama(true)`로 재검사하고, 재검사 결과도 실패면 조용히 wllama(Kanana)로 폴백한다. "매 분석 시도마다 항상 강제 재검사"(정확하지만 매번 15초 타임아웃 위험 재노출, §5 위험 #10과 상충 가능)와 "1차 시도 실패 시에만 재검사 후 폴백"(빠르지만 실패 원인 파악에 한 박자 늦음) 두 방식의 트레이드오프를 TICKET-2 구현 시 결정한다.

## 5. 위험 지점

| # | 위험 | 영향 티켓 | 완화 방향 |
|---|---|---|---|
| 1 | `ollamaAvailable` 단일 boolean 캐시 폐기 및 재설계 — 기존 `detectOllama()` 호출부(`js/ai-ui.js:61`, `js/ai.js:307`)가 반환 타입 변경에 영향받음. 특히 `js/ai.js:307`(`analyzeWithAI()` 내부 호출)은 어떤 티켓에서도 강제 재검사로 바뀌지 않으면 "분석 도중 Ollama 종료" 시나리오에서 캐시된 값을 오신뢰함(§4.4 참고) | TICKET-2 | 반환 타입(boolean 유지 여부, 또는 `{connected, modelInstalled}` 객체로 확장)과 `detectOllama(forceRefresh)` 시그니처를 TICKET-2에서 확정하고, `js/ai-ui.js:61`(TICKET-4가 갱신)·`js/ai.js:307`(TICKET-2 자체 범위, §4.4) 두 호출부 모두 재검사 정책을 갖도록 함께 갱신 |
| 2 | `js/ai.js`가 TICKET-1·2·3·4(브릿지) 네 티켓에서 순차적으로 수정됨 — 동일 파일 중복 수정으로 인한 diff 충돌 위험 | TICKET-1~4 | **엄격한 순차 구현**(1→2→3→4) 강제, 각 티켓 시작 전 파일 최신 상태 재확인 |
| 3 | `js/ai-ui.js`·`index.html`·`css/style.css`가 TICKET-4·5·6 세 티켓에서 순차적으로 수정됨 | TICKET-4~6 | 순차 구현(4→5→6), TICKET-5가 만든 DOM 구조(팝오버 위치 등)를 TICKET-6이 참조하므로 역순 금지 |
| 4 | `<script src="js/ai-ui.js?v=12">`(ai.js를 가리키는 쿼리, `js/ai-ui.js:1`) 및 `index.html:161-162`의 `?v=` 캐시 버스팅 값을 각 티켓에서 잊지 않고 올려야 함 — 안 올리면 브라우저가 이전 캐시된 스크립트를 계속 씀 | TICKET-1~6 전체 | 각 티켓 완료 기준에 "버전 쿼리 갱신 완료" 항목 명시(각 티켓 문서에 반영) |
| 5 | `.notes-actions`(`css/style.css:287-293`)가 `flex-wrap:nowrap` — 버튼 5개(`분석/AI 분석/지우기/저장/엔진 선택`)가 되면 좁은 화면에서 가로 오버플로 가능 | TICKET-5 | TICKET-5에서 좁은 뷰포트 대응(줄바꿈 허용 또는 아이콘화) 검토 항목으로 명시 |
| 6 | `/api/pull` 자동 트리거는 수 GB 다운로드 — 실패(네트워크 끊김·디스크 부족 등) 시 사용자에게 알리는 처리 누락 시 "멈춘 것처럼 보이는" UX 위험 | TICKET-3, TICKET-5 | TICKET-3에서 `/api/pull` 호출부에 명시적 에러 핸들링(실패 사유를 TICKET-2의 실패 분류 상태와 동일한 형태로 노출) 포함 |
| 7 | `qwen3:4b-thinking` 실사용 시 토큰 한도(§3.5) 상향값이 추정치 — 값이 부족하면 기존에 겪었던 "생각 과정이 끝나기 전에 잘리는" 문제가 재발 가능 | TICKET-1, TICKET-3 | 정확한 값을 코드에 하드코딩하지 않고 모델별 파라미터로 분리해두어(§4의 모델 레지스트리) 추후 값만 조정 가능하게 설계. 실측은 TICKET-3 테스트 단계에서 실제 `qwen3:4b-thinking` 응답으로 검증 |
| 8 | 다운로드 용량 경고 문구의 정확한 GB 수치 미확정 — 틀린 수치 표시 시 사용자 신뢰 저하 | TICKET-3, TICKET-5 | TICKET-3에서 `/api/pull` 응답의 `total` 필드(스트리밍 확인 시) 또는 Ollama 라이브러리 페이지 실측치로 정확한 값을 확정, 확정 전까지는 "약 수 GB"처럼 근사 표현 사용 |
| 9 | `cleanModelOutput()`(`js/ai.js:206-211`)이 `<think>...</think>`를 정규식으로 제거하는데, 응답이 토큰 한도에 걸려 `</think>` 태그가 닫히지 않은 채 잘리면 정규식이 매치되지 않아 생각 과정 원문이 그대로 사용자에게 노출됨 — §3.9의 미제 사례·과거 "내용이 너무 많다" 경험과 직접 연관 | TICKET-1, TICKET-3 | 토큰 한도 상향(위험 #7)과 함께, `</think>`가 없이 잘린 경우를 대비한 방어적 처리(예: 미종결 `<think>` 이후 전체를 별도 표시하거나 잘림 경고)를 TICKET-3에서 검토 |
| 10 | `detectOllama()`의 15초 타임아웃(`js/ai.js:193`, "권한 창이 뜨는 시간까지 감안"한 의도적 설계)을 TICKET-5가 페이지 로드 시(`DOMContentLoaded`) 자동 실행하면, Ollama를 아예 안 쓰는 다수 사용자도 페이지 진입 시마다 최대 15초간 이 요청이 백그라운드에서 도는 상태가 됨 — 이 자체는 정상 동작이나, 페이지 로딩 스피너·초기 렌더를 이 응답으로 막는 형태로 구현하면 절대다수 사용자의 초기 UX가 나빠짐 | TICKET-5 | `detectOllama()`를 `await`로 페이지 렌더를 막는 대신, `DOMContentLoaded` 이후 비차단(fire-and-forget)으로 백그라운드 호출하고 결과가 오는 대로 버튼 상태(`disabled` 여부)만 갱신. 로딩 스피너로 전체 페이지를 막지 않음 |

## 6. 의존성 그래프 및 스프린트 그룹핑

```
Sprint 1 (js/ai.js 핵심 로직 — UI 없음)
  TICKET-1 (모델 레지스트리·선택 상태·토큰 파라미터화)
      ↓
  TICKET-2 (detectOllama 실패 분류 재설계, TICKET-1의 상태 구조 위에 구축)
      ↓
  TICKET-3 (/api/pull 자동 다운로드, TICKET-1·2의 상태·에러 분류 재사용)

Sprint 2 (화면 반영 — Sprint 1 완료 후 시작)
  TICKET-4 (엔진 표시 버그 수정 + 전역 브릿지, TICKET-1의 currentEngine 확장분 반영)
      ↓
  TICKET-5 (엔진 선택 버튼 UI — 팝오버/툴팁/설치됨 표시/다운로드 확인 다이얼로그, TICKET-1~4 전체 API 소비)
      ↓
  TICKET-6 (Ollama 실패 안내 배너 + 디버그 정보 토글 UI, TICKET-2의 실패 분류 상태 소비, TICKET-5가 만든 DOM 구조 위에 추가)
```

**실행 순서**: TICKET-1 → TICKET-2 → TICKET-3 → TICKET-4 → TICKET-5 → TICKET-6 (전부 순차, 병렬 구간 없음 — 공유 파일이 많아 병렬화 시 충돌 위험이 이득보다 큼).

## 7. 공유 수정 파일 매트릭스

| 파일 | TICKET-1 | TICKET-2 | TICKET-3 | TICKET-4 | TICKET-5 | TICKET-6 |
|---|---|---|---|---|---|---|
| `js/ai.js` | ✅ | ✅ | ✅ | ✅(브릿지만) | - | - |
| `js/ai-ui.js` | - | - | - | ✅ | ✅ | ✅ |
| `js/main.js` | - | - | - | ✅ | - | - |
| `index.html` | - | - | - | ✅(`<h2>` id) | ✅ | ✅ |
| `css/style.css` | - | - | - | - | ✅ | ✅ |

## 8. 테스트 계획 (스프린트별)

빌드 시스템 없는 순수 정적 HTML/JS 프로젝트이므로 `npm run build` 등은 존재하지 않는다. 대신 아래를 각 스프린트 완료 시 수행한다(`tester` 에이전트 실행 기준):

**Sprint 1 완료 시 (TICKET-1~3, `js/ai.js`만 변경됨 — UI 미반영 상태)**
- 브라우저 콘솔에서 문법 오류 없이 모듈이 로드되는지 확인(`index.html`을 로컬 정적 서버로 열고 콘솔 확인).
- `detectOllama()`/신규 함수들을 콘솔에서 직접 호출해 반환값 구조 확인(Ollama 실행 중/미실행 두 상태 모두).
- Ollama가 실행 중인 로컬 환경에서 `qwen3:4b-instruct`로 기존 분석 흐름이 회귀 없이 동작하는지 확인(가장 중요 — 기존 동작 깨짐 방지).
- (Ollama 설치 환경이 있다면) `/api/pull`을 콘솔에서 직접 호출해 스트리밍 여부 실측(§4.3 미결정 해소).

**Sprint 2 완료 시 (TICKET-4~6, 전체 UI 반영)**
- **엔진 표시 정확성**: `<h2>` 제목·저장 텍스트가 세션 중 Ollama 감지 상태 변화에도 `currentEngine()`과 항상 일치하는지(`requirements.md` §6 1번째 항목).
- **thinking 모델 응답 잘림 여부**: 상향된 토큰 한도에서 `qwen3:4b-thinking` 응답이 끝까지 나오는지, `<think>` 태그가 정상 종결되는지(§9 위험 #9 회귀 확인 포함).
- **Ollama 미감지 시 버튼 비활성화 동작**: 비활성화 버튼 호버/클릭 시 기존 엔진 안내 모달이 정확히 뜨는지.
- **`/api/pull` 자동 다운로드 전체 경로**: 트리거 → 용량 확인 문구 → 동의 → 다운로드 → 완료 후 모델 전환까지, 실패 시(네트워크 끊김 등) 사용자 안내까지 끊김 없이 확인.
- **실패 원인 분류 정확성**: "연결 자체 실패" vs "모델 없음"을 실제로 구분해 보여주는지(우선순위 높음 — 오분류 시 사용자가 이미 설치된 모델을 재설치하는 등 잘못된 조치를 할 위험).
- **디버그 정보의 실용성**: 표시된 원본 에러 정보만으로 §3.9의 미제 사례 같은 장애를 재현·진단할 수 있는 수준인지.
- **반응형 확인**: `.notes-actions` 버튼 5개 배치가 좁은 뷰포트에서 깨지지 않는지(위험 #5).
- **비-module 브릿지 동작 확인**: `js/main.js`의 저장 기능이 `window.__hututiEngine` 부재 시(예: 스크립트 로드 순서 변경 등 예외 상황)에도 오류로 멈추지 않고 방어적으로 동작하는지.
- 조립 검증: 신규 export/전역 심볼(`window.__hututiEngine` 등)이 실제로 선언한 대로 노출되는지 콘솔에서 확인.

## 9. 아키텍처 문서 갱신 계획

별도 아키텍처 문서 체계(`{{ARCHITECTURE_DIR}}`)가 없는 순수 정적 프로젝트임을 `structure.md` §7에서 이미 확인했다. 이 트랙 완료 후 별도 아키텍처 문서 갱신 대상은 없다. 다만 `js/ai.js`의 모델 상태 구조가 "단일 boolean" → "다중 모델 레지스트리"로 바뀌는 구조적 변경이므로, 코드 상단 주석(현재 `js/ai.js:1-14`의 헤더 주석)에 이 변경을 반영해 향후 재조사 시 혼선이 없게 한다(각 관련 티켓의 완료 기준에 포함).

## 10. 검증 체크리스트

- [x] 요구사항 재확인(§1~2) — `requirements.md`·`structure.md` 및 실제 코드 5개 파일 재확인 완료
- [x] 영향 파일·레이어 전수 조사(§3)
- [x] 핵심 설계 결정 확정(§4) — 전역 브릿지 방식, 다중 모델 상태 전환, 진행률 미결정 유지
- [x] 위험 지점 식별(§5) — 10건(계획 리뷰 Warning 반영 1건 추가)
- [x] 의존성 그래프·스프린트 그룹핑(§6) — 순차 6티켓
- [x] 공유 수정 파일 매트릭스(§7)
- [x] 테스트 계획(§8) — 스프린트별
- [x] 아키텍처 문서 갱신 계획(§9) — 해당 없음(코드 헤더 주석 갱신으로 대체)
- [ ] 사용자 확인 대기 — 확인 후 TICKET-1부터 순차로 티켓 문서(01~06) 작성

## 11. 티켓 목록

| # | 티켓명 | 파일 |
|---|---|---|
| TICKET-1 | 모델 레지스트리·선택 상태·토큰 한도 파라미터화 | `js/ai.js` |
| TICKET-2 | `detectOllama()` 실패 분류 재설계 | `js/ai.js` |
| TICKET-3 | Ollama `/api/pull` 자동 다운로드 연동 | `js/ai.js` |
| TICKET-4 | 엔진 표시 하드코딩 버그 수정 + 비-module 브릿지 | `index.html`, `js/ai.js`, `js/ai-ui.js`, `js/main.js` |
| TICKET-5 | 엔진 선택 버튼 UI(팝오버·툴팁·다운로드 확인) | `index.html`, `css/style.css`, `js/ai-ui.js` |
| TICKET-6 | Ollama 실패 안내 배너·디버그 정보 토글 UI | `index.html`, `css/style.css`, `js/ai-ui.js` |
