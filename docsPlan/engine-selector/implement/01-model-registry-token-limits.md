# TICKET-1 — 모델 레지스트리·선택 상태·토큰 한도 파라미터화

파일: `js/ai.js`
선행 티켓: 없음(첫 티켓)
스프린트: Sprint 1

## AS-IS (`js/ai.js` 재확인 결과)

```js
// js/ai.js:179-183
const OLLAMA_URL = 'http://localhost:11434';
// qwen3:4b(생각모드 버전)는 최종 답을 내기 전 영어로 아주 길게 "생각"하다가
// 토큰 한도를 다 써버려 실사용이 어려움 — 바로 한국어 최종 답만 내는
// instruct(생각모드 없는) 버전을 쓴다.
const OLLAMA_MODEL = 'qwen3:4b-instruct';

let ollamaAvailable = null; // null = 미확인, true/false = 확인됨
```

```js
// js/ai.js:213-232 — Ollama 호출, num_predict 고정값
async function analyzeWithOllama(systemPrompt, noteText) {
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [...],
      stream: false,
      options: { temperature: 0.3, num_predict: 1800 },
    }),
  });
  ...
}
```

```js
// js/ai.js:297-323 — 브라우저(wllama) 호출, max_tokens 고정값
export async function analyzeWithAI(noteText, onProgress, followUpAnswerText) {
  ...
  const result = await wllama.createChatCompletion({
    messages: [...],
    max_tokens: 1800,
    temperature: 0.3,
  });
  ...
}
```

`OLLAMA_MODEL`은 `const`로 고정돼 있어 사용자가 선택할 수 없다. `num_predict`/`max_tokens`도 하드코딩된 단일 값(1800)으로, 모델에 따라 다르게 줄 방법이 없다.

## TO-BE

### 1. 모델 레지스트리 도입

`OLLAMA_MODEL` 상수 자리에 두 모델을 기술하는 레지스트리 객체를 추가한다(정확한 자료구조명은 구현 시 확정하되 아래 형태를 기준으로 한다):

```js
const OLLAMA_MODELS = {
  'qwen3:4b-instruct': {
    id: 'qwen3:4b-instruct',
    label: '생각과정 없음 (현재 기본)',
    thinking: false,
    tooltip: '...',       // TICKET-5에서 실제 문구 확정, 여기선 데이터만 제공
    numPredict: 1800,      // 기존값 유지 — 회귀 없음 보장
    approxSizeGB: null,    // 실측 후 채움(§ 위험 #8, 이미 설치 전제이므로 다운로드 대상 아님)
  },
  'qwen3:4b-thinking': {
    id: 'qwen3:4b-thinking',
    label: '생각과정 있음 (qwen3:4b-thinking)',
    thinking: true,
    tooltip: '...',
    numPredict: null,       // TICKET-3 테스트 단계에서 실측 확정(초기값은 요구사항 §3.5 예시범위 4000~6000 중 실측으로 조정)
    approxSizeGB: null,     // 실측 후 채움
  },
};
const DEFAULT_OLLAMA_MODEL_ID = 'qwen3:4b-instruct';
```

### 2. 선택 상태를 모듈 스코프 mutable 변수로 승격

```js
let selectedOllamaModelId = DEFAULT_OLLAMA_MODEL_ID;

export function getSelectedModelId() {
  return selectedOllamaModelId;
}

export function setSelectedModelId(modelId) {
  if (!OLLAMA_MODELS[modelId]) throw new Error('알 수 없는 모델: ' + modelId);
  selectedOllamaModelId = modelId;
}

export function listOllamaModels() {
  // TICKET-5가 옵션 목록 렌더링에 사용
  return Object.values(OLLAMA_MODELS);
}
```

### 3. `analyzeWithOllama()`가 선택된 모델·토큰 한도를 참조하도록 수정

```js
async function analyzeWithOllama(systemPrompt, noteText) {
  const modelConf = OLLAMA_MODELS[selectedOllamaModelId];
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelConf.id,
      messages: [...],
      stream: false,
      options: { temperature: 0.3, num_predict: modelConf.numPredict },
    }),
  });
  ...
}
```

기존 하드코딩 `num_predict: 1800`은 `qwen3:4b-instruct`의 `numPredict` 기본값으로 그대로 보존해 회귀 없음을 보장한다.

### 4. wllama(`max_tokens`) 파라미터화 여부

`requirements.md` §3.5: "wllama(브라우저 내 Kanana)는 이번 신규 옵션과 무관한 별도 엔진이므로, `max_tokens` 조정이 wllama에도 적용되어야 하는지는 impl 단계에서 판단한다." — 이 티켓에서 판단 결과: **wllama 경로(`analyzeWithAI()`의 `max_tokens: 1800`, `js/ai.js:318`)는 건드리지 않는다.** 근거: wllama는 Kanana 전용 고정 엔진이며 생각과정 유무 선택 대상이 아니므로, 이번 레지스트리와 무관한 별도 상수로 남긴다. (이 판단 자체가 구현 중 실측으로 뒤집힐 수 있으면 완료 보고 시 명시)

## 다른 티켓과의 연결

- TICKET-2에 주는 것: `OLLAMA_MODELS` 레지스트리(모델 id 목록) — TICKET-2가 각 모델의 설치 여부를 판별할 때 순회 대상으로 사용.
- TICKET-3에 주는 것: `getSelectedModelId()`/`setSelectedModelId()` — `/api/pull` 트리거 대상 모델 결정에 사용. `modelConf.approxSizeGB` — 다운로드 확인 문구에 사용(단, 값이 `null`이면 TICKET-3에서 실측해 채워야 함).
- TICKET-4에 주는 것: 없음(TICKET-4는 `currentEngine()` 자체를 소비, 이 티켓은 `currentEngine()`을 변경하지 않음 — 단 TICKET-2가 `currentEngine()` 반환값 확장 여부를 결정하므로 TICKET-4는 TICKET-1이 아니라 TICKET-2 완료 후 착수).
- TICKET-5에 주는 것: `listOllamaModels()` — 옵션 팝오버 렌더링 데이터 원본.
- 공유 파일 주의: 이 티켓 이후 `js/ai.js`를 수정하는 TICKET-2·3·4(브릿지)는 반드시 이 티켓이 병합된 최신 상태 위에서 시작한다. `OLLAMA_MODEL`(단수) 상수를 참조하는 다른 코드가 남아있지 않은지(`ollamaAvailable`의 `models.some((n) => n === OLLAMA_MODEL ...)` 등, TICKET-2에서 처리) 확인 필요.

## 완료 기준

- [ ] `OLLAMA_MODELS` 레지스트리, `DEFAULT_OLLAMA_MODEL_ID`, `getSelectedModelId`/`setSelectedModelId`/`listOllamaModels` export 추가
- [ ] `analyzeWithOllama()`가 선택된 모델의 `id`·`numPredict`를 사용하도록 수정, 회귀 없이 `qwen3:4b-instruct` 기본 동작 유지
- [ ] wllama 경로 미변경 유지(판단 근거 코드 주석에 기록)
- [ ] `js/ai-ui.js?v=` 대신 `js/ai.js`를 참조하는 `js/ai-ui.js:1`의 `./ai.js?v=12` 쿼리 버전 갱신
- [ ] 코드 상단 헤더 주석(`js/ai.js:1-14`)에 "모델 선택 가능" 구조로 바뀌었음을 반영
- [ ] 아키텍처 문서 갱신 — 해당 없음(00-overview §9 참고)

## 테스트 항목

- `getSelectedModelId()` 기본값이 `'qwen3:4b-instruct'`인지 콘솔에서 확인
- `setSelectedModelId('qwen3:4b-thinking')` 후 `getSelectedModelId()`가 갱신되는지 확인
- 알 수 없는 모델 id로 `setSelectedModelId()` 호출 시 에러가 발생하는지 확인
- Ollama 실행 중 환경에서 (모델 선택 변경 없이) 기존처럼 `qwen3:4b-instruct`로 분석이 정상 동작하는지(회귀 확인 최우선)
