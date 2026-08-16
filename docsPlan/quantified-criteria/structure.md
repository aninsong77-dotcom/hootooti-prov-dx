# 정량 기준 판정 + 채팅 틀 문답 화면 — 구조 설계

작성: 2026-08-16. 짝 문서: `requirements.md`.
이 문서는 **어떤 파일을 만들고 고칠지, 데이터를 어떤 모양으로 둘지**만 정한다.

---

## 1. 가장 중요한 구조 결정 — `data.js`를 건드리지 않는다

외부 문서는 `data.js`의 각 진단 객체 안에 `rules`를 넣자고 제안했다. **그렇게 하지 않는다.**

- `data.js`는 임상 콘텐츠(진단명·증상 문구)다. 기계용 규칙을 섞으면 임상 자문을 받을 때
  사람이 읽어야 할 것과 코드가 읽을 것이 뒤엉킨다.
- `data.js`를 수정하지 않으면 `checklist.html`·`chat.html` **회귀 위험이 0**이다.
- 규칙을 별도 파일에 두면 각 규칙 옆에 **원문을 그대로 복사해 붙일 수 있어**, 자동 대조
  검증(요구사항 §8)이 파일 하나만 읽어 끝난다.

→ 규칙은 신규 파일 `js/criteria.js`에 **진단 id를 키로 하는 별도 표**로 둔다.

## 2. 파일 목록

### 2.1 신규

| 파일 | 종류 | 책임 |
|---|---|---|
| `js/criteria.js` | 일반 스크립트 | 46개 정량 규칙 + 정성 표시. 각 항목에 `source`(원문 그대로) 동반 |
| `js/criteria-engine.js` | 일반 스크립트 | 5상태 판정 엔진(순수 함수, DOM·네트워크 의존 없음) |
| `js/interview.js` | 일반 스크립트 | 채팅 틀 문답 진행·말풍선 렌더링 (2단계, `wizard.js` 대체) |

### 2.2 수정

| 파일 | 내용 | 단계 |
|---|---|---|
| `js/gates.js` | ADHD 단독 게이트 분리(22→23), `source_items` 추가, 문구 점검 | 1 |
| `index.html` | 채팅 틀 마크업으로 교체 | 2 |
| `js/wizard-ai.js` | AI 결과를 말풍선으로 출력하도록 연결부만 변경 | 2 |
| `js/ai.js` | `explainCandidates` 페이로드에 축별 판정 추가 | 2 |
| `css/style.css` | 위저드 전용 규칙 제거, 말풍선 내 버튼·체크박스 규칙 추가 | 2 |
| `README.md` | 동작 설명 갱신 | 2 |

### 2.3 삭제

| 파일 | 시점 |
|---|---|
| `js/wizard.js` | 2단계 (`interview.js`로 대체) |

### 2.4 손대지 않음

`js/data.js` · `js/scoring.js` · `js/ai-ui.js` · `js/context-budget.js` · `js/main.js` ·
`checklist.html` · `chat.html` · `about.html` · `icd11.html`

## 3. `js/criteria.js` 스키마

```js
window.HututiCriteria = {
  'dep-mdd': {
    // 원문 그대로 — 자동 대조 검증의 기준이자 사람이 읽는 근거
    source: {
      duration: '위 증상 중 다수가 2주 이상 거의 매일 지속(우울감 또는 흥미상실 중 1개는 반드시 포함)',
      other: '증상으로 인한 뚜렷한 고통이나 사회적·직업적 기능 저하가 있어야 하며 …',
    },
    duration: { min: { value: 2, unit: 'weeks' } },
    frequency: { level: 'most_days' },
    impairment: { required: true },
  },

  // 상한이 있는 경우 — 경계 포함 여부를 반드시 명시
  'ps-schizophreniform': {
    source: { duration: '증상 지속기간이 1개월 이상 6개월 미만' },
    duration: {
      min: { value: 1, unit: 'months' },
      max: { value: 6, unit: 'months' },
      maxInclusive: false,          // "미만" → 6개월 정확히는 FAIL
    },
  },

  // 연령 하한이 있는 경우 (결함 ③ 정정)
  'pd-antisocial': {
    source: { duration: '18세 이상에서 진단, 15세 이전 품행장애 병력 필요' },
    age: { min: { value: 18, unit: 'years' } },
    notes: ['15세 이전 품행장애 병력이 있어야 함 — 직접 확인 필요'],
  },

  // 소아/성인 기준이 다른 경우 (결함 ⑨)
  'dep-pdd': {
    source: { duration: '우울한 기분이 최소 2년(소아·청소년은 1년) 동안 …' },
    duration: {
      min: { value: 2, unit: 'years' },
      minIfUnder: { age: 18, value: 1, unit: 'years' },
    },
    notes: ['2개월 이상 증상이 없는 기간이 없어야 함 — 직접 확인 필요'],
  },

  // 기간이 면제되는 예외 조항 (결함 ⑨)
  'bp-1': {
    source: { duration: '증상이 최소 1주간 … 지속(입원이 필요할 정도면 기간 무관)' },
    duration: { min: { value: 1, unit: 'weeks' } },
    exceptions: [
      { id: 'hospitalized', label: '입원이 필요할 정도로 심각함', waives: ['duration'] },
    ],
  },

  // 기간 + 빈도 복합 (결함 ⑧⑨)
  'elim-enuresis': {
    source: { duration: '3개월 연속 주 2회 이상, 또는 임상적으로 뚜렷한 고통·기능저하' },
    duration: { min: { value: 3, unit: 'months' } },
    frequency: { minCount: 2, per: 'week' },
    age: { min: { value: 5, unit: 'years' } },
  },

  // 축별로 정성인 경우 (결함 ①②)
  'ocd-ocd': {
    source: { duration: '하루 1시간 이상을 소요하는 등 시간소모적임' },
    dailyTime: { min: { value: 1, unit: 'hours' } },   // 기간이 아니라 하루 소요시간
    duration: { qualitative: true },                    // 발병 후 지속기간 규정은 없음
    impairment: { required: true },
  },
  'trauma-adjustment': {
    source: { duration: '스트레스 요인 발생 후 3개월 이내 발생, 스트레스 요인 종료 후 6개월 이내 소실' },
    duration: { qualitative: true },   // "종료 후 6개월"은 지속기간 상한이 아님
    notes: ['스트레스 요인 발생 후 3개월 이내 발병했는지 직접 확인', '스트레스 요인 종료 후 6개월 이내 소실하는지 직접 확인'],
  },
};
```

**규칙이 아예 없는 35개 정성 진단**은 이 표에 `{ source: {...}, qualitative: true }` 형태로
등록한다. 표에 없으면 "규칙 미작성"과 "정성 판정"이 구분되지 않으므로 **81개 전부 등록**한다.

## 4. `js/criteria-engine.js` — 판정 엔진

```js
window.HututiCriteriaEngine = {
  evaluate: function (criteria, input) { … },   // 축별 + 종합 결과
  compareDuration: function (a, b) { … },       // 단위 비교 (§4.2)
};
```

**입력**

```js
input = {
  age: 34,                                   // 내담자 연령 (진단 공통, 1회 입력)
  duration: { value: 3, unit: 'months' },    // 이 진단에 대한 지속 기간
  frequency: 'most_days' | { count: 2, per: 'week' },
  impairment: true,
  dailyTime: { value: 2, unit: 'hours' },
  exceptions: { hospitalized: true },
  // 입력하지 않은 축은 undefined → UNKNOWN
}
```

**출력** — 조기 반환하지 않고 **모든 축을 끝까지 평가**한다(결함 ⑥ 정정).

```js
{
  overall: 'PASS' | 'FAIL' | 'UNKNOWN' | 'QUALITATIVE',
  axes: {
    duration:   { status: 'FAIL', reason: '최소 6개월 필요 / 3개월 입력됨', need: '6개월 이상' },
    age:        { status: 'NA' },
    frequency:  { status: 'UNKNOWN', need: '주 2회 이상' },
    impairment: { status: 'PASS' },
    dailyTime:  { status: 'NA' },
  },
  notes: ['15세 이전 품행장애 병력이 있어야 함 — 직접 확인 필요'],
}
```

### 4.1 종합 규칙

`FAIL` 하나라도 → `FAIL` / `FAIL` 없고 `UNKNOWN` 있으면 → `UNKNOWN` /
전부 `PASS`·`NA` → `PASS`. `NA`는 종합에서 제외한다.
축이 전부 `QUALITATIVE`·`NA`면 종합은 `QUALITATIVE`.

### 4.2 단위 비교 (결함 ④ 정정)

일수 환산을 기본으로 쓰지 않는다.

- **같은 계열이면 정확 비교** — `years↔months`(×12), `weeks↔days`(×7), `hours` 단독
- **계열이 다르면**(예: 규칙 `months` vs 입력 `days`) 근사 환산(`months=30.44`,
  `years=365.25`) 후 비교하되, 두 값의 차이가 **5% 이내면 `UNKNOWN`**으로 반환한다
  ("단위가 달라 경계에서 판정할 수 없음"). 조용히 틀린 판정을 내지 않기 위함이다.
- 입력 UI가 규칙과 같은 단위를 제시해 이 경로 자체를 최소화한다(요구사항 §5.4).

### 4.3 빈도 비교

- 수준형: `occasional(1) < most_days(2) < almost_always(3)` — 입력 수준 ≥ 요구 수준이면 `PASS`
- 횟수형: `per`가 같으면 직접 비교. 다르면(주 vs 월) 주→월 ×4 근사 후 §4.2와 같은 5% 규칙 적용

### 4.4 예외 조항

`exceptions[].waives`에 적힌 축은 해당 예외가 참일 때 `NA`로 바꾼다
(예: 제1형 양극성장애에서 "입원 필요" 체크 시 기간 축 면제).

## 5. 게이트 개정 (`js/gates.js`)

- `g-nd-attention`에서 **ADHD를 분리** → `g-nd-adhd`(nd-adhd 단독),
  `g-nd-motor`(nd-dcd, nd-tourette). 총 **23개**.
- 각 게이트에 `source_items: ['진단id: 원문 항목', …]` 추가 — 문구의 출처를 코드에 남긴다.
- 기존 필드(`keywords`·`category`·`diagIds: null` 자동 확장)와 헬퍼 함수
  (`resolveDiagIds`·`findCoverageGaps`·`rankGates`)는 **그대로 유지**한다.
- `findCoverageGaps`에 **`source_items`가 실제 `data.js` 항목인지 검사**하는 기능을 더한다.

## 6. 화면 매핑 (2단계) — `chat.html` 틀 → `index.html`

| chat.html 요소 | 새 용도 |
|---|---|
| `.chat-messages` | 문답 말풍선이 쌓이는 영역 |
| `.chat-message assistant` | 후투티가 던지는 질문 |
| `.chat-input-bar` | **소견 입력 전용**. 그 단계가 끝나면 비활성 |
| `.chat-actions` | 처음부터 다시 · 결과 저장 · AI 선택 |
| `.results-col` | 유력한 진단 + **축별 판정 배지** |
| `#engine-select-btn` 등 | 그대로 유지(AI 모델 선택) |

말풍선 안에 들어가는 새 요소는 `.bubble-answers`(답변 버튼 묶음),
`.bubble-checklist`(체크박스 묶음), `.bubble-input`(기간·연령 입력)으로 추가한다.

## 7. 티켓

| # | 티켓 | 산출물 | 단계 |
|---|---|---|---|
| T1 | 규칙 데이터 작성 | `js/criteria.js` (81개 전부 등록) | 1 |
| T2 | 원문 대조 검증 | 스크래치패드 스크립트 — 모든 수치가 `source` 원문에 실재 | 1 |
| T3 | 판정 엔진 | `js/criteria-engine.js` + 경계값 단위 테스트 | 1 |
| T4 | 게이트 개정 | `js/gates.js` 23문항 + `source_items` + 검사 강화 | 1 |
| T5 | 문답 화면 | `js/interview.js` + `index.html` + CSS | 2 |
| T6 | AI 연동 | 축별 판정을 페이로드에 추가, 말풍선 출력 | 2 |
| T7 | 정리 | 위저드 제거, README, 회귀 스모크 | 2 |
| T8 | 증상 라벨 | 395개 항목 라벨(무라벨 허용) | 3 |

T1~T4는 화면을 바꾸지 않으므로 언제든 되돌릴 수 있다. **T3의 단위 테스트를 통과하기
전에는 T5에 들어가지 않는다.**

## 7.1 진행 현황 (2026-08-16 구현, 커밋 전)

**1·2단계(T1~T7) 구현 완료. 3단계(T8 증상 라벨)는 미착수.**

| 검증 | 결과 |
|---|---|
| 규칙 수치 원문 대조 (T2) | **PASS** — 243건, 원문에 없는 수치 0건 |
| 판정 엔진 단위 테스트 (T3) | **PASS** — 54건 (경계값·소아 분기·예외·단위 모호성 포함) |
| 미입력 안전성 | **PASS** — 입력 없이 충족되는 진단 0개, 축 0개 |
| 게이트 커버리지 (T4) | **PASS** — 81개 진단이 23개 게이트에 빠짐없이·중복 없이 |
| 문답 화면 (`file://`) | **PASS** — 23문항 순회·전사 유지·체크·정량 입력·새로고침 이어하기·초기화 |
| AI 없이 완주 | **PASS** — `file://`에서 AI 버튼 미노출, 나머지 정상 |
| http 환경 | **PASS** — AI 브릿지 로드, 축별 판정이 페이로드에 포함됨 |
| 회귀 | **PASS** — `checklist.html`·`chat.html` 무영향 |

### 계획에서 벗어난 점

1. **AI 엔진 선택 모달을 새 화면에 넣지 않았다.** 구조 설계 §6은 `#engine-select-btn`
   유지를 적었으나, 그 UI는 `js/ai-ui.js`(1209줄, 자유 대화 전용)에 묶여 있어 문답
   화면에 끌어오면 채팅 요소를 찾다 실패한다. 엔진은 자동 선택(Ollama 있으면 Ollama,
   없으면 카나나)하고 어느 엔진을 쓰는지 상태줄에 표시하는 것으로 대체했다.
   모델을 직접 고르려면 `chat.html`에서 고르면 그 설정이 공유된다.
2. **`js/wizard-ai.js`를 수정하지 않고 `js/interview-ai.js`로 새로 만들고 삭제**했다.
   이름이 화면과 어긋난 채 남는 것보다 낫다고 판단했다.
3. **결함이 1건 더 발견돼 정정**했다(요구사항 §5.3에 ⑩으로 추가하지 않고 여기 기록).
   품행장애·물질사용장애·도박장애의 "12개월"은 지속 기간이 아니라 **증상을 세는 기간
   창**이다("최근 12개월 이내 3개 이상 항목 충족"). 지속 기간 최소값으로 넣으면
   "12개월 지속"만으로 통과하고 정작 진짜 기준은 확인되지 않는다. 셋 다 기간 축을
   정성으로 돌리고 안내 문구를 달았다. 그 결과 계산 가능한 축을 가진 진단은 **45개**다.

### 추가 작업 — 자유 대화 흡수 (2026-08-16, 사용자 요청)

`chat.html`의 자유 대화를 문답 화면 안으로 들여왔다. 입력창이 **3단계로 살았다 죽는다.**

| 단계 | 입력창 | 하는 일 |
|---|---|---|
| 소견 | 활성 | 소견을 받아 문항 순서를 정한다 |
| 문답 중 | **비활성** | 버튼으로만 답한다 |
| 문답 종료 | 활성 | AI에게 추가 질문 (`followUpChat`) |

**문답 중에 자유 입력을 받지 않는 것이 핵심이다.** 그 구간에 입력을 받아 AI를 부르면
호출이 누적돼 과거 채팅과 똑같이 느려지고 `(ABORT)`로 죽는다.

후속 대화는 과거 채팅보다 안전하다 — 81개 진단 사전이 아니라 **이미 좁혀진 결과
(후보 3개와 판정)**만 문맥으로 들고 시작하고, `fitMessagesForKanana()` 예산 가드가
그대로 적용된다. 그래도 무한은 아니라서 사용자 턴이 6회를 넘으면 "새로 시작하는 것이
좋겠다"는 안내 말풍선을 띄운다.

`index.html` 메뉴에서 `chat.html` 링크를 뺐다. 파일과 `js/ai-ui.js`는 **되돌릴 경로로
남겨둔다** — 실사용에서 문답 화면이 자유 대화를 충분히 대체한다고 확인되면 그때 삭제한다.

### 추가 작업 — 길이 줄이기 · 증상 라벨 · ICD 페이지 수정 (2026-08-16)

**정량 질문 후보 5 → 3개** (`MAX_PARAM_CANDIDATES`). 후보마다 2~3개씩 물으므로 5개면
입력이 최대 15개까지 늘어 체감이 크게 길어진다. 3개면 6~9개다. 빠진 후보도 목록에는
남고 "미확인"으로 표시되므로 사라지지 않는다.
**게이트 23문항을 묶어 보여주는 안은 채택하지 않았다** — 클릭 수가 줄지 않고(23회 동일)
체감만 짧아지는 대신, 여러 문항을 한꺼번에 보면 대충 훑고 넘길 위험이 커진다.
빠짐없이 훑는 것이 이 도구의 핵심이라 맞바꿈이 나쁘다고 판단했다.

**증상 라벨(3단계, T8) 구현** — `js/symptom-tags.js`. 395개 항목에 사람이 라벨을 달면
검증 불가능한 새 임상 판단이 395개 생기므로, **낱말 표를 공개해 두고 문구에서 판별**한다.
정확히 한 갈래에만 걸릴 때만 라벨을 주고 **두 갈래 이상이거나 안 걸리면 무라벨**이다.
현재 395개 중 187개(47%)에 라벨이 붙는다(생각 35 · 행동 58 · 감정 57 · 신념 37).
필터 기능은 만들지 않았다 — 분류가 틀린 항목이 숨겨지면 이 트랙이 막아온 false negative가
재현된다.

> **발견**: 4분류가 **신체 증상을 담지 못한다.** "체중이나 식욕의 변화", "불면 또는
> 과다수면", "피로감이나 활력 상실" 같은 항목이 생각·행동·감정·신념 어디에도 안 맞아
> 무라벨로 남는다. 원 설계안이 가져온 분류 체계 자체의 빈 곳이다. 다섯째 갈래(신체)를
> 더할지는 사용자 결정 사항으로 남긴다.

**ICD-11 페이지 수정** (이 트랙 범위 밖이지만 같은 원인) — `icd11.js`가 module + `fetch`
방식이라 파일을 직접 열면 149개 항목이 하나도 안 나왔다(2026-08-16 실측). 데이터를
`js/icd11-data.js`(일반 스크립트)로 옮기고 `icd11.js`도 일반 스크립트로 바꿔
`file://`에서도 149개가 정상 렌더링된다. 원본 JSON은 보관하되 **생성 파일과 어긋나지
않도록** 헤더에 재생성 안내를 적었다.

### 아직 검증되지 않은 것

- **실제 AI 설명 생성** — 모델 1.4GB 다운로드와 수 분의 추론이 필요해 자동 테스트에서
  제외했다. 실사용 테스트로 판정한다.
- **문진 23문항과 규칙 46건의 임상적 타당성** — 원문 일치는 증명했으나 원문 자체의
  옳음은 증명하지 못한다(요구사항 §10-1).

## 8. 의도적으로 정하지 않은 것

- 말풍선 안 입력 위젯의 세부 디자인 — T5에서 기존 CSS 재사용을 원칙으로 결정
- 증상 라벨의 분류 기준 — T8에서 별도 검토(요구사항 §7)
