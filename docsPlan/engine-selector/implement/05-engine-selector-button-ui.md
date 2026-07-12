# TICKET-5 — 엔진 선택 버튼 UI (팝오버·툴팁·다운로드 확인)

파일: `index.html`, `css/style.css`, `js/ai-ui.js`
선행 티켓: TICKET-1, TICKET-2, TICKET-3, TICKET-4
스프린트: Sprint 2

## AS-IS (재확인 결과)

```html
<!-- index.html:63-71 -->
<div class="notes-actions">
  <button class="btn btn-compact btn-primary" id="analyze-btn">가진단 받기</button>
  <button class="btn btn-compact" id="ai-analyze-btn">
    <span class="ai-btn-label">AI 분석</span>
    <span class="ai-btn-spinner" aria-hidden="true"></span>
  </button>
  <button class="btn btn-compact" id="clear-notes-btn">지우기</button>
  <button class="btn btn-compact" id="save-result-btn">결과 저장</button>
</div>
```

```css
/* css/style.css:287-299 */
.notes-actions{
  margin-top:10px;
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:nowrap;
}
.btn-compact{
  font-size:12px;
  padding:7px 9px;
  flex:0 0 auto;
  white-space:nowrap;
}
```

`flex-wrap:nowrap` — 버튼을 하나 더 추가하면 좁은 화면에서 오버플로 위험(00-overview §5 위험 #5).

## TO-BE

### 1. `index.html` — `#save-result-btn` 옆에 신규 버튼 + 팝오버 마크업 추가

```html
<div class="notes-actions">
  <button class="btn btn-compact btn-primary" id="analyze-btn">가진단 받기</button>
  <button class="btn btn-compact" id="ai-analyze-btn">...</button>
  <button class="btn btn-compact" id="clear-notes-btn">지우기</button>
  <button class="btn btn-compact" id="save-result-btn">결과 저장</button>
  <button class="btn btn-compact" id="engine-select-btn" type="button" aria-haspopup="true" aria-expanded="false">
    <span id="engine-select-label">엔진: 생각과정 없음</span>
  </button>
</div>

<div class="engine-option-popover" id="engine-option-popover" hidden role="menu">
  <button class="engine-option" data-model-id="qwen3:4b-instruct" role="menuitem" type="button">
    <span class="engine-option-label">생각과정 없음 (현재 기본)</span>
    <span class="engine-option-installed" hidden>설치됨</span>
    <span class="engine-option-tooltip" role="tooltip"><!-- 툴팁 문구, TICKET-1 tooltip 필드 사용 --></span>
  </button>
  <button class="engine-option" data-model-id="qwen3:4b-thinking" role="menuitem" type="button">
    <span class="engine-option-label">생각과정 있음 (qwen3:4b-thinking)</span>
    <span class="engine-option-installed" hidden>설치됨</span>
    <span class="engine-option-tooltip" role="tooltip"><!-- 툴팁 문구 --></span>
  </button>
</div>

<div class="download-confirm-overlay" id="download-confirm-overlay" hidden>
  <div class="download-confirm-dialog" role="alertdialog" aria-modal="true">
    <p id="download-confirm-text"><!-- "이 모델은 약 N GB입니다. 다운로드하시겠습니까?" --></p>
    <div class="download-confirm-actions">
      <button class="btn btn-compact" id="download-confirm-cancel" type="button">취소</button>
      <button class="btn btn-compact btn-primary" id="download-confirm-ok" type="button">다운로드 시작</button>
    </div>
  </div>
</div>
```

정확한 팝오버/다이얼로그 배치(인라인 vs 문서 하단, `.assist-card` 내부 vs 바깥)는 기존 `#ai-engine-modal-overlay`가 `body` 최상위(`index.html:122`)에 위치한 패턴을 참고해 구현 시 확정.

### 2. `css/style.css` — 신규 스타일 4종

- `.engine-option-popover`: 팝오버 레이어(위치 `absolute`, `#engine-select-btn` 기준 앵커) — 기존 `.ai-engine-modal`(`:330-338`) 스타일 톤 재사용.
- `.engine-option`: 옵션 버튼, 호버 시 `.engine-option-tooltip` 노출(`:hover .engine-option-tooltip{opacity:1}` 패턴).
- `#engine-select-btn:disabled` (또는 `.btn-compact:disabled`): 회색 비활성화 스타일 — 현재 `.btn-compact`에 disabled 스타일이 없으므로 신규 작성.
- `.download-confirm-overlay`/`.download-confirm-dialog`: 기존 `.ai-engine-modal-overlay`(`:319-338`) 패턴 재사용.

### 3. `.notes-actions` 반응형 대응 (위험 #5 해소)

버튼이 5개(분석/AI 분석/지우기/저장/엔진 선택)로 늘어나므로 `flex-wrap:nowrap`(`css/style.css:292`)을 좁은 뷰포트에서 줄바꿈 허용으로 조정할지, 라벨을 짧게(아이콘화) 할지 구현 시 실측 후 결정. 최소한 모바일 폭에서 버튼이 화면 밖으로 잘리지 않는지 확인.

### 4. `js/ai-ui.js` — 이벤트 바인딩

### 4.0 페이지 로드 시 최초 감지 실행 (계획 리뷰 반영, 신규)

**리뷰에서 지적된 공백**: TICKET-5·TICKET-6 설계 전반이 "페이지 로드 시 이미 `detectOllama()` 결과가 있다"고 전제하지만, 실제로는 `detectOllama()`가 "AI 분석" 클릭(`js/ai.js:307`)과 엔진 안내 모달 오픈(`js/ai-ui.js:61`) 두 지점에서만 지연 호출되어, `DOMContentLoaded` 시점에는 아무 결과도 없다. `#engine-select-btn`의 초기 `disabled` 상태를 정하려면 이 시점 이전에 최소 1회 감지가 필요하므로, 이 티켓의 `DOMContentLoaded` 핸들러 안에 최초 호출을 명시적으로 추가한다:

```js
document.addEventListener('DOMContentLoaded', function () {
  ...
  // 페이지 진입과 동시에 백그라운드로 감지 시작 — await로 렌더를 막지 않는다(00-overview §5 위험 #10).
  detectOllama().then(function () {
    updateEngineSelectButtonState(); // getOllamaConnectionState() 기준으로 disabled 갱신 + TICKET-6 배너 갱신
  });
  // 감지가 끝나기 전(최대 15초)에는 버튼을 잠정적으로 disabled 처리해두어
  // "감지 안 됨"으로 오인해 즉시 클릭했다가 빈 팝오버가 뜨는 상황을 방지한다.
  ...
});
```

**주의(00-overview §5 위험 #10 직결)**: `detectOllama()` 호출을 `await`로 감싸 `DOMContentLoaded` 핸들러 전체를 블로킹하지 않는다 — Ollama를 쓰지 않는 다수 사용자가 페이지 진입 시마다 최대 15초 대기하게 되는 것을 막기 위해 `.then()` 콜백 형태(비차단)로 처리하고, 나머지 초기화 로직(다른 버튼 바인딩 등)은 감지 완료를 기다리지 않고 먼저 끝낸다.

- `#engine-select-btn` 클릭 → Ollama 감지 상태(TICKET-2 `getOllamaConnectionState()`) 확인:
  - 미감지(`'unreachable'` 또는 아직 감지 중 — 위 §4.0 참고) → 버튼 `disabled` 처리 + 클릭 시 기존 `#ai-engine-modal-overlay`를 여는 기존 핸들러 재사용(신규 안내문 작성 금지, `requirements.md` §3.2 확정 사항).
  - 감지됨 → `#engine-option-popover` 토글.
- 각 `.engine-option` 클릭 시:
  1. `isModelInstalled(modelId)`(TICKET-2) 확인.
  2. 설치돼 있으면 → `setSelectedModelId(modelId)`(TICKET-1) 즉시 호출 → 팝오버 닫기 → 버튼 라벨 갱신.
  3. 미설치면 → `#download-confirm-overlay` 노출(용량 문구는 `OLLAMA_MODELS[modelId].approxSizeGB`, TICKET-1·3에서 채워짐) → 사용자가 "다운로드 시작" 클릭 시 `pullOllamaModel(modelId, onProgress)`(TICKET-3) 호출 → 완료 후 `setSelectedModelId(modelId)`.
- 옵션 목록 렌더링 시 `listOllamaModels()`(TICKET-1)로 라벨·툴팁 텍스트를 채우고, `isModelInstalled()`로 "설치됨" 배지 표시 여부 결정.
- 진행률 UI는 TICKET-3에서 채택된 경로(A/B)에 따라 `pullOllamaModel`의 `onProgress` 콜백을 받아 `formatBytes`/`formatRemaining`(`js/ai-ui.js:3-12`, 기존 함수 재사용) 형태로 표시하거나, 불확정 "다운로드 중..." 문구만 표시.

## 다른 티켓과의 연결

- TICKET-1에서 받는 것: `listOllamaModels()`, `getSelectedModelId()`, `setSelectedModelId()`, 확정된 `approxSizeGB`.
- TICKET-2에서 받는 것: `getOllamaConnectionState()`, `isModelInstalled()`.
- TICKET-3에서 받는 것: `pullOllamaModel(modelId, onProgress)`, 확정된 다운로드 경로(A/B)에 따른 진행률 콜백 형태.
- TICKET-4에서 받는 것: `#ai-result-title`은 직접 쓰지 않지만, `window.__hututiEngine.getSelectedModelLabel()`을 버튼 라벨 초기값 표시에 재사용 가능(선택 사항).
- TICKET-6에 주는 것: 이 티켓이 만든 `.notes-actions` 아래 DOM 구조(팝오버·다이얼로그 위치) — TICKET-6의 실패 배너·디버그 토글이 이 구조 바로 다음에 이어 붙는다.
- 공유 파일 주의: `index.html`·`js/ai-ui.js`·`css/style.css` 3개 파일 모두 TICKET-6이 이어서 수정하므로, 이 티켓 완료 시 DOM 삽입 위치(예: `.notes-actions` 바로 다음인지, `.ai-status` 앞/뒤인지)를 명확히 정리해 인계한다.

## 완료 기준

- [ ] `#engine-select-btn` + `#engine-option-popover` + `#download-confirm-overlay` 마크업 추가
- [ ] 4종 CSS 클래스 작성, `.notes-actions` 반응형 확인
- [ ] **페이지 로드 시(`DOMContentLoaded`) `detectOllama()` 최초 1회 자동 실행, `await`로 렌더를 막지 않는 비차단 방식으로 구현(계획 리뷰 Warning 2 반영, 필수)**
- [ ] Ollama 미감지 시 버튼 비활성화 + 기존 모달 연결(신규 안내문 없음) 확인
- [ ] 옵션 클릭 → 설치됨/미설치 분기 → 다운로드 확인 다이얼로그 → `/api/pull` 트리거 → 완료 후 전환까지 전체 경로 연결
- [ ] `index.html`·`js/ai-ui.js`의 `?v=` 버전 쿼리 갱신

## 테스트 항목

- **페이지 최초 로드 시 자동 감지(계획 리뷰 Warning 2 검증)**: 새로고침 직후 콘솔·네트워크 탭에서 `/api/tags` 요청이 사용자 조작 없이 자동으로 나가는지, 이 요청이 페이지 렌더(버튼 클릭 가능 시점)를 블로킹하지 않는지
- Ollama 미감지 환경: 버튼이 회색으로 비활성화되고, 클릭 시 기존 "AI 엔진 안내" 모달이 뜨는지(새 안내문 없이)
- Ollama 감지 환경: 버튼 클릭 시 팝오버가 열리고 두 옵션이 보이는지, 각 옵션 호버 시 툴팁이 뜨는지
- 이미 설치된 모델은 "설치됨" 표시가 붙는지, 클릭 시 다운로드 확인 없이 즉시 전환되는지
- 미설치 모델 선택 시 용량 확인 문구가 먼저 뜨고, 동의 후에만 `/api/pull`이 트리거되는지(동의 전 트리거 안 됨 확인)
- 다운로드 완료 후 버튼 라벨·선택 상태가 갱신되고, 이후 "AI 분석" 요청이 새로 선택된 모델로 나가는지
- `.notes-actions` 5개 버튼이 좁은 화면(모바일 폭)에서 깨지지 않는지
