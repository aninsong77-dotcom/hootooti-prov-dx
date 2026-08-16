# 안내형 문진 위저드 — 구조 설계

작성: 2026-08-13. 짝 문서: `requirements.md`(무엇을 만들지).
이 문서는 **어떤 파일을 만들고 고칠지, 기존 코드를 어디서 자를지**만 정한다.

---

## 1. 지배적 제약 두 가지

이 설계의 거의 모든 선택은 아래 두 제약에서 나온다.

**(가) 위저드 코드는 반드시 일반 스크립트(비-module)여야 한다.**
requirements §4.6 — 파일로 직접 열었을 때(`file://`) 브라우저가 ES 모듈을 차단한다.
`main.js`가 일반 스크립트라 체크리스트가 살아남는 것과 같은 이유다.
→ 위저드·채점·게이트 데이터는 전부 일반 스크립트, **AI 연동만 module**로 분리한다.
→ 모듈 간 연결은 `import`가 아니라 **전역 브릿지**로 한다(기존 `window.__hututiEngine`과 동일 패턴).

**(나) 기존 채팅 경로를 깨뜨리지 않는다.**
`ai-ui.js`(1209줄)는 **한 줄도 수정하지 않는다.** `ai.js`는 추출 리팩터만 하고
기존 함수의 동작은 동일하게 유지한다.

## 2. 파일 목록

### 2.1 신규

| 파일 | 종류 | 책임 |
|---|---|---|
| `js/scoring.js` | 일반 스크립트 | `main.js`에서 추출한 **순수 채점 로직**. 상태를 갖지 않고 인자로만 받는다 |
| `js/gates.js` | 일반 스크립트 | 게이트 정의 데이터(질문 문구·대상 진단 id·정렬 키워드). R13 대응 |
| `js/wizard.js` | 일반 스크립트 | 위저드 진행·상태·렌더링·sessionStorage. index.html의 두뇌 |
| `js/wizard-ai.js` | **module** | "AI 설명 받기" 연동. `ai.js`를 import하고 전역 브릿지로 wizard.js와 통신 |
| `chat.html` | HTML | 기존 채팅 UI 이관처(현 index.html 본문 그대로) |

### 2.2 수정

| 파일 | 수정 내용 | 위험도 |
|---|---|---|
| `js/main.js` | 채점부를 `scoring.js`로 이관하고 그것을 호출하도록 변경. 페이지 초기화 분기 정리 | **높음** — checklist.html 회귀 (R10) |
| `js/ai.js` | 엔진 호출부를 `runEngine()`으로 추출 + `explainCandidates()` 신규 | **중간** — 채팅 회귀 (R11) |
| `index.html` | 본문을 위저드 화면으로 교체. `noindex` 추가 | 중간 |
| `checklist.html` | `scoring.js` 스크립트 태그 추가(로드 순서: data → scoring → main) | 낮음 |

### 2.3 손대지 않음

`js/ai-ui.js` · `js/data.js` · `js/context-budget.js` · `js/icd11.js` ·
`about.html` · `icd11.html` · `coi-serviceworker.min.js`

`css/style.css`는 위저드용 클래스를 **추가만** 한다(기존 규칙 수정·삭제 금지 —
checklist·chat이 같은 파일을 쓴다).

## 3. 추출 경계 (가장 중요한 부분)

### 3.1 `main.js` → `js/scoring.js`

**떼어낼 것**: 현재 `js/main.js:44-63`의 세 함수.

```
keyOf(diagId, g, i)            44행
groupSatisfied(diag, gIdx)     47-52행
diagnosisScore(diag)           54-63행
```

**문제**: 이 함수들은 파일 상단의 `var checked = {}`(모듈 전역 상태)를 직접 읽는다.
그대로 옮기면 상태가 따라와 순수 함수가 되지 못한다.

**해결**: `checked`를 **인자로 받도록 시그니처를 바꾼다.**

```js
// js/scoring.js — 상태 없음. 어떤 화면에서든 재사용 가능.
window.HututiScoring = {
  keyOf: function (diagId, g, i) { ... },
  groupSatisfied: function (diag, gIdx, checked) { ... },
  diagnosisScore: function (diag, checked) { ... },
};
```

`main.js`는 자기 `checked`를 넘겨 호출하는 형태로만 바뀐다.

```js
// 변경 전                          // 변경 후
diagnosisScore(d)                   HututiScoring.diagnosisScore(d, checked)
```

**동치 보장(R10 필수 조건)**: 추출 전후 결과가 같음을 단위 테스트로 증명한 뒤에만
`main.js`를 고친다. §6.1 참조.

### 3.2 `ai.js` → `runEngine()` 추출

**떼어낼 것**: `js/ai.js:1071-1130` — `analyzeWithAI()` 안의 엔진 호출 구간.
(Ollama 시도 → 실패 시 `detectOllama(true)` → 카나나 폴백 → 스트리밍/비스트리밍 분기 →
`finalizeModelOutput`)

프롬프트 조립부(1044-1058)와 엔진 호출부(1071-1130)가 위아래로 이미 나뉘어 있어
경계가 명확하다. `abortSignal` 체크(1085-1087)와 `ensureModelLoaded`(1089)도 함께 옮긴다.

```js
// 추출 결과 — 프롬프트가 무엇이든 상관하지 않는 순수 엔진 호출부
async function runEngine(messages, opts) {
  // opts: { onProgress, onDelta, abortSignal, maxTokens, kananaMessages }
  // 반환: finalizeModelOutput()을 거친 최종 텍스트
}
```

**주의**: 카나나 경로는 `fitMessagesForKanana(systemPrompt, conversation, 1800)`로
예산 가드를 태운 메시지를 쓴다(1099행). 이 함수는 `conversation` 배열 형태를 전제하므로,
위저드처럼 대화가 없는 호출에서는 **가드용 메시지를 호출부가 만들어 넘긴다**
(`opts.kananaMessages`). 위저드는 단발 프롬프트라 탈락시킬 오래된 턴이 없다.

`analyzeWithAI()`는 이 함수를 호출하도록만 바뀌며 **외부 동작은 완전히 동일**해야 한다.
`analyzeWithAISequential`·`beginSequentialTurn`·`stepSequentialTurn`은 손대지 않는다.

### 3.3 `ai.js` → `explainCandidates()` 신규

```js
export async function explainCandidates(payload, onProgress, abortSignal) {
  // payload: { candidates: [...], gateSummary: {...} }
  // 1) 전용 프롬프트 조립 (buildSystemPrompt 재사용 ❌ — 채팅용이라 후속질문·섹션 마커가 섞임)
  // 2) runEngine() 호출
  // 3) 텍스트 반환
}
```

**프롬프트 크기 상한(requirements §4.4)**:

- 후보는 **상위 5개**까지만 싣는다 (`met` 우선, 그다음 `ratio` 내림차순 — `main.js`의
  기존 정렬 규칙과 동일).
- 각 후보에는 **체크된 항목의 문구만** 싣는다. 미체크 항목과 기준 전문은 싣지 않는다.
- `duration`·`other`는 후보당 1줄씩만.
- 조립 후 `context-budget.js`로 토큰 근사치를 재확인하고, 초과 시 후보 수를 5→3→1로
  줄인다(안전망 — 상한 설계상 도달할 일이 없어야 정상).

## 4. 전역 브릿지 (모듈 경계 연결)

`wizard.js`(일반)와 `wizard-ai.js`(module)는 서로 import할 수 없으므로 전역으로 연결한다.
기존 `window.__hututiEngine`·`window.__hututiChat`과 같은 패턴이다.

```js
// wizard.js가 노출 — 결과 저장·AI 요청 재료
window.__hututiSession = {
  getSnapshot: function () { ... },   // { notes, gateAnswers, checked, candidates }
  reset: function () { ... },
};

// wizard-ai.js가 노출 — wizard.js가 "AI 설명 받기" 버튼에서 호출
window.__hututiWizardAI = {
  available: true,                     // module 로드 실패(file://) 시 아예 정의되지 않음
  explain: function (payload, cbs) { ... },
};
```

**핵심**: `wizard.js`는 `window.__hututiWizardAI`가 **없어도 정상 동작**해야 한다.
없으면 "AI 설명 받기" 버튼을 숨기고 나머지 기능은 전부 제공한다
(requirements §4.6 파일 배포 시나리오가 이 조건으로 성립한다).

## 5. 화면 구성 — `index.html`

헤더·푸터·면책 박스(`.disclaimer-box-small`)는 **현재 것을 그대로 유지**한다.
`<section class="assist-layout chat-with-results">` 본문만 교체한다.

단일 페이지 안에서 3단계를 전환한다(페이지 이동 없음).

```
#wizard-root
├── #step-notes    [0] 소견 입력 — textarea + "건너뛰기" / "시작하기"
├── #step-gate     [1] 게이트 — 질문 1개 + 예/아니오/모름 3버튼
│                      진행률 "12 / 23", "이전 질문" 버튼
│                      키워드 매칭 근거 표시줄 + 순서 수동 조정
└── #step-detail   [2][3] 정밀 체크 + 결과
    ├── .detail-main     걸린 범주는 펼침 / "아니오" 범주는 하단 접힘
    └── .detail-results  채점 결과(즉시) + "AI 설명 받기" + "결과 저장" + "처음부터 다시"
```

정밀 체크 단계의 진단 카드 렌더링은 `main.js`의 `renderDiagnosis()`와 같은 마크업을
쓰되, `wizard.js`가 **걸린 범주만 골라** 그린다. 기존 CSS 클래스를 그대로 재사용한다.

`<head>`에 `<meta name="robots" content="noindex">` 추가(requirements §8.1).
경고 문구는 `#step-notes` 최상단에 배치하고, `.txt` 내보내기 머리말에도 같은 문구를 넣는다.

## 6. 회귀 방지

### 6.1 채점 추출 동치 테스트 (착수 조건)

`main.js` 수정 **전에** 통과해야 한다.

- 81개 진단 전부에 대해 무작위 체크 조합 1000회를 생성
- 추출 전 로직(현재 main.js 복사본)과 `scoring.js`의 결과(`met`·`ratio`·`groupResults`)를 비교
- **완전 일치**해야 진행. node로 실행(`data.js`는 브라우저 전역 전제라 테스트 하네스에서 주입)

### 6.2 스모크 체크리스트

| 대상 | 확인 항목 |
|---|---|
| `checklist.html` | 체크 시 배지·진행률·우측 결과·내보내기가 이전과 동일 |
| `chat.html` | 채팅 전송·엔진 선택·모델 다운로드·결과 저장이 이전과 동일 |
| `index.html` | 위저드 3단계 왕복, 새로고침 후 이어하기, "처음부터 다시" |
| 파일 열기(`file://`) | 위저드·채점·저장 작동 + AI 버튼이 **숨겨져 있고** 콘솔 에러 없음 |
| AI 설명 | 호출 **1회**로 완료, `(ABORT)` 없음, 프롬프트 크기 상한 준수 |

### 6.3 롤백 경로

`chat.html`이 살아 있으므로, 위저드에 문제가 생기면 `index.html`을 이전 커밋으로
되돌리는 것만으로 원상복구된다. `scoring.js` 추출은 §6.1을 통과한 경우에만 병합한다.

## 7. 작업 순서 (티켓)

| # | 티켓 | 산출물 | 선행 |
|---|---|---|---|
| T1 | 채점 로직 추출 | `js/scoring.js` + 동치 테스트 + `main.js`·`checklist.html` 반영 | — |
| T2 | 게이트 데이터 작성 | `js/gates.js` (21~23문항, data.js에서 도출) | — |
| T3 | 채팅 이관 | `chat.html` + `main.js` 초기화 분기 정리(R12) | — |
| T4 | 위저드 본체 | `js/wizard.js` + `index.html` + CSS 추가 | T1·T2·T3 |
| T5 | AI 엔진 추출 | `js/ai.js` `runEngine()` + `explainCandidates()` | — |
| T6 | AI 연동 | `js/wizard-ai.js` + 위저드 버튼 연결 | T4·T5 |
| T7 | 마무리 | 결과 `.txt` 내보내기, noindex, 경고 문구, README 갱신 | T6 |

T1·T2·T3·T5는 서로 독립이라 순서를 바꿔도 된다. **T1은 §6.1 통과 전 병합 금지.**

## 7.1 진행 현황 (2026-08-13~14 구현, 커밋 전)

T1~T7 전부 구현 완료. 검증 결과:

| 검증 | 결과 |
|---|---|
| 채점 추출 동치 테스트 (§6.1) | **PASS** — 81개 진단 × 1002개 조합 = 81,162 케이스 완전 일치 |
| `checklist.html` 회귀 (브라우저) | **PASS** — 배지·진행률·결과 순위·해제·초기화·검색, 콘솔 에러 0 |
| 위저드 전 흐름 (`file://`) | **PASS** — 22문항 순회·되돌아가기·정밀 체크·새로고침 이어하기·초기화 |
| AI 없이 완주 (`file://`) | **PASS** — AI 버튼 자동 숨김, 나머지 기능 정상 |
| http 환경 | **PASS** — AI 브릿지 로드, 체크 후 버튼 노출 |
| AI 페이로드 상한 (§3.3) | **PASS** — 후보 5개 이하, 근거는 체크된 항목만, 기준 전문 미포함 |
| `chat.html` 이관 | **PASS** — 전송·엔진 선택 UI 정상 |
| 게이트 커버리지 | **PASS** — 81개 진단이 22개 게이트에 빠짐없이·중복 없이 배분 |

`file://`에서 나오는 콘솔 에러(모듈 CORS 차단·서비스워커 미등록)는 §1(가)에서 예상한
브라우저 정책 그대로이며, 그 상황에서 AI 버튼이 숨겨지는 것으로 대응된다.

**계획에서 벗어난 점 1건**: `ai-ui.js` "수정 0"을 지키지 못했다. `ai.js`가 바뀌면서
캐시 무효화를 위해 import 구문의 버전 문자열만 `?v=29 → ?v=30`으로 바꿨다(1줄).
그대로 두면 `ai.js`가 서로 다른 두 모듈 인스턴스로 로드될 여지가 있어 바꾸는 편이 안전하다.

**아직 검증되지 않은 것**: 실제 AI 설명 생성(모델 다운로드·추론)은 자동 테스트에
포함하지 않았다 — 1.4GB 다운로드와 수 분의 추론이 필요해 실사용 테스트로 판정한다.

## 8. 이 문서에서 의도적으로 정하지 않은 것

- 게이트 질문의 **구체적 문구** — T2에서 data.js를 읽으며 확정한다(초안 후 사용자 검토).
- CSS 세부 디자인 — 기존 클래스 재사용을 원칙으로 하고 T4에서 필요한 만큼만 추가.
- 키워드 사전의 구체적 어휘 — T2에서 게이트별로 함께 작성(R14 기대치 참고).
