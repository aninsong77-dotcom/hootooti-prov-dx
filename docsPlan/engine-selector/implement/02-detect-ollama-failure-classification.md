# TICKET-2 — `detectOllama()` 실패 분류 재설계

파일: `js/ai.js`
선행 티켓: TICKET-1(모델 레지스트리 완료 후 착수)
스프린트: Sprint 1

## AS-IS (`js/ai.js:185-202` 재확인 결과)

```js
let ollamaAvailable = null; // null = 미확인, true/false = 확인됨

export async function detectOllama() {
  if (ollamaAvailable !== null) return ollamaAvailable;
  try {
    const res = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    ollamaAvailable = models.some((n) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL));
  } catch (e) {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}
```

**확인된 구조적 문제 2가지**(요구사항 §3.7·구조 §3.6에서 이미 지적, 재확인 완료):
1. `catch (e) { ollamaAvailable = false; }` — fetch 자체 실패(네트워크·타임아웃·CORS)와 `!res.ok`(연결은 됐지만 비정상 응답)를 구분하지 않고 동일하게 처리, `e` 객체 자체를 버림.
2. `ollamaAvailable !== null`이면 **영구 캐시** — 세션 중 재검사 로직이 전혀 없어, TICKET-1에서 도입한 모델 전환·TICKET-3의 `/api/pull` 완료 후 재감지가 불가능한 구조.

## TO-BE

### 1. 상태를 "연결 가능 여부"와 "설치된 모델 목록"으로 분리

```js
let ollamaConnectionState = null; // null=미확인, 'connected'|'unreachable'
let installedModelNames = null;   // string[] | null(미확인)
let lastOllamaError = null;       // { stage, message, raw, timestamp } | null
```

- `stage`: `'fetch'`(네트워크/타임아웃 단계 실패) | `'bad-status'`(HTTP 오류 응답) | `'parse'`(JSON 파싱 실패) 중 하나로 최소 분류.
- `message`: 사용자에게 보여줄 한국어 한 줄 요약은 이 티켓이 아니라 TICKET-6(배너 UI)에서 매핑하되, 이 티켓은 그 매핑에 필요한 원재료(`stage`, `raw`)를 빠짐없이 보존하는 책임만 진다.
- `raw`: `e.message`(또는 `e` 전체를 문자열화한 값) — 디버그 토글(TICKET-6)이 그대로 노출할 원본.
- `timestamp`: `Date.now()` — "언제 마지막으로 실패했는지" 디버그 정보에 포함(§3.9 미제 사례 재현 지원).

### 2. `detectOllama()` 재설계 — 캐시 무효화 가능하도록

```js
export async function detectOllama(forceRefresh) {
  if (!forceRefresh && ollamaConnectionState !== null) {
    return ollamaConnectionState === 'connected'
      && installedModelNames.some((n) => n === selectedOllamaModelId || n.startsWith(selectedOllamaModelId));
  }

  let res;
  try {
    res = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'fetch', message: e && e.message, raw: String(e), timestamp: Date.now() };
    return false;
  }

  if (!res.ok) {
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'bad-status', message: 'HTTP ' + res.status, raw: 'HTTP ' + res.status, timestamp: Date.now() };
    return false;
  }

  try {
    const data = await res.json();
    installedModelNames = (data.models || []).map((m) => m.name);
    ollamaConnectionState = 'connected';
    lastOllamaError = null;
    return installedModelNames.some((n) => n === selectedOllamaModelId || n.startsWith(selectedOllamaModelId));
  } catch (e) {
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'parse', message: e && e.message, raw: String(e), timestamp: Date.now() };
    return false;
  }
}
```

**주의**: 기존 시그니처는 `detectOllama()`(인자 없음)였고 `js/ai.js:307`, `js/ai-ui.js:61`에서 인자 없이 호출된다. `forceRefresh` 인자는 선택적(기본 `undefined`/falsy)으로 추가해 기존 호출부를 깨지 않는다(하위 호환).

### 3. 신규 export — 실패 분류·설치 여부 조회용

```js
export function getOllamaConnectionState() {
  return ollamaConnectionState; // null | 'connected' | 'unreachable'
}

export function getLastOllamaError() {
  return lastOllamaError; // TICKET-6의 디버그 토글이 그대로 노출
}

export function isModelInstalled(modelId) {
  return !!(installedModelNames && installedModelNames.some((n) => n === modelId || n.startsWith(modelId)));
}

export function getInstalledModelNames() {
  return installedModelNames || [];
}
```

### 4. `currentEngine()`은 변경하지 않는다

`currentEngine()`(`js/ai.js:281-283`)의 반환 계약(`'ollama'`/`'browser'`)은 TICKET-4·5·6 여러 곳에서 이미 소비되고 있어 이 티켓에서 바꾸지 않는다. 다만 내부적으로 `ollamaAvailable` 대신 새 상태(`ollamaConnectionState === 'connected' && isModelInstalled(selectedOllamaModelId)`)를 참조하도록 구현부만 갱신한다.

### 5. `analyzeWithAI()` 호출 시점 재검사 정책 (계획 리뷰 반영, 신규)

**리뷰에서 지적된 공백**: `analyzeWithAI()`(`js/ai.js:297-323`)는 `:307`에서 `await detectOllama()`를 인자 없이 호출한다. 위 §2의 `detectOllama(forceRefresh)`는 하위 호환을 위해 `forceRefresh`가 없으면 캐시를 그대로 반환하므로, 이 호출부를 그대로 두면 세션 초반 Ollama가 감지된 뒤 사용자가 Ollama를 끈 경우에도 계속 캐시된 "연결됨"을 믿고 `analyzeWithOllama()`를 시도해 fetch 실패로 이어진다. `requirements.md` §6과 TICKET-4 테스트 항목이 "분석 도중 Ollama 종료" 시나리오를 통과 조건으로 명시하므로, 이 재검사·폴백 로직은 반드시 이 티켓의 스코프에 포함한다(00-overview §4.4·§5 위험 #1 참고).

**구현 방향(둘 중 하나를 impl 단계에서 실측 후 선택, 이 계획 문서는 방향만 제시)**:

```js
// 방식 A — 실패 시에만 재검사 후 폴백 (권장 후보: 정상 경로에 지연 추가 없음)
export async function analyzeWithAI(noteText, onProgress, followUpAnswerText) {
  ...
  if (await detectOllama()) {
    try {
      return cleanModelOutput(await analyzeWithOllama(systemPrompt, userMessage));
    } catch (e) {
      // Ollama가 세션 중 꺼졌을 가능성 — 강제 재검사로 상태를 갱신하고 wllama로 폴백
      await detectOllama(true);
      // 아래 wllama 경로로 자연스럽게 이어짐 (return 없이 통과)
    }
  }
  await ensureModelLoaded(onProgress);
  ...
}
```

```js
// 방식 B — 매 분석 시도마다 강제 재검사
if (await detectOllama(true)) { ... }
```

방식 A는 정상 동작(Ollama가 계속 켜져 있는 경우) 경로에 지연을 추가하지 않아 선호되지만, "Ollama가 켜져 있으나 대상 모델만 삭제된" 경우 `analyzeWithOllama()`가 (모델 없음 오류로) 실패해야 폴백이 트리거된다는 전제가 필요하다. 방식 B는 항상 최신 상태를 보장하지만 매 분석 요청마다 최대 15초 타임아웃 위험을 다시 노출한다(00-overview §5 위험 #10과 동일 트레이드오프). **최종 선택과 근거는 이 티켓 구현 완료 보고에 기록한다.**

## 다른 티켓과의 연결

- TICKET-1에서 받는 것: `OLLAMA_MODELS`, `selectedOllamaModelId`(선택 상태) — 설치 여부 판별 시 "지금 선택된 모델"을 기준으로 삼기 위해 사용.
- TICKET-3에 주는 것: `detectOllama(true)`(강제 재검사) — `/api/pull` 성공 후 목록 갱신에 사용. `getInstalledModelNames()` — 다운로드 트리거 전 "이미 설치돼 있는지" 최종 확인.
- TICKET-4에 주는 것: 없음(TICKET-4는 `currentEngine()`만 소비, 이 티켓이 `currentEngine()` 내부 구현을 바꾸지만 외부 계약은 유지되므로 TICKET-4에 영향 없음 — 단 TICKET-4는 이 티켓 완료 후 시작해 최신 `js/ai.js` 위에서 브릿지를 추가해야 함).
- TICKET-5에 주는 것: `isModelInstalled(modelId)` — 옵션 목록에 "설치됨" 표시.
- TICKET-6에 주는 것: `getOllamaConnectionState()`, `getLastOllamaError()` — 실패 안내 배너·디버그 토글의 유일한 데이터 원본.
- 공유 파일 주의: `js/ai-ui.js:61`의 `await detectOllama()` 호출(엔진 안내 모달 오픈 시)이 인자 없이 호출되므로 캐시된 값을 그대로 반환한다 — 모달을 열 때마다 최신 상태를 보여주려면 이 호출부를 `detectOllama(true)`로 바꿀지 TICKET-4에서 판단 필요(이 티켓 완료 보고에 이 이슈를 명시적으로 인계).

## 완료 기준

- [ ] `ollamaConnectionState`/`installedModelNames`/`lastOllamaError` 상태 도입, `ollamaAvailable` 변수 제거(또는 내부 계산값으로 대체)
- [ ] `detectOllama(forceRefresh)` 하위 호환 유지하며 재설계, 기존 호출부(`js/ai.js:307`, `js/ai-ui.js:61`) 무변경으로 동작
- [ ] `getOllamaConnectionState`/`getLastOllamaError`/`isModelInstalled`/`getInstalledModelNames` export 추가
- [ ] `currentEngine()` 외부 계약(`'ollama'`/`'browser'`) 불변 확인
- [ ] **`analyzeWithAI()`(`js/ai.js:307`) 호출부에 재검사·폴백 정책(§5) 적용 — "분석 도중 Ollama 종료" 시나리오에서 캐시된 값만 믿고 실패하지 않도록 함(계획 리뷰 Warning 1 반영, 필수)**
- [ ] `js/ai-ui.js:1`의 `./ai.js?v=` 버전 갱신
- [ ] TICKET-4 인계 사항(모달 오픈 시 강제 재검사 여부) 완료 보고에 명시

## 테스트 항목

- Ollama 미실행 상태에서 `detectOllama()` 호출 → `getOllamaConnectionState() === 'unreachable'`, `getLastOllamaError().stage === 'fetch'` 확인
- Ollama 실행 중이나 대상 모델 미설치 상태에서 호출 → 연결은 `'connected'`이나 `isModelInstalled(selectedOllamaModelId)`가 `false`인지 확인(연결 실패와 모델 없음이 실제로 구분되는지 — 요구사항 §6 최우선 테스트 항목)
- Ollama 정상 상태에서 회귀 없이 기존처럼 `currentEngine() === 'ollama'` 반환되는지
- `detectOllama(true)` 호출 시 캐시를 무시하고 재요청하는지(네트워크 탭 또는 fetch 호출 횟수로 확인)
- **세션 중 상태 변화 시나리오(계획 리뷰 Warning 1 검증)**: Ollama가 감지된 상태에서 "AI 분석"을 1회 성공시킨 뒤, Ollama 프로세스를 종료하고 다시 "AI 분석"을 클릭 → 일반 fetch 에러 문구로 튕기지 않고 재검사 후 Kanana(wllama)로 자연스럽게 폴백되는지
