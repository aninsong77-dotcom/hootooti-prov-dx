# structure.md — AI 엔진(생각과정 유무) 선택 기능 구조 설계

작업명(제안): engine-selector
전제: 이전 초안의 미결정 항목 3개 중 2개(Ollama 미감지 시 처리, 다운로드 용량 경고)는 확정되었습니다. 남은 미결정은 `requirements.md` §5(1건, `/api/pull` 진행률 표시 여부)뿐입니다.

**구현 순서**: `symptom-chat-interview`보다 이 티켓(`engine-selector`)을 **먼저 구현**한다(파일 충돌 방지 목적, 확정).

---

## 1. 영향 파일 전수 조사

| 파일 | 현재 역할 | 영향 |
|---|---|---|
| `index.html` | `.notes-actions`(`#save-result-btn` 등 버튼 그룹), `<h2>AI 분석 결과 (Kanana)</h2>`(`:83`, 하드코딩), 기존 엔진 안내 모달(`:73, 122-151`) | **수정** — 신규 엔진 선택 버튼 추가(`#save-result-btn` 옆), `<h2>` 동적 표시로 변경. 기존 엔진 안내 모달은 재사용(변경 없음) |
| `js/ai-ui.js` | 엔진 안내 모달 오픈 핸들러(`#ai-engine-info-btn`), `#ai-mode-badge` 갱신(`:157`, `:191`) | **수정** — 신규 버튼 클릭 이벤트·옵션 노출·툴팁 처리 추가, `<h2>` 갱신 로직을 `#ai-mode-badge` 갱신과 같은 지점에 병행 추가, 버튼 비활성화 시 클릭이 기존 엔진 안내 모달을 여는 로직 연결 |
| `js/ai.js` | `OLLAMA_MODEL` 상수(`:183`, 현재 고정), `analyzeWithOllama()`(`:213-232`, `num_predict:1800`), `analyzeWithAI()`(`:318`, `max_tokens:1800`), `detectOllama()`(`:187-202`, 실패 원인 미분류) | **수정** — 모델명을 선택 가능한 값으로 변경, 토큰 한도 상향, `/api/pull` 호출 함수 신규 추가, `detectOllama()`의 `catch (e)` 블록을 실패 유형별로 분류하고 원본 에러를 보존하도록 재작성 |
| `js/main.js` | `saveResult()`(`:461`, `'[AI 분석 결과 (Kanana, ...)]'` 하드코딩) | **수정** — 저장 시점 실제 엔진 반영 |
| `css/style.css` | `.btn-compact`(`:294`), 기존 버튼/모달 스타일 | **추가** — 신규 버튼의 옵션 노출 UI(드롭다운/팝오버) + 툴팁 + 비활성화(회색) 상태 + 디버그 정보 토글 스타일 |

레이어 교차: **UI(index.html/css) + 이벤트 로직(ai-ui.js) + AI 연동(ai.js) + 저장(main.js)** — 다중 레이어 변경입니다. `symptom-chat-interview`와 파일이 겹치지만(`js/ai.js`, `js/ai-ui.js`, `index.html`) 기능적으로 독립적이며, **이 티켓을 먼저 구현**하기로 확정되어 파일 충돌 우려는 낮아졌습니다.

## 2. 화면 설계 — 상태 정의

### 2.1 엔진 선택 버튼 상태

| 상태 | 설명 |
|---|---|
| 기본(닫힘, Ollama 감지됨) | "결과 저장" 버튼 옆에 `.btn.btn-compact` 스타일의 새 버튼만 노출. 현재 선택된 엔진(생각과정 없음/있음)을 버튼 라벨 또는 배지로 표시 |
| 비활성화(Ollama 미감지, 확정) | 버튼은 계속 보이되 회색으로 비활성화. 호버·클릭 시 "Ollama가 필요합니다" 툴팁을 보여주고, 클릭하면 **기존 `#ai-engine-modal-overlay`("AI 엔진 안내" 모달)를 그대로 연다**(신규 안내문 작성 없음) |
| 옵션 노출(열림) | 클릭 시 "생각과정 없음 (현재 기본)" / "생각과정 있음 (qwen3:4b-thinking)" 두 옵션이 드롭다운/팝오버로 노출 |
| 옵션 호버 | 각 옵션에 마우스 오버 시 툴팁 — 무엇을 다운받는지(모델명·예상 용량), 무엇이 다른지(생각과정 유무가 응답에 미치는 차이) 설명 |
| 이미 받아둔 모델 표시 | 옵션 목록에서 이미 로컬에 pull된 모델은 별도 표시(예: 체크 아이콘·"설치됨" 라벨) — 판별 방법은 §3.2 |
| 다운로드 확인(신규, 확정) | 미다운로드 모델 선택 시, `/api/pull` 트리거 **직전** 용량 확인 문구를 노출하고 사용자 동의를 받는다 |
| 다운로드 진행 중(신규) | `/api/pull` 진행 상태 표시 방식은 `requirements.md` §5-1 미결정(프로그레스바 가능 여부 impl 단계 확인) |
| 전환 완료 | 선택된 모델로 이후 분석 요청이 전송됨 |
| Ollama 감지 실패 안내(신규) | `detectOllama()` 실패 시 "Ollama에 연결할 수 없습니다" / "필요한 모델이 설치되어 있지 않습니다" 등 사유 구분 안내 노출 |
| 디버그 정보 토글(신규) | 실패 안내와 별도로 "자세히 보기" 등 토글/버튼으로 원본 에러 메시지·실패 단계를 펼쳐볼 수 있음. 사용자가 복사해 다음 세션에 붙여넣는 용도 |
| 오류 상태(전환/다운로드 실패) | 선택한 모델로의 전환 또는 다운로드가 실패한 경우 — 기존 `statusEl` 오류 표시 패턴 재사용 검토 |

### 2.2 화면 전환 흐름

```
[Ollama 감지됨]                         [Ollama 미감지]
[기본(닫힘) 버튼]                        [비활성화(회색) 버튼]
    ↓ 클릭                                   ↓ 클릭/호버
[옵션 노출]                              [기존 "AI 엔진 안내" 모달 오픈]
    ├─ "생각과정 없음" 선택 → 즉시 전환
    └─ "생각과정 있음" 선택
         ├─(이미 pull됨)→ 즉시 전환
         └─(미다운로드)→ [용량 확인 문구] → 동의 → [/api/pull 트리거 → 다운로드 진행] → 완료 → 전환
[전환 완료] → 이후 AI 분석 요청은 선택된 모델(OLLAMA_MODEL 값)로 발송

(병행 경로)
[detectOllama() 실패] → [실패 사유 안내: 연결 실패 vs 모델 없음] → [디버그 정보 토글로 원본 에러 확인 가능]
```

### 2.3 컴포넌트 계층

- `EngineSelectorButton` — `#save-result-btn` 옆 신규 버튼(신규, `.btn.btn-compact`). Ollama 미감지 시 비활성화 상태(`disabled`)로 렌더링되며, 클릭 핸들러가 기존 `EngineInfoModal`을 여는 쪽으로 분기
- `EngineOptionPopover` — 옵션 2개를 담는 팝오버/드롭다운(신규)
  - `EngineOption` — 개별 옵션(라벨 + "설치됨" 표시 + 호버 툴팁) — 재사용 단위, 2개 인스턴스
- `EngineTooltip` — 옵션 호버 시 설명 텍스트(신규)
- `DownloadConfirmDialog` — `/api/pull` 트리거 직전 용량 확인 문구(신규, 확정)
- `EngineInfoModal` — 기존 `#ai-engine-modal-overlay` 그대로 재사용(변경 없음). Ollama 미감지 버튼 비활성화 상태의 안내 창구로도 겸용
- `OllamaFailureBanner` — `detectOllama()` 실패 사유(연결 실패/모델 없음)를 사용자에게 보여주는 신규 컴포넌트
  - `DebugInfoToggle` — `OllamaFailureBanner` 내부(또는 인접) "자세히 보기" 토글, 원본 에러 메시지·실패 단계 노출(신규)

## 3. 데이터 흐름 설계

### 3.1 모델 선택 상태

현재 `OLLAMA_MODEL`(`js/ai.js:183`)은 모듈 상수로 고정되어 있습니다. 이를 사용자 선택에 따라 바뀌는 상태로 전환해야 합니다(예: 모듈 스코프 변수로 승격, 초기값은 기존과 동일하게 `qwen3:4b-instruct`). 정확한 변수명·저장 위치는 impl 단계에서 결정합니다.

### 3.2 설치 여부 판별

`detectOllama()`(`js/ai.js:187-202`)는 이미 `/api/tags`를 호출해 pull된 모델 목록(`data.models`)을 받아옵니다. 이 응답을 재사용해 `qwen3:4b-thinking`이 목록에 있는지 확인할 수 있습니다. 두 모델의 설치 여부를 각각 판별하도록 이 로직을 일반화해야 합니다.

### 3.3 다운로드 트리거 (확정 — `/api/pull` 자동 호출)

Ollama의 `/api/pull` 엔드포인트를 앱이 직접 호출해 다운로드를 트리거하는 것으로 확정되었습니다(`requirements.md` §3.3). 기존 wllama `onProgress` 콜백 패턴(`js/ai.js:245-274`, `js/ai-ui.js`의 `formatBytes`/`formatRemaining`)과 유사한 UI를 재사용할 수 있는지는, `/api/pull`이 실제로 스트리밍 진행률 응답을 주는지 impl 단계에서 검증한 뒤 결정합니다(`requirements.md` §5-1, 유일하게 남은 미결정).

### 3.4 토큰 한도 파라미터화

`js/ai.js:226` `num_predict: 1800`, `js/ai.js:318` `max_tokens: 1800`을 선택된 모델에 따라 다른 값을 쓰도록 파라미터화합니다(정확한 값은 impl 단계 실측 검증 후 확정). wllama(브라우저 폴백)에도 적용할지는 impl 단계 판단 사항입니다.

### 3.5 엔진 표시 버그 수정 지점

- `index.html:83` `<h2>AI 분석 결과 (Kanana)</h2>` → `id` 부여 후 `js/ai-ui.js`에서 `currentEngine()` 결과에 따라 textContent를 갱신. 갱신 시점은 `#ai-mode-badge`를 갱신하는 두 지점(`js/ai-ui.js:157`, `js/ai-ui.js:191`)과 동일하게 맞춘다.
- `js/main.js:461` — 저장 시점에 `currentEngine()`(또는 이를 import)을 호출해 실제 엔진명을 문자열에 반영. `js/main.js`는 비-module 스크립트(`index.html:161`)이므로 `currentEngine` 접근 방법(전역 노출 vs import 구조 전환)을 impl 단계에서 정해야 함.

### 3.6 `detectOllama()` 실패 분류 재설계 (신규)

현재 구조(`js/ai.js:187-202`):

```js
try {
  const res = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('bad status');
  const data = await res.json();
  const models = (data.models || []).map((m) => m.name);
  ollamaAvailable = models.some((n) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL));
} catch (e) {
  ollamaAvailable = false;
}
```

이 구조는 (a) `fetch` 자체가 실패하는 경우(네트워크 불가·타임아웃·CORS·권한 거부)와 (b) `fetch`는 성공했지만 목록에 대상 모델이 없는 경우를 구분하지 않고 동일하게 `false` 하나로 뭉갭니다. 재설계 방향(구체적 구현은 impl 단계):

- `catch (e)` 블록에서 `e`(에러 객체)를 버리지 않고 별도 상태(예: `lastOllamaError`)에 보존한다.
- 최소한 "연결 자체 실패"(fetch 단계 예외)와 "모델 없음"(정상 응답이나 목록에 없음)을 구분하는 반환값/상태를 추가한다.
- `OllamaFailureBanner`(§2.3)가 이 상태를 읽어 사람이 읽는 안내 문구를 표시하고, `DebugInfoToggle`은 `lastOllamaError`의 원본 메시지·타임스탬프·어느 단계(연결/응답파싱/모델비교)에서 실패했는지를 그대로 노출한다.
- §3.9(`requirements.md`)의 미제 사례처럼 "명령어도 맞고 팝업도 안 떴는데 안 됨" 같은 상황은 현재 정보만으로는 재현하기 어려우므로, 최소한 실패 시점의 원본 에러와 단계 정보를 남기는 것이 이번 개선의 최소 목표다.

## 4. 확정된 결과 요약 (이전 버전의 미결정 항목 해소 결과)

| # | 이전 미결정 항목 | 확정 결과 |
|---|---|---|
| 1 | Ollama 미감지 시 버튼 처리 | 안 2 — 버튼 비활성화(회색) + 기존 "AI 엔진 안내" 모달 재사용 — §2.1, §2.3 |
| 2 | `/api/pull` 진행률 표시 여부 | **여전히 미결정** — `requirements.md` §5-1, impl 단계에서 API 검증 후 확정 |
| 3 | 다운로드 용량 경고 문구 필요 여부 | 보여줌으로 확정 — `/api/pull` 트리거 직전 노출(§2.1 `DownloadConfirmDialog`) |
| — | (신규) 자동 다운로드 자체 채택 여부 | 채택 확정 — 앱이 `/api/pull` 직접 호출(§3.3) |
| — | (신규) 실패 원인 안내·디버그 정보 | 추가 확정 — §2.1, §2.3, §3.6 |

## 5. 기획 검증 체크리스트

- [x] 코드베이스 전수 조사 완료 — `index.html`, `js/ai.js`, `js/ai-ui.js`, `js/main.js`, `css/style.css` 직접 읽고 확인
- [x] 영향 파일 목록 + 의존 관계 정리(§1)
- [x] 화면 상태 전수 정의(§2.1) — 비활성화·다운로드 확인·실패 안내·디버그 토글 포함
- [x] 화면 전환 흐름 정리(§2.2)
- [x] 컴포넌트 계층 식별(§2.3)
- [x] 데이터 흐름 설계 — 확정 사항 반영(§3), 남은 미결정 1건만 명시(§3.3)
- [ ] 이슈 티켓 분리·스프린트 그룹핑 — impl-planner 단계에서 진행 권장
- [x] 제외 범위와의 정합 확인 — `requirements.md` §4와 모순 없음
- [x] `symptom-chat-interview`와의 구현 순서(이 티켓 선행) 명시(본 문서 상단)

## 6. 다음 단계 제안

1. `requirements.md` §5-1(`/api/pull` 진행률 표시 여부)을 impl 단계에서 실제 Ollama API로 검증하며 확정한다.
2. `detectOllama()` 실패 분류 재설계(§3.6)를 impl-planner 단계에서 별도 이슈로 분리해, `js/ai.js`의 다른 변경(모델 선택·토큰 한도)과 독립적으로 리뷰할 수 있게 한다.
3. 이 티켓을 먼저 구현·병합한 뒤 `symptom-chat-interview` 트랙을 진행한다(파일 충돌 방지, 본 문서 상단 확정 사항).
