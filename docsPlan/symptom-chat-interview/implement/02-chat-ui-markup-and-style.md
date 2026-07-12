# TICKET-2 — 채팅 UI 마크업·스타일 골격

파일: `index.html`, `css/style.css`
선행 티켓: 없음(TICKET-1과 파일 겹치지 않아 이론상 병행 가능, 순차 원칙상 TICKET-1 이후 착수 권장)
스프린트: Sprint 2

## AS-IS (재확인 결과)

```html
<!-- index.html:48-109 -->
<section class="assist-layout">
  <div class="assist-left">
    <div class="disclaimer-box-small"> ... 사용 전 반드시 확인 ... </div>

    <div class="assist-card">
      <h2>내담자 증상 소견</h2>
      <p class="assist-desc">관찰된 증상, 행동, 진술 등을 자유롭게 서술해 주세요.</p>
      <textarea id="notes-input" class="notes-textarea" rows="10" placeholder="..."></textarea>
      <div class="notes-actions">
        <button class="btn btn-compact btn-primary" id="ai-analyze-btn"> ... </button>
        <button class="btn btn-compact" id="clear-notes-btn">지우기</button>
        <button class="btn btn-compact" id="save-result-btn">결과 저장</button>
        <button class="btn btn-compact" id="engine-select-btn" ...> ... </button>
      </div>
      <p class="notes-hint">입력한 소견은 이 브라우저 화면에만 남고 저장·전송되지 않습니다.</p>
      <div class="ollama-failure-banner" id="ollama-failure-banner" hidden> ... </div>
      <div class="ai-status" id="ai-status" hidden></div>
    </div>
  </div>

  <aside class="assist-results-panel">
    <div class="candidates-card" id="ai-result-card" hidden>
      <div class="candidates-head">
        <h2 id="ai-result-title">AI 분석 결과 (Kanana)</h2>
        <div class="candidates-head-right">
          <span class="candidates-badge" id="ai-mode-badge">브라우저 내 로컬 AI</span>
          <button class="copy-btn" id="copy-ai-result-btn" type="button">복사</button>
        </div>
      </div>
      <div class="ai-result-text" id="ai-result-text"></div>
      <div class="ai-followup-box" id="ai-followup-box" hidden>
        <h3>AI가 추가로 확인하고 싶어하는 사항</h3>
        <div class="ai-followup-questions" id="ai-followup-questions"></div>
        <textarea id="ai-followup-answer" rows="3" placeholder="..."></textarea>
        <button class="btn btn-compact" id="ai-followup-submit-btn" type="button">답변 반영해서 다시 분석</button>
      </div>
    </div>

    <div class="candidates-card assist-results-empty" id="results-empty-hint">
      <p>왼쪽에서 소견을 입력하고 "AI 분석"을 누르면 결과가 여기에 나타납니다. ...</p>
    </div>
  </aside>
</section>
```

```css
/* css/style.css:204-248 */
.assist-layout{
  margin:0 auto; padding:16px 24px;
  display:grid; grid-template-columns:36% 1fr; gap:22px;
  align-items:stretch; flex:1 1 auto; min-height:0; width:100%;
}
.assist-left{ display:flex; flex-direction:column; gap:10px; min-height:0; }
.assist-results-panel{
  min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:14px;
  background:var(--gray-100); border:1px solid var(--gray-200); border-radius:var(--radius-lg); padding:14px;
}
```

`index.html:113-131`(`#engine-select-overlay`, `#download-confirm-overlay`)와 `:133-140`(스크립트 태그·버전 쿼리)는 이 티켓과 무관 — **그대로 유지**.

## TO-BE

### 1. `index.html` — `.assist-layout` 내부 전면 교체

좌우 2단(36%/1fr) 그리드는 "소견 입력(좌) / 결과(우)"라는, 이제는 성립하지 않는 전제 위에 있었다. 채팅 UI는 단일 스크롤 영역 + 하단 고정 입력창 구조가 자연스러우므로, **최소 변경 원칙**에 따라 `.assist-layout` 클래스명은 유지하되 내부를 1단 구조로 재구성한다(클래스명을 바꾸면 CSS 셀렉터 전체를 리네임해야 해서 diff가 불필요하게 커짐 — engine-selector 트랙이 택한 "최소 변경" 방침과 동일).

> **주의(구조·시각 디자인 확인 필요, `structure.md` §2 명시)**: 좌우 분할을 완전히 버리고 단일 컬럼으로 갈지, 아니면 우측에 별도 패널(예: 진단 사전 요약, 엔진 상태)을 계속 둘지는 `structure.md` §2에서 "시각 디자인 사안이라 별도 확인 필요, 이 문서에서 확정하지 않음"으로 명시된 항목이다. 아래 마크업은 **기능적 요건(채팅 목록 + 고정 입력창)을 충족하는 최소 구조**이며, 최종 시각 배치(반응형 비율, 다크모드 등)는 `frontend-design` 스킬로 별도 다듬는 것을 권장한다(00-overview.md §6 다음 단계 제안과 동일 취지).

```html
<section class="assist-layout chat-layout">
  <div class="disclaimer-box-small"> <!-- 기존 문구 그대로 유지 --> </div>

  <div class="chat-card">
    <div class="chat-messages" id="chat-messages">
      <div class="chat-empty-hint" id="chat-empty-hint">
        <p>관찰된 증상, 행동, 진술 등을 자유롭게 입력해 대화를 시작해 주세요.
        키워드 기반으로 직접 확인하고 싶다면 <a href="checklist.html">체크리스트</a>를 이용해 주세요.</p>
      </div>
    </div>

    <div class="ollama-failure-banner" id="ollama-failure-banner" hidden>
      <!-- 기존 내용(:76-82) 그대로, 위치만 이동 -->
    </div>
    <div class="ai-status" id="ai-status" hidden></div>

    <div class="chat-input-bar">
      <textarea id="chat-input" class="chat-textarea" rows="1"
        placeholder="증상, 행동, 진술 등을 입력하고 Enter(또는 전송)를 누르세요"></textarea>
      <button class="btn btn-compact btn-primary chat-send-btn" id="chat-send-btn" type="button">
        <span class="ai-btn-label">전송</span>
        <span class="ai-btn-spinner" aria-hidden="true"></span>
      </button>
    </div>
    <div class="chat-actions">
      <button class="btn btn-compact" id="chat-sufficient-btn" type="button">충분함 — 진단 결과 보기</button>
      <button class="btn btn-compact" id="clear-notes-btn">대화 초기화</button>
      <button class="btn btn-compact" id="save-result-btn">결과 저장</button>
      <button class="btn btn-compact" id="engine-select-btn" type="button" aria-haspopup="dialog" aria-disabled="false">
        <span id="engine-select-label">AI 선택다운</span>
      </button>
    </div>
    <p class="notes-hint">입력한 대화는 이 브라우저 화면에만 남고(같은 탭이 열려 있는 동안 유지) 저장·전송되지 않습니다.</p>
  </div>
</section>
```

**제거 확정**: `#notes-input`, `#ai-analyze-btn`, `#ai-result-card`(`#ai-result-title`·`#ai-mode-badge`·`#copy-ai-result-btn`·`#ai-result-text`·`#ai-followup-box`·`#ai-followup-questions`·`#ai-followup-answer`·`#ai-followup-submit-btn` 전부 포함), `#results-empty-hint`.

**유지·재배치**: `#clear-notes-btn`, `#save-result-btn`, `#engine-select-btn`(+ `#engine-select-label`), `#ollama-failure-banner`(내부 구조 `:76-82` 그대로), `#ai-status`. **id를 바꾸지 않는다** — TICKET-3(`js/ai-ui.js`)·TICKET-4(`js/main.js`)가 이 id들을 그대로 참조하므로, id가 바뀌면 두 티켓의 `getElementById` 호출이 전부 깨진다.

**신규**: `#chat-messages`(메시지 목록 컨테이너, 개별 말풍선은 TICKET-3이 JS로 렌더링 — `index.html`에는 빈 컨테이너 + 초기 안내 문구만 둔다), `#chat-empty-hint`, `#chat-input`, `#chat-send-btn`, `#chat-sufficient-btn`.

`#ai-mode-badge`/`#ai-result-title`는 제거되지만, `updateEngineDisplay()`(`js/ai-ui.js:37-57`)가 이 두 id를 참조한다 — **TICKET-3에서 이 함수의 대체 표시 위치(예: 채팅 헤더의 엔진 배지)를 함께 정해야 한다(§ 다른 티켓과의 연결 참고, 본 티켓 완료 기준에 새 id 하나를 포함).**

### 2. 신규 id 1개 — 엔진 배지 재배치

`updateEngineDisplay()`가 참조하던 `#ai-mode-badge`(대체 텍스트: "브라우저 내 로컬 AI"/"로컬 엔진(Ollama·Qwen3-4B)")를 채팅 카드 상단에 작게 배치한다.

```html
<div class="chat-card">
  <div class="chat-engine-badge-row">
    <span class="candidates-badge" id="ai-mode-badge">브라우저 내 로컬 AI</span>
  </div>
  <div class="chat-messages" id="chat-messages"> ... </div>
  ...
</div>
```

`#ai-result-title`(h2, "AI 분석 결과 (...)")은 채팅 UI에서 대응 개념이 사라지므로(결과가 카드 제목이 아니라 대화 흐름 자체) **제거하고, `updateEngineDisplay()`의 `titleEl` 갱신 로직은 TICKET-3에서 삭제**한다(완료 기준에 명시).

### 3. `css/style.css` — 그리드 단순화 + 채팅 컴포넌트 6종 신규

```css
/* .assist-layout 그리드를 1단으로 (기존 36%/1fr 폐기) */
.assist-layout.chat-layout{
  display:flex;
  flex-direction:column;
  gap:14px;
  max-width:var(--maxw-narrow);
}

.chat-card{
  background:var(--white);
  border:1px solid var(--gray-200);
  border-radius:var(--radius-lg);
  box-shadow:var(--shadow-md);
  padding:16px 20px;
  display:flex;
  flex-direction:column;
  gap:10px;
  min-height:0;
  flex:1 1 auto;
}
.chat-engine-badge-row{ display:flex; justify-content:flex-end; }

.chat-messages{
  flex:1 1 auto;
  min-height:280px;
  max-height:calc(100vh - 320px);
  overflow-y:auto;
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:4px 2px;
}
.chat-empty-hint{ padding:32px 12px; text-align:center; font-size:13px; color:var(--gray-500); }

.chat-message{
  max-width:78%;
  padding:10px 14px;
  border-radius:var(--radius);
  font-size:13.5px;
  line-height:1.65;
  white-space:pre-wrap;
}
.chat-message.user{
  align-self:flex-end;
  background:var(--primary);
  color:var(--white);
  border-bottom-right-radius:4px;
}
.chat-message.assistant{
  align-self:flex-start;
  background:var(--gray-100);
  color:var(--gray-700);
  border-bottom-left-radius:4px;
}
.chat-message.final-diagnosis{
  align-self:stretch;
  max-width:100%;
  background:var(--primary-50);
  border:1px solid var(--primary-100);
}

.chat-input-bar{
  display:flex;
  align-items:flex-end;
  gap:8px;
}
.chat-textarea{
  flex:1 1 auto;
  resize:none;
  min-height:40px;
  max-height:160px;
  border:1px solid var(--gray-300);
  border-radius:var(--radius-sm);
  padding:9px 12px;
  font-size:14px;
  font-family:inherit;
  color:var(--ink);
  background:var(--gray-100);
  line-height:1.5;
}
.chat-textarea:focus{
  outline:none; border-color:var(--primary); background:var(--white);
  box-shadow:0 0 0 3px var(--primary-100);
}
.chat-send-btn{ flex:0 0 auto; }

.chat-actions{
  display:flex; align-items:center; gap:4px; flex-wrap:wrap;
}
```

`.notes-textarea`(`:276-296`), `.ai-result-text`/`.ai-followup-box`/`.ai-followup-questions`(`:588-625`) 스타일은 더 이상 어떤 요소도 참조하지 않으므로 **삭제**(dead CSS 방지). `.candidates-card`/`.candidates-head`/`.candidates-badge`(`:627-678`)는 `#ai-mode-badge`가 `.candidates-badge` 클래스를 계속 쓰므로 **`.candidates-badge`만 유지**, 나머지(`.candidates-card`, `.candidates-head*`)는 참조하는 요소가 사라지므로 삭제. `.copy-btn`(`:653-668`)은 최종 진단 복사 기능에 재사용될 수 있으므로 유지(TICKET-3에서 다시 쓸지 결정).

### 4. 반응형

```css
@media (max-width: 960px){
  .chat-messages{ max-height:none; }
  .chat-message{ max-width:88%; }
}
```

## 다른 티켓과의 연결

- 선행 티켓 없음.
- TICKET-3에 주는 것: `#chat-messages`(빈 컨테이너), `#chat-empty-hint`, `#chat-input`, `#chat-send-btn`, `#chat-sufficient-btn`, `#ai-mode-badge`(재배치됨, id 동일), 재배치된 `#clear-notes-btn`/`#save-result-btn`/`#engine-select-btn`/`#ollama-failure-banner`/`#ai-status`(id 전부 동일 유지). TICKET-3은 이 id들로 `getElementById`를 다시 연결하면 된다.
- TICKET-4에 주는 것: `#clear-notes-btn`(라벨이 "지우기"→"대화 초기화"로 바뀜, id는 동일) — TICKET-4가 이 버튼의 클릭 핸들러 동작을 재정의.
- 공유 파일 주의: `index.html`은 TICKET-3(버전 쿼리만)·TICKET-2(구조) 두 티켓이 만지지만 TICKET-3은 구조를 다시 바꾸지 않고 `<script>` 태그의 `?v=` 값만 올린다 — 구조 변경은 이 티켓에서 끝낸다.

## 완료 기준

- [ ] `#notes-input`/`#ai-analyze-btn`/`#ai-result-card`(하위 전체)/`#results-empty-hint` 제거
- [ ] `#chat-messages`/`#chat-empty-hint`/`#chat-input`/`#chat-send-btn`/`#chat-sufficient-btn` 신규 마크업 추가
- [ ] `#clear-notes-btn`/`#save-result-btn`/`#engine-select-btn`/`#ollama-failure-banner`/`#ai-status`/`#ai-mode-badge`를 새 구조 안에 **id 변경 없이** 재배치
- [ ] `#ai-result-title` 제거(및 그 참조를 없애야 함을 TICKET-3에 인계 — 이 티켓만으로는 `js/ai-ui.js` 참조가 깨진 채로 남으므로 TICKET-3 착수 전까지는 콘솔 경고가 날 수 있음, 정상)
- [ ] `.assist-layout` 1단 구조 CSS 반영, `.chat-*` 6종 스타일 작성
- [ ] `.notes-textarea`/`.ai-result-text`/`.ai-followup-box`/`.ai-followup-questions`/`.candidates-card`/`.candidates-head*` 등 죽은 CSS 삭제(`.candidates-badge`는 유지)
- [ ] `css/style.css:243-248`의 `@media (max-width: 960px){ .assist-layout{...} .assist-left{...} .assist-results-panel{...} }` 블록도 삭제 대상에 포함(계획 리뷰 제안 반영 — `.assist-left`/`.assist-results-panel` 클래스가 마크업에서 사라지므로 이 미디어쿼리도 죽은 CSS가 됨. `.assist-layout` 자체를 겨냥한 규칙만 있다면 위 §3의 신규 `.chat-layout`/`.chat-messages` 반응형 규칙으로 대체)
- [ ] 모바일 폭(768px 이하)에서 레이아웃 확인
- [ ] `css/style.css?v=24` → `?v=25`, `index.html`이 로드하는 `css/style.css?v=` 갱신

## 테스트 항목

- 정적 마크업만으로(더미 텍스트 삽입) 채팅 버블 좌/우 정렬, 색상 대비가 육안으로 자연스러운지.
- `#chat-messages`가 내용이 늘어날 때 내부 스크롤만 생기고 페이지 전체가 스크롤되지 않는지(`body.shell-page{overflow:hidden}` 전제, `css/style.css:195-200`와 충돌 없는지).
- `#engine-select-overlay`/`#download-confirm-overlay`(engine-selector 산출물)가 이 티켓의 마크업 변경 이후에도 여전히 정상적으로 화면 중앙에 뜨는지(회귀 확인 — 이 티켓은 이 두 요소를 손대지 않지만 주변 DOM 구조 변경이 영향을 줄 수 있으므로).
- 모바일 뷰포트(예: 375px)에서 입력창·버튼이 화면 밖으로 잘리지 않는지.
