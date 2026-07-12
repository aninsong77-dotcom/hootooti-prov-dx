# TICKET-3 — Ollama `/api/pull` 자동 다운로드 연동

파일: `js/ai.js`
선행 티켓: TICKET-1, TICKET-2
스프린트: Sprint 1

## AS-IS

`js/ai.js`에는 Ollama 모델을 다운로드하는 로직이 전혀 없다(현재는 사용자가 터미널에서 `ollama pull qwen3:4b-instruct`를 수동 실행 — `index.html:149-150` 안내 문구). `requirements.md` §3.3에서 이 방식을 뒤집어 앱이 `/api/pull`을 직접 호출하도록 확정했다.

참고 가능한 기존 패턴: `ensureModelLoaded()`(`js/ai.js:245-274`)가 wllama 모델 다운로드 시 `progressCallback: ({ loaded, total }) => onProgress(loaded, total)` 형태로 진행률을 넘기고, `js/ai-ui.js`의 `formatBytes`/`formatRemaining`(`:3-12`)이 이를 사람이 읽는 문구로 변환한다.

## 선행 작업 — 스트리밍 진행률 실제 확인 (미결정 해소 시도)

이 티켓의 첫 단계는 코드 작성이 아니라 **실측**이다. 로컬에 Ollama가 설치된 환경에서 아래를 직접 호출해 응답 형태를 확인한다:

```
POST http://localhost:11434/api/pull
Body: { "name": "qwen3:4b-thinking" }
```

확인할 것: 기본값(`stream` 생략 시)이 NDJSON(줄바꿈으로 구분된 JSON) 스트림으로 `{status, digest, total, completed}` 형태의 진행 이벤트를 순차 반환하는지, 아니면 완료까지 단일 응답만 오는지. **이 결과에 따라 아래 두 구현 경로 중 하나를 택한다** — 임의로 가정하지 않는다.

### 경로 A: 스트리밍 진행률 확인됨

```js
export async function pullOllamaModel(modelId, onProgress) {
  const res = await fetch(OLLAMA_URL + '/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelId }),
  });
  if (!res.ok || !res.body) throw new Error('다운로드 요청 실패 (HTTP ' + res.status + ')');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (onProgress) onProgress(evt); // { status, total, completed, digest }
    }
  }
  await detectOllama(true); // 설치 목록 재검사 (TICKET-2)
}
```

### 경로 B: 스트리밍 미확인/불가

```js
export async function pullOllamaModel(modelId, onProgress) {
  if (onProgress) onProgress({ status: 'downloading (진행률 정보 없음)' });
  const res = await fetch(OLLAMA_URL + '/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelId, stream: false }),
  });
  if (!res.ok) throw new Error('다운로드 요청 실패 (HTTP ' + res.status + ')');
  await detectOllama(true);
}
```

**둘 중 채택된 경로와 근거는 구현 완료 보고 시 명시한다.**

## 용량 확인 문구 노출 지점

`requirements.md` §3.4(확정): `/api/pull` 트리거 **직전** 확인 문구 노출. 이 티켓에서는 `pullOllamaModel()` 함수 자체가 아니라 **호출부(TICKET-5, `js/ai-ui.js`)가 이 함수를 부르기 전에 확인 UI를 먼저 띄우는 구조**로 분리한다 — `js/ai.js`는 순수 다운로드 함수만 제공하고, "언제 사용자 동의를 구할지"는 UI 레이어(TICKET-5)의 책임으로 둔다(관심사 분리).

용량 수치(`OLLAMA_MODELS['qwen3:4b-thinking'].approxSizeGB`, TICKET-1에서 `null`로 남겨둔 값)는 이 티켓의 실측 단계에서 확정해 TICKET-1의 레지스트리에 채워 넣는다(Ollama 라이브러리 페이지 실제 모델 크기 또는 `/api/pull` 응답의 초기 `total` 값 기준).

## 토큰 한도 실측 확정

TICKET-1에서 `null`로 남겨둔 `OLLAMA_MODELS['qwen3:4b-thinking'].numPredict`를 이 티켓의 테스트 단계에서 실제 값으로 채운다. 검증 방법: `qwen3:4b-thinking`을 실제로 pull → `analyzeWithOllama()`로 실제 소견 텍스트 분석 → 응답이 `</think>` 태그로 정상 종결되고 최종 답변까지 잘리지 않는지 확인 → 잘리면 값을 올려 재시도(요구사항 §3.5 예시 범위 4000~6000 참고, 상한 없이 실측 우선).

## 실패 처리

`pullOllamaModel()` 호출이 실패(네트워크 끊김, 디스크 부족 등 Ollama 서버 측 오류 응답)하면 TICKET-2가 만든 것과 동일한 형태(`{stage, message, raw, timestamp}`)로 에러를 던지거나 별도 상태에 보존해, TICKET-5·6이 동일한 실패 안내 UI 패턴을 재사용할 수 있게 한다(00-overview §5 위험 #6).

## 다른 티켓과의 연결

- TICKET-1에서 받는 것: `OLLAMA_MODELS` 레지스트리(다운로드 대상 모델 id), `getSelectedModelId()`.
- TICKET-2에서 받는 것: `detectOllama(true)`(다운로드 후 재검사), `isModelInstalled()`(다운로드 전 이미 설치돼 있는지 최종 확인 — 중복 다운로드 방지).
- TICKET-5에 주는 것: `pullOllamaModel(modelId, onProgress)` export, 그리고 확정된 `approxSizeGB`/`numPredict` 값이 채워진 `OLLAMA_MODELS` 레지스트리.
- 공유 파일 주의: 이 티켓은 TICKET-1·2가 이미 재작성한 `js/ai.js`에 함수를 추가하는 형태이므로, `detectOllama`/`OLLAMA_MODELS` 관련 코드 위치를 먼저 확인한 뒤 추가한다(파일 재조회 필수 — 티켓 문서만 보고 라인 번호를 추측하지 않는다).

## 완료 기준

- [ ] `/api/pull` 스트리밍 여부 실측 완료, 채택 경로(A/B)와 근거 기록
- [ ] `pullOllamaModel(modelId, onProgress)` export 추가, 성공 시 `detectOllama(true)` 자동 재검사
- [ ] `OLLAMA_MODELS['qwen3:4b-thinking'].approxSizeGB`, `.numPredict` 실측값으로 확정(TICKET-1 레지스트리 갱신)
- [ ] 다운로드 실패 시 TICKET-2와 동일한 에러 형태로 노출
- [ ] `js/ai-ui.js:1`의 `./ai.js?v=` 버전 갱신

## 테스트 항목

- 실제 Ollama 환경에서 `qwen3:4b-thinking` 미설치 상태 → `pullOllamaModel()` 호출 → 다운로드 완료 → `isModelInstalled('qwen3:4b-thinking')`가 `true`로 바뀌는지
- (경로 A 채택 시) `onProgress` 콜백이 실제로 여러 번 호출되며 `completed`/`total` 값이 증가하는지
- 다운로드 도중 네트워크 차단(의도적 중단) 시 에러가 적절히 던져지는지, 앱이 멈추지 않는지
- `qwen3:4b-thinking` 다운로드 완료 후 실제 분석 요청 시 확정된 `numPredict` 값으로 응답이 잘리지 않고 끝까지 나오는지(요구사항 §6 최우선 테스트 항목)
