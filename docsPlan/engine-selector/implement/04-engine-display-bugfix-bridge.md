# TICKET-4 — 엔진 표시 하드코딩 버그 수정 + 비-module 브릿지

파일: `index.html`, `js/ai.js`(브릿지 export만 추가), `js/ai-ui.js`, `js/main.js`
선행 티켓: TICKET-1, TICKET-2(둘 다 병합된 최신 `js/ai.js` 기준)
스프린트: Sprint 2 (첫 티켓)

## AS-IS (재확인 결과)

```html
<!-- index.html:80-89 -->
<div class="candidates-card" id="ai-result-card" hidden>
  <div class="candidates-head">
    <h2>AI 분석 결과 (Kanana)</h2>   <!-- id 없음, 하드코딩 -->
    <div class="candidates-head-right">
      <span class="candidates-badge" id="ai-mode-badge">브라우저 내 로컬 AI</span>
      <button class="copy-btn" id="copy-ai-result-btn" type="button">복사</button>
    </div>
  </div>
  ...
```

```js
// js/ai-ui.js:155-160, :189-194 — #ai-mode-badge는 이미 동적 갱신됨
var badge = document.getElementById('ai-mode-badge');
if (badge) {
  badge.textContent = currentEngine() === 'ollama'
    ? '로컬 엔진 (Ollama · Qwen3-4B)'
    : '브라우저 내 로컬 AI (Kanana)';
}
```

```js
// js/main.js:458-467 — saveResult() 저장 텍스트, 하드코딩
var aiResultCard = document.getElementById('ai-result-card');
var aiResultText = document.getElementById('ai-result-text');
if(aiResultCard && !aiResultCard.hidden && aiResultText && aiResultText.textContent.trim() !== ''){
  lines.push('[AI 분석 결과 (Kanana, 브라우저 내 로컬 AI)]');   // 항상 Kanana 고정
  ...
```

`js/main.js`는 `index.html:161` `<script src="js/main.js?v=5">`(비-module)로 로드되어 `js/ai.js`의 `export function currentEngine()`을 `import`할 수 없다(00-overview §4.1에서 이미 방안 확정).

## TO-BE

### 1. `index.html`의 `<h2>`에 `id` 부여

```html
<h2 id="ai-result-title">AI 분석 결과 (Kanana)</h2>
```

초기 텍스트("Kanana")는 남겨두되(모듈 로드 전 첫 페인트 시 깜빡임 방지용 기본값), `js/ai-ui.js`가 `#ai-mode-badge`와 같은 지점에서 즉시 덮어쓴다.

### 2. `js/ai-ui.js`에서 `<h2>` 동적 갱신 — `#ai-mode-badge` 갱신 지점 재사용

`js/ai-ui.js:155-160`(1차 분석 완료 시)과 `:189-194`(후속 답변 반영 재분석 시), 총 2곳에 `#ai-mode-badge` 갱신과 병행해 아래를 추가한다:

```js
var titleEl = document.getElementById('ai-result-title');
if (titleEl) {
  titleEl.textContent = currentEngine() === 'ollama'
    ? 'AI 분석 결과 (Ollama · ' + /* TICKET-1 선택된 모델 라벨 */ + ')'
    : 'AI 분석 결과 (Kanana)';
}
```

정확한 Ollama 쪽 표시 문구(모델명 그대로 노출할지, "생각과정 없음/있음" 라벨을 쓸지)는 `getSelectedModelId()`/`listOllamaModels()`(TICKET-1)에서 라벨을 가져와 결정한다 — badge 문구("로컬 엔진 (Ollama · Qwen3-4B)")와 중복되지 않게 간결히 조정.

### 3. `js/ai.js`에 전역 브릿지 추가 (00-overview §4.1 확정 방식)

`js/ai.js` 파일의 **모듈 톱레벨**(함수 정의부 바깥, import 직후 등 실행이 보장되는 위치)에 추가:

```js
if (typeof window !== 'undefined') {
  window.__hututiEngine = {
    currentEngine: currentEngine,
    getSelectedModelLabel: function () {
      var models = listOllamaModels(); // TICKET-1
      var m = models.filter(function (x) { return x.id === getSelectedModelId(); })[0];
      return m ? m.label : null;
    },
  };
}
```

`window.__hututiEngine`은 `js/ai.js`가 모듈로 로드되는 즉시(문서 파싱 완료 후, `DOMContentLoaded` 발생 전) 존재가 보장된다(00-overview §4.1 "타이밍 안전성" 참고).

### 4. `js/main.js`의 `saveResult()` 수정 — 방어적 접근, "생각과정 유무" 라벨 보존 (계획 리뷰 반영)

**리뷰에서 지적된 공백**: §3에서 만든 `getSelectedModelLabel()`(생각과정 없음/있음을 구분하는 라벨)을 정작 아래 저장 텍스트 조립부가 쓰지 않고 `currentEngine()`의 `'ollama'`/`'browser'` 두 갈래만으로 문구를 만들면, 세션 종료 후 남는 저장 파일에는 Ollama로 분석했다는 사실만 남고 `qwen3:4b-instruct`(생각과정 없음)인지 `qwen3:4b-thinking`(생각과정 있음)인지 기록이 사라진다. 아래처럼 `getSelectedModelLabel()`을 반드시 함께 반영한다:

```js
// js/main.js:461 대체
var engineLabel = '(엔진 확인 불가)';
if (window.__hututiEngine && typeof window.__hututiEngine.currentEngine === 'function') {
  if (window.__hututiEngine.currentEngine() === 'ollama') {
    var modelLabel = (typeof window.__hututiEngine.getSelectedModelLabel === 'function')
      ? window.__hututiEngine.getSelectedModelLabel()
      : null;
    engineLabel = 'Ollama 로컬 엔진' + (modelLabel ? ' · ' + modelLabel : '');
  } else {
    engineLabel = 'Kanana, 브라우저 내 로컬 AI';
  }
}
lines.push('[AI 분석 결과 (' + engineLabel + ')]');
```

`window.__hututiEngine`이 존재하지 않는 예외 상황(스크립트 로드 순서가 깨진 경우 등)과 `getSelectedModelLabel`이 없거나 `null`을 반환하는 경우(예: TICKET-5 병합 전 중간 상태) 모두에서 `saveResult()` 자체가 예외를 던지며 멈추지 않도록 방어한다.

## 다른 티켓과의 연결

- TICKET-1에서 받는 것: `listOllamaModels()`, `getSelectedModelId()` — `<h2>` 문구에 선택된 모델 라벨 반영.
- TICKET-2에서 받는 것: 없음(직접 소비 없음, 다만 `currentEngine()` 내부 구현과 `analyzeWithAI()`의 재검사·폴백 정책(TICKET-2 §5, 계획 리뷰 Warning 1 반영)이 TICKET-2에서 바뀌었으므로 이 티켓 착수 전 반드시 TICKET-2 병합 상태를 재확인).
- TICKET-2에 인계받은 사항: TICKET-2 완료 보고에서 "엔진 안내 모달 오픈 시(`js/ai-ui.js:61`) `detectOllama(true)`로 바꿀지"를 이 티켓에서 결정해야 한다 — **결정**: 모달은 사용자가 "지금 상태"를 확인하려는 의도로 여는 것이므로 열 때마다 최신 상태를 보여주는 것이 맞다. `js/ai-ui.js:61`의 `await detectOllama()`를 `await detectOllama(true)`로 변경한다(이 티켓 범위에 포함).
- TICKET-5에 주는 것: `#ai-result-title` id, `window.__hututiEngine` 브릿지 — TICKET-5가 엔진 선택 버튼의 현재 상태 라벨 표시에 동일 데이터 소스를 재사용할 수 있음.
- 공유 파일 주의: `index.html`을 TICKET-5·6도 수정하므로, 이 티켓에서 만든 `#ai-result-title` id와 기존 DOM 구조를 그대로 보존한 채 TICKET-5가 이어서 작업해야 한다(구조 변경 최소화).

## 완료 기준

- [ ] `index.html:83` `<h2>`에 `id="ai-result-title"` 부여
- [ ] `js/ai-ui.js` 2개 지점(`:155-160`, `:189-194`)에 `<h2>` 동적 갱신 추가
- [ ] `js/ai-ui.js:61` 모달 오픈 핸들러의 `detectOllama()` 호출을 `detectOllama(true)`로 변경
- [ ] `js/ai.js`에 `window.__hututiEngine` 브릿지 추가(톱레벨, 함수 내부 아님)
- [ ] `js/main.js:461` 저장 텍스트를 브릿지 경유 동적 값으로 교체, **`getSelectedModelLabel()`을 함께 반영해 생각과정 없음/있음 구분이 저장 텍스트에 남도록 함(계획 리뷰 Warning 3 반영, 필수)**, 브릿지 부재 시 방어적 폴백 확인
- [ ] `index.html:161-162`의 `?v=` 버전 쿼리(`js/main.js`, `js/ai-ui.js`) 갱신

## 테스트 항목

- Ollama 미감지 상태에서 분석 실행 → `<h2>` 제목이 "AI 분석 결과 (Kanana)"로 정확히 표시되는지
- Ollama 감지 상태(정상 연결·모델 설치됨)에서 분석 실행 → `<h2>` 제목이 실제 선택된 모델 정보를 반영하는지
- 저장 버튼 클릭 시 저장된 텍스트 파일의 `[AI 분석 결과 (...)]` 줄이 실제 사용 엔진과 일치하는지 — Ollama/Kanana 두 상태 모두 확인(요구사항 §6 최우선 항목)
- **저장 텍스트에 생각과정 없음/있음 구분이 남는지(계획 리뷰 Warning 3 검증)**: `qwen3:4b-instruct`로 분석 후 저장 → 저장 파일에 "생각과정 없음" 계열 라벨이 보이는지, `qwen3:4b-thinking`으로 전환 후 분석·저장 → 라벨이 "생각과정 있음"으로 바뀌는지(TICKET-5 병합 후 최종 확인 가능)
- 세션 중 Ollama 감지 상태가 바뀌는 경우(예: 분석 도중 Ollama 종료)에도 `<h2>`·저장 텍스트가 그 시점의 실제 엔진을 반영하는지(이 시나리오의 재검사 로직 자체는 TICKET-2 §5에서 구현 — 이 티켓은 그 결과가 `<h2>`·저장 텍스트에 정확히 반영되는지만 확인)
- "AI 엔진 안내" 모달을 열 때마다 최신 연결 상태를 다시 보여주는지(캐시된 오래된 상태가 아닌지)
