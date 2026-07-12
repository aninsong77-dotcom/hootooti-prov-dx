# TICKET-6 — Ollama 실패 안내 배너·디버그 정보 토글 UI

파일: `index.html`, `css/style.css`, `js/ai-ui.js`
선행 티켓: TICKET-2(필수 데이터 원본), TICKET-5(공유 DOM 영역이므로 순서상 이후)
스프린트: Sprint 2 (마지막 티켓)

## AS-IS

Ollama 감지 실패 시 사용자에게 보여지는 것은 현재 없음 — `detectOllama()`가 실패하면 조용히 `analyzeWithAI()`(`js/ai.js:307`)가 wllama(Kanana)로 폴백하고, 사용자는 왜 Ollama가 아닌 Kanana로 동작하는지 알 방법이 없다(요구사항 §1, §3.9의 미제 사례와 직결).

## TO-BE

### 1. `index.html` — 실패 배너 + 디버그 토글 마크업

```html
<div class="ollama-failure-banner" id="ollama-failure-banner" hidden>
  <p class="ollama-failure-message" id="ollama-failure-message"><!-- "Ollama에 연결할 수 없습니다" 등, TICKET-2 stage 기반 매핑 --></p>
  <button class="ollama-debug-toggle" id="ollama-debug-toggle" type="button" aria-expanded="false">자세히 보기</button>
  <div class="ollama-debug-detail" id="ollama-debug-detail" hidden>
    <pre id="ollama-debug-raw"></pre>
    <button class="btn btn-compact" id="ollama-debug-copy-btn" type="button">복사</button>
  </div>
</div>
```

배치 위치는 TICKET-5가 만든 `.notes-actions`/팝오버 구조 바로 다음(또는 `#ai-status`와 같은 영역)에 두어, "지금 어떤 AI 엔진을 쓰고 있나요?" 링크(`index.html:73-75`)와 겹치지 않게 조정한다(TICKET-5 완료 시 인계된 DOM 구조 참고).

### 2. 실패 사유 → 사람이 읽는 문구 매핑 (`js/ai-ui.js`)

TICKET-2의 `getOllamaConnectionState()`/`getLastOllamaError()`를 소비해 최소 2종을 구분(요구사항 §3.7):

```js
function renderOllamaFailure() {
  var state = getOllamaConnectionState();
  var banner = document.getElementById('ollama-failure-banner');
  var msgEl = document.getElementById('ollama-failure-message');
  if (!banner || state !== 'unreachable') {
    if (banner) banner.hidden = true;
    return;
  }
  var err = getLastOllamaError();
  var msg = (err && err.stage === 'fetch')
    ? 'Ollama에 연결할 수 없습니다. (네트워크 오류 또는 응답 없음)'
    : '필요한 모델이 설치되어 있지 않거나 Ollama 응답이 올바르지 않습니다.';
  msgEl.textContent = msg;
  banner.hidden = false;
}
```

`err.stage`가 `'bad-status'`/`'parse'`인 경우의 정확한 문구 분류는 이 티켓 구현 시 최종 확정하되, 최소한 "연결 자체 실패"(`'fetch'`) 대 "그 외(연결은 됐지만 비정상)"는 반드시 구분한다(요구사항 §3.7 최소 목표).

**호출 시점**: 페이지 최초 진입 시 `detectOllama()` 결과 확인 직후, 그리고 엔진 안내 모달을 열 때(`js/ai-ui.js:57-65`, TICKET-4가 `detectOllama(true)`로 바꾼 지점)와 병행해 배너도 최신화한다.

### 3. 디버그 토글

```js
var debugToggle = document.getElementById('ollama-debug-toggle');
var debugDetail = document.getElementById('ollama-debug-detail');
var debugRaw = document.getElementById('ollama-debug-raw');
if (debugToggle) {
  debugToggle.addEventListener('click', function () {
    var err = getLastOllamaError();
    debugRaw.textContent = err
      ? JSON.stringify({ stage: err.stage, message: err.message, raw: err.raw, timestamp: new Date(err.timestamp).toLocaleString('ko-KR') }, null, 2)
      : '(저장된 오류 정보 없음)';
    var expanded = debugDetail.hidden;
    debugDetail.hidden = !expanded;
    debugToggle.setAttribute('aria-expanded', String(expanded));
  });
}
var debugCopyBtn = document.getElementById('ollama-debug-copy-btn');
if (debugCopyBtn) {
  debugCopyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(debugRaw.textContent); // 기존 copyBtn 패턴(js/ai-ui.js:89-103) 재사용
  });
}
```

목적(요구사항 §3.8): 사용자가 이 내용을 복사해 다음 세션에 붙여넣으면 개발자가 원인을 정확히 진단할 수 있어야 하므로, `stage`·`message`·`raw`·`timestamp` 네 필드를 빠짐없이 노출한다(§3.9 미제 사례 재현 지원 목적과 직결).

### 4. `css/style.css` — 신규 스타일

- `.ollama-failure-banner`: 경고 톤(기존 `.ai-status`, `css/style.css:418-427`의 배경/보더 패턴을 경고색으로 변형).
- `.ollama-debug-toggle`: 기존 `.ai-engine-link`(`:306-317`) 언더라인 텍스트 버튼 패턴 재사용.
- `.ollama-debug-detail pre`: 모노스페이스, 스크롤 가능(`overflow-x:auto`), 기존 `.ai-engine-tier code`(`:389-397`) 폰트 스타일 참고.

## 다른 티켓과의 연결

- TICKET-2에서 받는 것: `getOllamaConnectionState()`, `getLastOllamaError()` — 이 티켓의 유일한 데이터 원본.
- TICKET-4에서 받는 것: `detectOllama(true)`로 바뀐 모달 오픈 핸들러(`js/ai-ui.js:57-65`) — 배너 갱신 호출을 이 지점과 병행.
- TICKET-5에서 받는 것: `.notes-actions`/팝오버 이후 DOM 배치 구조 — 배너를 어디에 넣을지 이 구조 기준으로 결정.
- 공유 파일 주의: 이 티켓이 `index.html`·`css/style.css`·`js/ai-ui.js`를 수정하는 마지막 티켓이므로, TICKET-4·5가 만든 기존 마크업/이벤트 핸들러를 삭제·덮어쓰지 않도록 반드시 최신 병합 상태를 재확인한 뒤 추가한다.

## 완료 기준

- [ ] `#ollama-failure-banner`/`#ollama-debug-toggle`/`#ollama-debug-detail` 마크업 추가
- [ ] "연결 자체 실패" vs "그 외(모델 없음 등)" 최소 2종 구분 문구 구현
- [ ] 디버그 토글이 `stage`/`message`/`raw`/`timestamp` 전부 노출, 복사 버튼 동작
- [ ] 페이지 최초 진입·모달 오픈 두 시점 모두에서 배너가 최신 상태로 갱신
- [ ] 신규 CSS 3종 작성
- [ ] `index.html`·`js/ai-ui.js`의 `?v=` 버전 쿼리 갱신

## 테스트 항목

- Ollama 미실행 상태로 페이지 로드 → 배너에 "연결할 수 없습니다" 계열 문구가 뜨는지
- Ollama 실행 중이나 대상 모델 미설치 상태 → 배너 문구가 "연결 실패"와 다른(모델 없음 계열) 문구로 뜨는지 — 요구사항 §6에서 우선순위 가장 높다고 명시한 항목(오분류 시 사용자가 이미 설치된 모델을 잘못 재설치할 위험)
- "자세히 보기" 클릭 시 원본 에러 정보(`stage`/`message`/`raw`/`timestamp`)가 그대로 표시되는지
- "복사" 버튼 클릭 시 클립보드에 디버그 정보가 정확히 복사되는지
- Ollama가 정상 감지되는 상태에서는 배너 자체가 보이지 않는지(불필요한 노출 없음)
- §3.9 미제 사례를 의도적으로 흉내낸 상황(예: 존재하지 않는 포트로 `OLLAMA_URL` 임시 변경 등 개발자 도구 시뮬레이션)에서도 배너·디버그 정보가 합리적인 값을 보여주는지
