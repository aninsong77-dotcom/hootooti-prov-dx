# TICKET-1 — `analyzeWithAI()` 대화 배열 재설계 + 종료판정 프롬프트

파일: `js/ai.js`
선행 티켓: 없음(Sprint 1, 최초 착수)
스프린트: Sprint 1

## AS-IS (재확인 결과)

```js
// js/ai.js:115-178
const FOLLOWUP_MARKER = '### 추가확인질문';
const FOLLOWUP_NONE_TEXT = '(추가 질문 없음)';

function buildSystemPrompt(dictionaryText, isFollowUp) {
  const lines = [ /* 공통 서두 + 사전 + 1)~2) 지시 */ ];

  if (!isFollowUp) {
    lines.push(
      '3) 각 가설마다 ... 확인할 수 없는 항목이 있는지 짚어내세요.',
      '4) 확인이 필요한 항목이 있다면 ... ' + FOLLOWUP_MARKER + ' 섹션에 모으세요.',
      '5) 위 사고 과정을 반영해 현재까지의 최종 후보를 정리하세요(잠정적 결론).',
    );
  } else {
    lines.push(
      '상담자가 이전 질문에 아래 [추가 확인 답변]으로 응답했습니다 ...',
      '이번에는 ' + FOLLOWUP_MARKER + ' 섹션을 쓰지 말고, 갱신된 최종 결론만 제시하세요.',
    );
  }
  // 공통 마무리(근거 설명, 위기징후 우선, 참고용 문구) ...
  return lines.join('\n');
}
```

```js
// js/ai.js:542-588
export async function analyzeWithAI(noteText, onProgress, followUpAnswerText) {
  const isFollowUp = !!(followUpAnswerText && followUpAnswerText.trim());
  const relevant = pickRelevantDiagnoses(noteText, MAX_DICT_DIAGNOSES);
  const dictionaryText = formatDiagnosisDictionary(relevant);
  const systemPrompt = buildSystemPrompt(dictionaryText, isFollowUp);
  const userMessage = isFollowUp
    ? noteText + '\n\n[추가 확인 답변]\n' + followUpAnswerText.trim()
    : noteText;

  if (await detectOllama()) {
    try {
      return cleanModelOutput(await analyzeWithOllama(systemPrompt, userMessage));
    } catch (e) { await detectOllama(true); }
  }

  await ensureModelLoaded(onProgress);
  const result = await wllama.createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1800,
    temperature: 0.3,
  });
  return cleanModelOutput(result.choices[0].message.content);
}
```

```js
// js/ai.js:334-355
async function analyzeWithOllama(systemPrompt, noteText) {
  const modelConf = OLLAMA_MODELS[selectedOllamaModelId];
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelConf.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: noteText },
      ],
      stream: false,
      options: { temperature: 0.3, num_predict: modelConf.numPredict },
    }),
  });
  if (!res.ok) throw new Error('Ollama 응답 오류 (HTTP ' + res.status + ')');
  const data = await res.json();
  return data.message.content;
}
```

`pickRelevantDiagnoses(noteText, limit)`(`:53-78`)는 소견 텍스트 문자열 하나만 받아 키워드 매칭한다 — 현재는 항상 최초 소견 하나만 넘어온다.

핵심 문제: 두 함수 모두 "메시지 2개(system+user) 고정" 구조라, 대화가 3턴·5턴으로 늘어나도 이전 턴들이 요청에 전혀 실리지 않는다(`requirements.md` §2.7 재설계 대상으로 명시).

## TO-BE

### 1. 시그니처 변경 — `analyzeWithAI(conversation, onProgress, forceConclusion)`

```js
// conversation: [{ role: 'user'|'assistant', text: string }, ...] — 시간순, 최소 1개(최초 소견)
// forceConclusion: true면 "충분함" 버튼에 의한 강제 종결 모드(§4.4 확정 사항)
export async function analyzeWithAI(conversation, onProgress, forceConclusion) {
  const combinedUserText = conversation
    .filter(function (t) { return t.role === 'user'; })
    .map(function (t) { return t.text; })
    .join('\n');
  const relevant = pickRelevantDiagnoses(combinedUserText, MAX_DICT_DIAGNOSES);
  const dictionaryText = formatDiagnosisDictionary(relevant);
  const systemPrompt = buildSystemPrompt(dictionaryText, !!forceConclusion);

  const messages = [{ role: 'system', content: systemPrompt }]
    .concat(conversation.map(function (t) { return { role: t.role, content: t.text }; }));

  if (await detectOllama()) {
    try {
      return cleanModelOutput(await analyzeWithOllama(messages));
    } catch (e) {
      await detectOllama(true);
    }
  }

  await ensureModelLoaded(onProgress);
  const result = await wllama.createChatCompletion({
    messages: messages,
    max_tokens: 1800,
    temperature: 0.3,
  });
  return cleanModelOutput(result.choices[0].message.content);
}
```

**§4.1 결정 반영(그라운딩 재계산 범위)**: 최초 소견 하나가 아니라 `conversation`의 모든 `user` 발화를 합쳐 `pickRelevantDiagnoses()`에 넘긴다(옵션 B 채택 — "히스토리 전체 활용"이라는 요구사항 취지에 부합, `DIAGNOSES` 배열 크기상 성능 문제 없음). 이 결정은 00-overview.md §4.1에서 TICKET-1에 위임된 사항이며 임의 추정이 아니라 여기서 확정한다.

### 2. `analyzeWithOllama(messages)` — 시그니처 단순화(2-인자 → 1-인자)

```js
async function analyzeWithOllama(messages) {
  const modelConf = OLLAMA_MODELS[selectedOllamaModelId];
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelConf.id,
      messages: messages,
      stream: false,
      options: { temperature: 0.3, num_predict: modelConf.numPredict },
    }),
  });
  if (!res.ok) throw new Error('Ollama 응답 오류 (HTTP ' + res.status + ')');
  const data = await res.json();
  return data.message.content;
}
```

기존 `systemPrompt`/`noteText` 2-인자 구조를 없애고 이미 조립된 `messages` 배열을 그대로 전달만 하도록 단순화한다. 호출부(`analyzeWithAI` 내부, 위 §1)도 함께 수정.

### 3. `buildSystemPrompt(dictionaryText, forceConclusion)` — `isFollowUp` → `forceConclusion` 개념 전환

기존 "1차/2차 두 단계"라는 전제를 버리고, **"진행 중(질문 가능)" / "강제 종결(충분함 버튼)" 두 모드**로 재정의한다. 이전 턴들의 내용은 더 이상 프롬프트 문자열에 직접 이어붙이지 않는다 — `messages` 배열 자체가 전체 히스토리를 담고 있으므로 모델이 대화 맥락을 이미 볼 수 있다(§1 참고, "[추가 확인 답변]" 접두어 방식 폐기).

```js
function buildSystemPrompt(dictionaryText, forceConclusion) {
  const lines = [ /* 공통 서두(:128-136) + 사전 + 공통 1)~2) 지시(:140-141), 변경 없음 */ ];

  if (!forceConclusion) {
    lines.push(
      '3) 각 가설마다, 사전 기준 항목 중 "지금까지의 대화만으로는 확인할 수 없는 항목"',
      '   (증상 지속기간, 배제기준, 심각도·기능손상 정도 등)이 있는지 짚어내세요.',
      '4) 확인이 필요한 항목이 있다면, 상담자에게 되물을 구체적 질문을 만들어',
      '   반드시 아래 형식 그대로 맨 마지막 별도 섹션에 모으세요:',
      '',
      FOLLOWUP_MARKER,
      '1. (질문)',
      '2. (질문)',
      '확인할 필요가 없다고 판단되면 그 섹션에 "' + FOLLOWUP_NONE_TEXT + '"라고만 쓰세요.',
      '5) 위 사고 과정을 반영해 현재까지의 최종 후보를 정리하세요(확인할 항목이 남아',
      '   있다면 잠정적 결론임을 밝히고, 남은 게 없다면 그 자체가 결론입니다).',
    );
  } else {
    lines.push(
      '상담자가 "이제 충분히 확인됐다"고 판단해 대화를 종료했습니다. 지금까지의',
      '전체 대화 내용을 반영해 가설별 그럴듯함을 최종 확정하세요.',
      '이번에는 ' + FOLLOWUP_MARKER + ' 섹션을 쓰지 말고, 갱신된 최종 결론만 제시하세요.',
    );
  }

  lines.push(/* 공통 마무리(:166-175), 변경 없음 */);
  return lines.join('\n');
}
```

### 4. 종료 감지 메커니즘 — **미확정, 구현 시 택1 (00-overview.md §4.3 재제시)**

이 계획 문서는 아래 세 옵션 중 하나를 결론내지 않는다(`requirements.md` §4 그대로 존중). **구현자는 착수 전 아래 중 하나를 선택하고, 이 티켓 문서의 "완료 기준"에 어떤 옵션을 택했는지 반드시 기록한다.**

| 옵션 | 방식 | 장점 | 단점 |
|---|---|---|---|
| 1. 프롬프트 내재화 | `forceConclusion=false` 모드의 응답에서 `splitFollowUpSection()`이 `followUpQuestionsText === null`(질문 없음)이면 이번 턴에서 자연 종료된 것으로 간주 | 추가 API 호출 없음, 기존 함수(`splitFollowUpSection`) 그대로 재사용 | "질문이 정말 없어서"와 "AI가 종료를 유도해서"를 구분 못 함(다만 UI 동작은 어느 쪽이든 동일하므로 실질적 하자는 아닐 수 있음) |
| 2. 별도 분류 프롬프트 | 사용자의 매 턴 발화를 별도로 "종료 의도인가?"만 짧게 재질의하는 추가 호출 | 판별이 명시적, 오탐 원인 추적 쉬움 | 매 턴 호출 2배, 지연 시간 증가 |
| 3. 하이브리드(내부 접두어) | 프롬프트에 "사용자가 종료를 원하면 응답 앞에 내부 표시를 붙이라" 지시 | 옵션 1보다 명시적 | 마커 방식에 가까워져 §2.2 "마커 미채택" 확정과 긴장 관계 — 채택 시 사용자에게 명시적으로 알리고 재확인 필요 |

`splitFollowUpSection()`(`js/ai.js:532-540`)은 세 옵션 모두에서 "후속질문 섹션 유무 판정" 용도로는 그대로 쓸 수 있으므로 **수정하지 않는다**(단, 옵션 3을 택할 경우에만 접두어 파싱 로직을 별도로 추가해야 하며, 이 경우 이 함수를 손대지 않고 별도 함수를 새로 만드는 것을 권장 — 기존 함수의 책임 범위를 흐리지 않기 위함).

**세 번째 오판 원인(계획 리뷰 제안 반영, 옵션과 무관하게 항상 존재)**: 옵션 1~3 중 무엇을 택하든, 응답이 `numPredict`/`max_tokens` 한도에 걸려 `FOLLOWUP_MARKER` 섹션 자체가 통째로 잘려나간 채 응답이 끝나는 경우가 있을 수 있다(`js/ai.js:349` `numPredict: modelConf.numPredict`, `:583` `max_tokens: 1800`). 이 경우 `splitFollowUpSection()`은 마커를 못 찾아 `followUpQuestionsText: null`을 반환하는데, 이는 "질문이 정말 없어서"가 아니라 "잘려서 마커까지 도달하지 못해서"이므로 옵션 1(및 옵션 1을 재사용하는 §3의 `!hasFollowUp` 판정)이 이를 오판할 위험이 있다. TICKET-3 구현 시 최소한 `cleanModelOutput()`(`js/ai.js:320-332`)이 이미 처리하는 "`<think>` 미종결" 케이스와 유사하게, 응답 길이가 토큰 한도에 근접했는지(또는 응답이 문장 중간에서 끊긴 것으로 보이는지) 정도의 방어적 신호를 함께 고려하는 것을 권장한다(구체 구현은 미확정, TICKET-3 재량).

### 5. 코드 헤더 주석 갱신 (00-overview.md §9)

`js/ai.js:1-19`의 헤더 주석에 "대화 배열 전체를 받는 구조로 전환됨" 한 줄을 추가해, 향후 재조사 시 "왜 messages가 2개 고정이 아닌지" 혼선이 없게 한다.

## 다른 티켓과의 연결

- 선행 티켓 없음(Sprint 1 최초).
- TICKET-3에 주는 것: 신규 `analyzeWithAI(conversation, onProgress, forceConclusion)` 시그니처, `splitFollowUpSection()`(변경 없음, 계속 후속질문 유무 판정용으로 재사용), 종료 감지 옵션 중 실제 채택된 것(TICKET-3이 그 결과를 소비해 UI 분기).
- 공유 파일 주의: `js/ai.js`는 이 티켓에서만 수정되고 이후 티켓은 이 파일을 건드리지 않는다(공유 없음, 위험 낮음). 단, TICKET-1이 확정한 함수 시그니처가 바뀌면 TICKET-3 전체가 그 위에서 설계되므로 **시그니처를 티켓 완료 후 임의로 다시 바꾸지 않는다**.

## 완료 기준

- [ ] `analyzeWithAI(conversation, onProgress, forceConclusion)` 시그니처로 교체, 기존 2-인자 호출부(`js/ai-ui.js`)가 아직 옛 시그니처로 호출 중이라도(TICKET-3 착수 전) 이 파일 자체의 문법 오류·런타임 예외 없이 콘솔에서 단독 테스트 가능
- [ ] `analyzeWithOllama(messages)` 1-인자로 단순화
- [ ] `buildSystemPrompt(dictionaryText, forceConclusion)`으로 개념 전환, "진행 중/강제 종결" 두 모드 프롬프트 작성
- [ ] `pickRelevantDiagnoses()` 호출을 대화 내 전체 `user` 발화 합산 텍스트로 변경(§4.1 결정 반영)
- [ ] **종료 감지 메커니즘 옵션 1~3 중 하나를 선택하고 이 문서에 어떤 것을 택했는지 기록**(선택 안 하고 다음 티켓으로 넘어가지 않음)
- [ ] `js/ai.js:1-19` 헤더 주석 갱신
- [ ] `index.html`의 `js/ai-ui.js?v=` 갱신은 이 티켓 범위 아님(TICKET-3에서, `js/ai.js` 자체는 버전 쿼리 문자열을 갖지 않으므로 이 티켓에서 버전 쿼리 갱신 대상 없음 — import하는 쪽인 `js/ai-ui.js:5`의 `./ai.js?v=15`를 올리는 것은 TICKET-3 책임)

## 테스트 항목

- 콘솔에서 3~4턴짜리 인위적 `conversation` 배열을 만들어 `analyzeWithAI()`를 직접 호출 — Ollama 연결 시 네트워크 탭에서 `/api/chat` 요청 바디의 `messages` 배열 길이가 실제로 히스토리 턴 수+1(system)과 일치하는지 확인.
- 같은 배열을 Ollama 미연결 상태(wllama 폴백)에서도 호출해 동일하게 전체 히스토리가 실리는지 확인.
- `forceConclusion=true`로 호출 시 응답에 `FOLLOWUP_MARKER` 섹션이 없는지(=강제 종결 모드가 실제로 질문을 만들지 않는지).
- `forceConclusion=false`로 호출 시, 선택한 종료 감지 옵션에 따라 "질문이 더 없다"는 응답이 실제로 자연스럽게 나오는 시나리오(가상의 풍부한 소견 입력)와, 아직 질문이 남는 시나리오(빈약한 소견) 둘 다 확인.
- 기존 동작 회귀 확인: 단일 턴(최초 소견만 있는 `conversation` 길이 1)으로 호출했을 때 기존 "1차 분석"과 실질적으로 동일한 품질의 응답이 나오는지(회귀 없음이 최우선).
