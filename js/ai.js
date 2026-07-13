/* ==========================================================================
   후투티 — 브라우저 내 로컬 AI(Kanana GGUF, wllama) 연동
   모델은 사용자의 브라우저 안에서만 실행되며(WebAssembly), 소견 텍스트는
   외부 서버로 전송되지 않습니다. 최초 1회 모델 파일(약 1.4GB)을 내려받으며,
   이후에는 브라우저 캐시에 저장되어 다시 열 때 빠르게 로드됩니다.

   모델: Kanana 1.5 2.1B (사용자가 원본에서 직접 변환·업로드한 GGUF)
   Qwen3-4B도 시도했으나 이 환경(AMD WebGPU)에서 GPU 큐 타임아웃으로
   크래시가 재현되어, 계산량이 절반인 Kanana(과거 GPU 성공 사례 있음)로 복귀.

   AI는 js/data.js의 DSM-5-TR 기반 진단 기준("사전")과 무관하게 자기 지식만으로
   답하면 근거가 부실해지므로, 소견과 겹치는 진단 후보를 먼저 키워드로 추려
   그 기준 항목을 프롬프트에 함께 제공(그라운딩)한다.

   Ollama(설치형 로컬 엔진) 쪽은 더 이상 모델 1개로 고정되지 않는다.
   OLLAMA_MODELS 레지스트리에 "생각과정 없음/있음" 두 모델을 기술해두고,
   setSelectedModelId()로 선택 상태를 바꿀 수 있다(engine-selector 트랙
   TICKET-1). 선택 UI 자체는 이후 티켓(TICKET-5)에서 붙는다.

   analyzeWithAI()는 "소견 1개 + 후속답변 1개" 2-메시지 고정 구조에서
   대화 배열(conversation) 전체를 받는 구조로 전환됐다(symptom-chat-interview
   트랙 TICKET-1). 요약 압축 없이 전체 히스토리를 매번 그대로 모델에 전달한다.
   ========================================================================== */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/index.js';

const WASM_PATH_CONFIG = {
  default: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/wasm/wllama.wasm',
};

const MODEL_URL = 'https://huggingface.co/aninsong/kanana-1.5-2.1b-instruct-gguf/resolve/main/kanana-1.5-2.1b-instruct-Q4_K_M.gguf';

// GPU(WebGPU) 사용 시 8192에서 드라이버 행(DXGI_ERROR_DEVICE_HUNG)이 확인되어,
// 성공 사례가 있었던 작은 컨텍스트에 가깝게 4096으로 운용한다.
const N_CTX = 4096;
// 상위 N개는 기준 전체를, 나머지는 이름만 제공해 프롬프트를 가볍게 유지한다.
const MAX_DICT_DIAGNOSES = 12;
const FULL_DETAIL_DIAGNOSES = 6;

const STOPWORDS = {};
[
  '그리고', '그래서', '그러나', '하지만', '그런데', '또한', '매우', '너무', '정말', '자주', '계속',
  '최근', '이전', '이후', '등을', '등이', '등은', '등', '것을', '것이', '것은', '것', '같은', '같이',
  '대한', '대해', '으로', '에서', '에게', '부터', '까지', '에는', '에도', '에서도', '에서의', '합니다',
  '했다', '한다', '있다', '없다', '됩니다', '되었다', '하며', '하고', '하는', '하지', '않고', '않았다',
  '많이', '많은', '조금', '약간', '거의', '전혀', '스스로', '자신', '때문에', '위해', '통해', '관련',
].forEach((w) => { STOPWORDS[w] = true; });

function tokenize(text) {
  const cleaned = String(text).replace(/[.,!?;:()[\]"'"'·/\\-]/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS[t]);
}

function pickRelevantDiagnoses(noteText, limit) {
  const diagnoses = typeof DIAGNOSES !== 'undefined' ? DIAGNOSES : [];
  const noteTokens = tokenize(noteText);
  if (noteTokens.length === 0 || diagnoses.length === 0) return [];

  const scored = diagnoses.map((d) => {
    const itemTokens = [];
    d.groups.forEach((g) => {
      g.items.forEach((it) => itemTokens.push(...tokenize(it)));
    });
    let score = 0;
    itemTokens.forEach((it) => {
      noteTokens.forEach((nt) => {
        if (it.indexOf(nt) !== -1 || nt.indexOf(it) !== -1) score++;
      });
    });
    return { d, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.d);

  // 겹치는 키워드가 하나도 없으면(짧은 소견 등) 그래도 최소한의 참고군을 준다.
  if (matched.length === 0) return diagnoses.slice(0, Math.min(limit, diagnoses.length));
  return matched;
}

function formatDiagnosisDictionary(diagnoses) {
  const detailed = diagnoses.slice(0, FULL_DETAIL_DIAGNOSES);
  const nameOnly = diagnoses.slice(FULL_DETAIL_DIAGNOSES);

  const detailedText = detailed
    .map((d) => {
      const groupsText = d.groups
        .map((g) => {
          const label = g.label ? g.label : '증상 항목';
          const items = g.items.map((it) => '    - ' + it).join('\n');
          return '  [' + label + ', 최소 ' + g.min + '개 이상]\n' + items;
        })
        .join(d.groupLogic === 'OR' ? '\n  --- 또는 ---\n' : '\n');
      const other = d.other ? '\n  추가 확인사항: ' + d.other : '';
      return (
        '- ' + d.name_kr + ' (' + d.name_en + ') [' + d.category + ']\n' +
        groupsText +
        '\n  기간 기준: ' + d.duration + other
      );
    })
    .join('\n\n');

  if (nameOnly.length === 0) return detailedText;

  const nameOnlyText = nameOnly
    .map((d) => '- ' + d.name_kr + ' (' + d.name_en + ') [' + d.category + ']')
    .join('\n');

  return (
    detailedText +
    '\n\n[아래는 기준 상세를 생략한 참고 후보 — 소견과 더 부합한다고 판단되면 이름을 언급만 하고, 상세 기준은 정밀 체크리스트에서 확인하도록 안내하세요]\n' +
    nameOnlyText
  );
}

// 후속질문 섹션을 UI가 파싱할 수 있도록 마커 문자열을 고정해둔다.
const FOLLOWUP_MARKER = '### 추가확인질문';
const FOLLOWUP_NONE_TEXT = '(추가 질문 없음)';
// 결과 패널(대화창 옆, "유력한 진단")이 매 턴 응답에서 최종 후보 부분만
// 깔끔하게 뽑아 보여줄 수 있도록 별도 마커로 감싼다. 항상 FOLLOWUP_MARKER
// 보다 앞에 오도록 프롬프트 순서를 고정해, extractFinalCandidates()가
// "이 마커부터 FOLLOWUP_MARKER(있다면) 전까지"로 일관되게 잘라낼 수 있다.
const FINAL_CANDIDATES_MARKER = '### 최종 후보';

// 아래 4개는 스트리밍 단계별 표시(대화 참고 — "핵심요약 → 유력가설 →
// 확인필요항목 순으로 하나씩 채팅창에 보여달라") 기능을 위해 새로 추가한
// 마커다. 예전엔 1)~3) 단계가 마커 없는 평문이라 "지금 어디까지 썼는지"를
// 스트림 도중에 구분할 방법이 없었다 — 이제 각 단계 출력 앞에 고정 마커를
// 붙여, ai-ui.js가 스트림을 받는 도중 마커 등장 시점마다 그 구간을 완성된
// 말풍선으로 잘라 보여줄 수 있게 한다.
const NOTE_SUMMARY_MARKER = '### 정리된 소견';
const SUMMARY_MARKER = '### 핵심 요약';
const HYPOTHESES_MARKER = '### 유력 가설';
const UNCERTAIN_MARKER = '### 확인 필요 항목';

// ai-ui.js가 마커 문자열을 하드코딩하지 않고 이 함수로만 참조하게 해서,
// 마커 값이 여기(단일 출처)와 어긋날 위험을 없앤다. noteSummary는 결과
// 패널 전용(채팅에는 안 보여줌)이라 별도 표시해둔다.
export function getSectionMarkers() {
  return {
    noteSummary: NOTE_SUMMARY_MARKER,
    summary: SUMMARY_MARKER,
    hypotheses: HYPOTHESES_MARKER,
    uncertain: UNCERTAIN_MARKER,
    finalCandidates: FINAL_CANDIDATES_MARKER,
    followUp: FOLLOWUP_MARKER,
    followUpNoneText: FOLLOWUP_NONE_TEXT,
  };
}

// 결과 패널의 "[내담자 소견]"이 상담자가 입력한 원문을 그대로 이어붙이는
// 대신, AI가 정리한 버전을 쓸 수 있도록 최근 assistant 턴에서 이 섹션만
// 뽑아준다(NOTE_SUMMARY_MARKER부터 SUMMARY_MARKER 직전까지). extractFinalCandidates()와
// 동일한 패턴 — 마커가 없으면(모델이 형식을 안 지킨 경우) null을 반환해
// 호출부(ai-ui.js)가 원문 그대로 쓰는 기존 방식으로 자연스럽게 폴백하게 한다.
export function extractNoteSummary(answerText) {
  const startIdx = answerText.indexOf(NOTE_SUMMARY_MARKER);
  if (startIdx === -1) return null;
  const contentStart = startIdx + NOTE_SUMMARY_MARKER.length;
  const nextIdx = answerText.indexOf(SUMMARY_MARKER, contentStart);
  const contentEnd = nextIdx === -1 ? answerText.length : nextIdx;
  const text = answerText.slice(contentStart, contentEnd).trim();
  return text || null;
}

// 실제 임상가의 가설연역적 추론(hypothetico-deductive reasoning) 단계를 그대로
// 프롬프트 구조로 반영: 단서 정리 → 소수의 유력 가설 생성 → 확인 불가능한 항목
// 식별(지속기간·배제기준 등, 정적 체크리스트로는 못 채우는 부분) → 후속 질문 →
// (후속 답변이 있다면) 가설 재평가 → 근거를 명시한 최종 후보 제시.
// 참고: Elstein & Schwarz(2002) 가설연역 모델, Google AMIE(대화형으로 되물어
// 병력을 채우는 방식), AegisDx(안전지향 가설연역 프레임워크 — 넓은 감별 후
// 소수로 압축 + 위험징후 우선 스크리닝).
function buildSystemPrompt(dictionaryText, forceConclusion) {
  const lines = [
    '당신은 정신건강 임상 스크리닝을 보조하는 한국어 도구입니다.',
    '아래 "진단 기준 사전"은 DSM-5-TR의 개념을 참고하여 재서술한 체크리스트 데이터이며,',
    '당신이 근거로 삼을 수 있는 것은 이 사전에 적힌 항목뿐입니다. 사전에 없는 진단명이나',
    '기준을 만들어내지 마세요.',
    '',
    '=== 진단 기준 사전 (내담자 소견과 키워드가 겹치는 상위 후보) ===',
    dictionaryText,
    '=== 사전 끝 ===',
    '',
    '이 대화는 상담자와 당신이 여러 차례 주고받는 채팅입니다. 이전 turn들의 소견·질문·답변이',
    '모두 대화 기록으로 이미 주어져 있으니, 그 전체 맥락을 반영해 분석하세요.',
    '',
    '상담자가 자신의 진단 의견이나 가설(예: "이건 OO장애 같다", "OO는 아닌 것 같다")을 직접',
    '제시하면, 그 의견을 그냥 지나치지 말고 사전 기준에 비춰 명시적으로 판단하세요 — 동의한다면',
    '그 근거를, 이견이 있다면 정확히 어느 지점에서 사전 기준과 안 맞는지, 그리고 그 의견을',
    '뒷받침하거나 반박하려면 어떤 추가 정보가 필요한지 밝히세요. 상담자가 추가 자료나 근거를',
    '이어서 제시하면, 그것도 지금까지의 소견과 함께 판단에 반영해 가설을 다시 조정하세요.',
    '',
    '실제 임상가처럼 다음 사고 과정을 거쳐 분석하세요. 사전 항목을 단순히 소견과',
    '겹치는 대로 전부 나열하지 말고, 아래 단계를 거쳐 소수로 압축하세요. 각 단계는',
    '반드시 지정된 마커로 시작하는 별도 섹션으로 나눠 쓰세요(마커 문자열을 그대로',
    '포함해야 합니다 — 화면에 각 단계가 하나씩 순서대로 나타나는 데 이 마커가 쓰입니다).',
    '',
    '0) 지금까지 상담자가 입력한 내용(소견·의견 포함)을 빼거나 지어내지 않고 정리된',
    '   형태로 정리하세요. 상담자가 이미 정리된 형태로 입력했다면 그 내용을 거의',
    '   그대로 옮기면 되고, 대화체로 두서없이 적었다면 시간순·항목별로 다듬어',
    '   읽기 쉽게 정리하세요. 상담자의 진단 의견이나 가설이 있었다면 함께 포함하세요.',
    '',
    NOTE_SUMMARY_MARKER,
    '(정리된 소견)',
    '',
    '1) 지금까지의 대화에서 확인된 핵심 증상을 짧게 정리하세요.',
    '',
    SUMMARY_MARKER,
    '(핵심 요약)',
    '',
    '2) 사전 후보 중 가장 유력한 가설을 최대 5개까지만 선정하세요 (전체 나열 금지).',
    '',
    HYPOTHESES_MARKER,
    '(유력 가설)',
  ];

  if (!forceConclusion) {
    lines.push(
      '',
      '3) 각 가설마다, 사전 기준 항목 중 "지금까지의 대화만으로는 확인할 수 없는 항목"',
      '   (증상 지속기간, 배제기준, 심각도·기능손상 정도 등)이 있는지 짚어내세요.',
      '',
      UNCERTAIN_MARKER,
      '(확인 필요 항목)',
    );
  }

  // 최종 후보 섹션 — 결과 패널이 이 섹션만 깔끔하게 뽑아 보여주므로, 항상
  // 이 섹션 하나에 "지금 시점 결론"에 필요한 내용을 전부 담는다(근거·배제
  // 사유·위기 징후 강조·필수 고지 문장까지). FOLLOWUP_MARKER보다 먼저 오게 해서
  // extractFinalCandidates()가 두 마커 사이만 잘라내면 되도록 순서를 고정한다.
  lines.push(
    '4) 위 사고 과정을 반영한 현재 시점의 최종 후보를 아래 형식 그대로 별도 섹션에',
    '   정리하세요(확인할 항목이 남아 있다면 잠정적 결론임을 밝히고, 남은 게',
    '   없다면 그 자체가 결론입니다):',
    '',
    FINAL_CANDIDATES_MARKER,
    '각 후보마다 사전의 어떤 기준 항목과 소견(및 추가 답변)의 어떤 표현이 근거가',
    '되었는지, 그리고 왜 다른 후보는 배제했는지 설명하세요.',
    '사전 항목들과 뚜렷이 겹치는 근거가 없다면 "뚜렷이 부합하는 후보 없음"이라고 답하세요.',
    '반드시 "가능성이 있는 후보"로만 표현하고 확정적으로 단정하지 마세요.',
    '소견에 위기 징후(자살사고, 자해, 급성 정신병적 증상 등)가 보이면 가장 먼저 강조하세요.',
    '마지막 줄에 반드시 다음 문장을 그대로 포함하세요:',
    '"이는 참고용 스크리닝 결과이며 실제 진단이 아닙니다. 자격을 갖춘 임상가의 평가가 반드시 필요합니다."',
  );

  if (!forceConclusion) {
    lines.push(
      '5) 확인이 필요한 항목이 있다면, 상담자에게 되물을 구체적 질문을 만들어',
      '   바로 위 최종 후보 섹션 다음에, 반드시 아래 형식 그대로 별도 섹션으로 이어 붙이세요:',
      '',
      FOLLOWUP_MARKER,
      '1. (질문)',
      '2. (질문)',
      '확인할 필요가 없다고 판단되면 그 섹션에 "' + FOLLOWUP_NONE_TEXT + '"라고만 쓰세요.',
      '   상담자가 (이전 turn에서) "그만 물어봐도 돼요", "이 정도면 충분해요" 같은 자연어로',
      '   대화 종료 의사를 표현했다면, 더 이상 묻지 말고 이 섹션에 "' + FOLLOWUP_NONE_TEXT + '"만 쓰세요.',
    );
  } else {
    lines.push(
      '',
      '상담자가 "이제 충분히 확인됐다"고 판단해 대화를 종료했습니다. 지금까지의',
      '전체 대화 내용을 반영해 위 최종 후보 섹션의 내용을 갱신·확정하세요.',
      '이번에는 ' + FOLLOWUP_MARKER + ' 섹션을 쓰지 마세요.',
    );
  }

  return lines.join('\n');
}

// ---------- Ollama (설치형 로컬 엔진) 연동 ----------
// PC에 Ollama가 설치·실행 중이면 브라우저 내 모델 대신 그쪽을 쓴다.
// 훨씬 빠르고(네이티브 실행) 더 큰 모델을 쓸 수 있다. 소견은 localhost로만
// 전송되므로 개인정보는 동일하게 PC 밖으로 나가지 않는다.
const OLLAMA_URL = 'http://localhost:11434';

// 모델 레지스트리 — Ollama로 돌릴 수 있는 모델과 그 파라미터를 한곳에 모아둔다.
// 기존에는 OLLAMA_MODEL 단일 상수(qwen3:4b-instruct 고정)였으나, 생각과정
// 있음/없음 두 모델 중 사용자가 고를 수 있어야 해서 레지스트리로 승격했다.
// qwen3:4b(생각모드 버전)는 최종 답을 내기 전 영어로 아주 길게 "생각"하다가
// 토큰 한도를 다 써버려 실사용이 어려웠으므로, 생각모드 버전은 numPredict를
// 넉넉히 잡는다(아래 TODO 참고 — 실측 전 잠정값).
const OLLAMA_MODELS = {
  'qwen3:4b-instruct': {
    id: 'qwen3:4b-instruct',
    label: '생각과정 없음 (현재 기본)',
    thinking: false,
    tooltip: '',
    // 1800에서 2400으로 상향(대화 참고 — 소견 요약·핵심요약·유력가설·확인필요
    // 항목까지 마커 섹션이 늘어 기존 1800으로는 최종 후보 직전에 잘리는 사례가
    // 실측됨). numPredict만 올려도 num_ctx가 작으면 프롬프트(사전+대화)가
    // 이미 문맥 창 대부분을 차지해 여전히 잘릴 수 있어, 아래 numCtx도 함께
    // 올린다(실측 원인 — 대화 참고).
    numPredict: 2400,
    // 기본(미지정 시 Ollama가 씀) 4096으로는 사전+대화 길이만으로 문맥 창
    // 대부분이 차 버려 응답이 중간에 끊기는 게 실측됐다. 8192로 올려 응답
    // 쓸 공간을 확보한다 — 대신 메모리 사용량이 늘고(대략 2배), 이 값으로
    // 처음 요청할 때 Ollama가 모델을 그 크기로 다시 띄우느라 한 번 더
    // 지연될 수 있다(대화 참고, 사용자에게 고지 완료).
    numCtx: 8192,
    // ollama.com/library/qwen3:4b-instruct 공식 페이지 확인(2.5GB).
    approxSizeGB: 2.5,
  },
  'qwen3:4b-thinking': {
    id: 'qwen3:4b-thinking',
    label: '생각과정 있음 (qwen3:4b-thinking)',
    thinking: true,
    tooltip: '',
    // TODO(실측 검증 필요, TICKET-3에서도 미해소): 이번 TICKET-3 구현
    // 세션에도 실제 Ollama 서버에 접근 가능한 환경이 없어 pullOllamaModel()로
    // 직접 qwen3:4b-thinking을 받아 검증하지 못했다. requirements.md §3.5가
    // 제시한 잠정 범위(4000~6000) 중간값을 그대로 유지한다 — 실제 pull·분석
    // 요청을 실행할 수 있는 환경에서 값을 확정해야 한다(00-overview.md §5
    // 위험#7).
    numPredict: 5000,
    // instruct 모델과 동일한 이유로 numCtx를 명시(위 주석 참고). 이 모델은
    // <think> 블록까지 써야 해서 문맥 압박이 더 클 수 있어 최소한 같은
    // 크기는 필요하다고 판단했다(실측 미검증 — 위 TODO와 동일 한계).
    numCtx: 8192,
    // ollama.com/library/qwen3:4b-thinking 공식 페이지 확인(2.5GB).
    approxSizeGB: 2.5,
  },
};
const DEFAULT_OLLAMA_MODEL_ID = 'qwen3:4b-instruct';

// 현재 선택된 모델. 기본값은 기존 동작과 동일한 qwen3:4b-instruct.
let selectedOllamaModelId = DEFAULT_OLLAMA_MODEL_ID;

export function getSelectedModelId() {
  return selectedOllamaModelId;
}

export function setSelectedModelId(modelId) {
  if (!OLLAMA_MODELS[modelId]) throw new Error('알 수 없는 모델: ' + modelId);
  selectedOllamaModelId = modelId;
}

// TICKET-5가 옵션 목록 렌더링에 사용.
export function listOllamaModels() {
  return Object.values(OLLAMA_MODELS);
}

// TICKET-2: 기존 단일 boolean 캐시(ollamaAvailable)를 "연결 가능 여부"와
// "설치된 모델 목록"으로 분리한다. 이유 — 두 모델(생각과정 없음/있음)을
// 다루게 되면서 "Ollama 자체가 켜져 있는가"와 "지금 선택한 모델이 설치돼
// 있는가"가 서로 다른 실패 사유이기 때문(연결 실패인데 "모델 없음"으로
// 잘못 안내하면 사용자가 이미 설치된 모델을 재설치하는 등 헛수고를 함).
let ollamaConnectionState = null; // null=미확인, 'connected'|'unreachable'
let installedModelNames = null;   // string[] | null(미확인)
let lastOllamaError = null;       // { stage, message, raw, timestamp } | null

// forceRefresh: 캐시를 무시하고 강제로 재검사할 때 true로 넘긴다(기본
// falsy). 인자를 안 넘기던 기존 호출부(js/ai-ui.js:61, 아래 analyzeWithAI()
// 내부)를 깨지 않기 위한 하위 호환 목적 — 인자 없이 호출하면 기존과 동일하게
// 캐시된 값을 즉시 반환한다.
export async function detectOllama(forceRefresh) {
  if (!forceRefresh && ollamaConnectionState !== null) {
    return ollamaConnectionState === 'connected' && isModelInstalled(selectedOllamaModelId);
  }

  let res;
  try {
    // 첫 방문 시 "PC의 사설망(localhost) 접근 허용" 권한 창이 뜨는데, 사용자가
    // 그 창을 확인하고 누르는 시간까지 감안해 넉넉하게 잡는다 (너무 짧으면
    // 권한 창이 떠 있는 동안 자체적으로 타임아웃돼 버려 항상 실패로 오판했었음).
    res = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    // fetch 자체가 실패 — 네트워크 연결 불가·타임아웃·CORS 등. "모델이
    // 없다"가 아니라 "연결 자체가 안 됐다"이므로 stage를 구분해 보존한다.
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'fetch', message: e && e.message, raw: String(e), timestamp: Date.now() };
    return false;
  }

  if (!res.ok) {
    // 연결은 됐지만 서버가 비정상 응답(HTTP 오류)을 준 경우.
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'bad-status', message: 'HTTP ' + res.status, raw: 'HTTP ' + res.status, timestamp: Date.now() };
    return false;
  }

  try {
    const data = await res.json();
    installedModelNames = (data.models || []).map((m) => m.name);
    ollamaConnectionState = 'connected';
    lastOllamaError = null;
    return isModelInstalled(selectedOllamaModelId);
  } catch (e) {
    // 연결·상태코드는 정상이었으나 응답 본문 JSON 파싱이 실패한 경우.
    ollamaConnectionState = 'unreachable';
    installedModelNames = [];
    lastOllamaError = { stage: 'parse', message: e && e.message, raw: String(e), timestamp: Date.now() };
    return false;
  }
}

// TICKET-6(실패 안내 배너)이 소비할 실패 분류 조회용 export.
export function getOllamaConnectionState() {
  return ollamaConnectionState; // null | 'connected' | 'unreachable'
}

export function getLastOllamaError() {
  return lastOllamaError; // { stage, message, raw, timestamp } | null — 디버그 토글이 그대로 노출
}

// TICKET-5(설치됨 표시)·detectOllama() 내부가 함께 쓰는 판별 함수.
export function isModelInstalled(modelId) {
  return !!(installedModelNames && installedModelNames.some((n) => n === modelId || n.startsWith(modelId)));
}

export function getInstalledModelNames() {
  return installedModelNames || [];
}

// 모델 내부 제어 토큰(<|eot_id|>, <|im_end|> 등)이나 <think> 블록이 응답에
// 섞여 나오는 경우가 있어 사용자에게 보여주기 전에 걸러낸다.
//
// 00-overview.md §5 위험#9: 토큰 한도(num_predict)에 걸려 응답이 <think>
// 도중 잘리면 </think>가 끝내 나오지 않아 아래 정규식이 매치되지 않고,
// 길게 이어지는 내부 생각 과정(주로 영어) 원문이 그대로 사용자에게
// 노출되어 버린다. <think>가 정규식 제거 후에도 남아있다면 곧 미종결
// 이라는 뜻이므로, 그 지점부터 뒤를 안내 문구로 치환해 원문 노출을 막는다.
function cleanModelOutput(text) {
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');

  const openIdx = out.indexOf('<think>');
  if (openIdx !== -1) {
    out = out.slice(0, openIdx).trim();
    out += (out ? '\n\n' : '') + '(생각 과정이 길어져 응답이 도중에 잘렸습니다. 다시 시도하거나 관리자에게 토큰 한도 상향을 요청하세요.)';
  }

  return out
    .replace(/<\|[a-zA-Z0-9_]+\|>/g, '')
    .trim();
}

// buildSystemPrompt()의 공통 마무리(:아래)가 모든 응답에 이 문장을 마지막 줄로
// 강제하므로, 이 문장이 안 보인다는 것은 응답이 그 지점까지 못 가고 잘렸다는
// 강한 신호로 쓸 수 있다(계획 리뷰 Suggestion 반영, TICKET-1 §4 세 번째 오판
// 원인 방어). num_predict/max_tokens 한도에 걸려 FOLLOWUP_MARKER 섹션 자체가
// 통째로 잘려나간 채 응답이 끝나면, splitFollowUpSection()은 "질문이 정말
// 없어서" 안 나온 것과 구분하지 못하고 followUpQuestionsText: null을 반환한다.
// 그 오판을 막기 위해, 마지막 문장이 없으면 잘렸을 가능성을 텍스트에 명시적으로
// 덧붙여 후속 판정(옵션 1, 아래 analyzeWithAI() 참고)이 "정말 질문이 없다"고
// 섣불리 확정하지 않도록 한다.
const FINAL_DISCLAIMER = '이는 참고용 스크리닝 결과이며 실제 진단이 아닙니다. 자격을 갖춘 임상가의 평가가 반드시 필요합니다.';
const TRUNCATION_NOTICE =
  '\n\n(주의: 응답이 토큰 한도에 걸려 도중에 끊겼을 수 있습니다. 위 내용에 후속 질문이 없어 보이더라도' +
  ' 실제로 확인할 게 없어서가 아니라 응답이 잘렸기 때문일 수 있습니다.)';

function finalizeModelOutput(rawText) {
  const cleaned = cleanModelOutput(rawText);
  if (cleaned.indexOf(FINAL_DISCLAIMER) === -1) {
    return cleaned + TRUNCATION_NOTICE;
  }
  return cleaned;
}

// messages: 이미 조립된 { role, content }[] 전체(대화 배열 재설계, TICKET-1).
// system 프롬프트 조립·대화 히스토리 concat은 모두 호출부(analyzeWithAI)의
// 책임이며, 이 함수는 그것을 그대로 Ollama에 전달만 한다.
//
// onDelta(선택): 넘기면 stream:true로 요청해 토큰이 오는 대로 그 조각
// 텍스트를 콜백으로 즉시 넘긴다(채팅창에 "핵심요약 → 유력가설 → ..."
// 순서로 하나씩 나타나게 하는 기능의 기반 — 대화 참고). 함수의 반환값은
// 스트리밍 여부와 무관하게 항상 완성된 전체 텍스트다 — 호출부(analyzeWithAI)가
// 마무리 처리(finalizeModelOutput 등)를 스트리밍 여부와 상관없이 동일하게
// 할 수 있도록.
// abortSignal(선택): "대화 초기화"를 누르는 순간에도 이미 보낸 요청이 백그라운드에서
// 계속 돌아 전송 버튼이 로딩 상태로 남아있던 버그(대화 참고)를 고치기 위해
// 추가 — fetch에 그대로 넘겨 사용자가 초기화를 누르면 요청 자체가 즉시 중단된다.
async function analyzeWithOllama(messages, onDelta, abortSignal) {
  const modelConf = OLLAMA_MODELS[selectedOllamaModelId];
  const useStream = typeof onDelta === 'function';
  const options = { temperature: 0.3, num_predict: modelConf.numPredict, num_ctx: modelConf.numCtx };

  if (!useStream) {
    const res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelConf.id, messages: messages, stream: false, options: options }),
      signal: abortSignal,
    });
    if (!res.ok) throw new Error('Ollama 응답 오류 (HTTP ' + res.status + ')');
    const data = await res.json();
    return data.message.content;
  }

  // Ollama /api/chat 스트리밍 응답 형식: 줄바꿈으로 구분된 JSON 객체들이
  // 순차로 오고, 각 객체가 { message: { content }, done }이다(공식 문서
  // 형식 — pullOllamaModel()의 /api/pull NDJSON 파싱과 같은 패턴 재사용).
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelConf.id, messages: messages, stream: true, options: options }),
    signal: abortSignal,
  });
  if (!res.ok) throw new Error('Ollama 응답 오류 (HTTP ' + res.status + ')');
  if (!res.body || !res.body.getReader) {
    // 스트리밍 body를 못 받는 환경 — 통짜 응답으로 폴백(진행 표시 없이).
    const data = await res.json();
    const full = data.message.content;
    onDelta(full);
    return full;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  const processLine = function (line) {
    if (!line.trim()) return;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch (parseErr) {
      return; // 파싱 실패한 줄은 건너뜀(pullOllamaModel()과 동일한 방어)
    }
    const delta = evt.message && evt.message.content;
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) processLine(line);
  }
  // 실측으로 확인된 버그(대화 참고): 마지막 청크가 개행으로 안 끝나면 그
  // 줄이 계속 buffer에만 남아 있다가 위 while(true) 루프가 done으로 끝나며
  // 통째로 유실됐다 — 응답의 마지막 한 줄(흔히 추가확인질문 내용)이 통째로
  // 사라지는 회귀였다. 루프 종료 후 남은 buffer도 반드시 한 번 더 처리한다.
  processLine(buffer);
  return fullText;
}

// TICKET-6이 소비할 수 있도록 다운로드 실패 사유도 detectOllama()와 동일한
// { stage, message, raw, timestamp } 형태로 보존한다(00-overview.md §5 위험#6).
let lastPullError = null;

export function getLastPullError() {
  return lastPullError; // { stage, message, raw, timestamp } | null
}

function makeOllamaPullError(stage, message, raw) {
  const err = new Error(message);
  err.stage = stage;
  err.raw = raw;
  err.timestamp = Date.now();
  lastPullError = { stage: err.stage, message: err.message, raw: err.raw, timestamp: err.timestamp };
  return err;
}

// ---------- Ollama /api/pull 자동 다운로드 ----------
// TICKET-3: 실제 Ollama가 설치된 환경에 접근할 수 없어 /api/pull이 정말
// NDJSON 스트리밍 진행률을 주는지 이 세션에서 직접 호출해 확인하지 "못했다".
// Ollama 공식 문서 지식에 따르면 stream 옵션을 생략(기본값 true)하면
// 요청 하나에 줄바꿈으로 구분된 JSON 객체들이 순차로 오고, 각 객체가
// { status, digest, total, completed } 형태의 진행 이벤트라고 알려져
// 있다 — 이 지식만 근거로 아래 "경로 A(스트리밍 파싱)"를 채택했다.
// **실측 필요**: 실제 Ollama 서버로 한 번도 검증되지 않았다.
// 만약 실제 응답 형식이 이 가정과 다르더라도(예: 필드명이 다르거나 줄
// 단위가 아니거나) 다운로드 자체가 죽지 않도록, 파싱 실패한 줄은 그냥
// 건너뛰고 "다운로드 중..."만 표시하는 방어적 처리를 넣었다(경로 B에
// 준하는 안전망을 경로 A 안에 내장한 형태 — 응답 형식이 완전히 달라도
// 최소한 "요청은 보냈고 완료를 기다리는 중"이라는 사실은 사용자에게
// 전달된다).
//
// modelId: OLLAMA_MODELS의 키(예: 'qwen3:4b-thinking').
// onProgress(evt): 파싱된 스트림 이벤트를 그대로 넘긴다. evt는
//   { status, digest, total, completed } 형태를 기대하지만 그 필드가
//   없을 수도 있으므로, 값 해석(퍼센트 계산 등)은 호출부(TICKET-5 UI)
//   책임으로 둔다. 진행률 정보를 아예 못 받는 경로에서는
//   { status: '...' }만 넘어온다.
export async function pullOllamaModel(modelId, onProgress) {
  let res;
  try {
    res = await fetch(OLLAMA_URL + '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelId }),
    });
  } catch (e) {
    throw makeOllamaPullError('fetch', (e && e.message) || '네트워크 요청 실패', String(e));
  }

  if (!res.ok) {
    throw makeOllamaPullError('bad-status', 'HTTP ' + res.status, 'HTTP ' + res.status);
  }

  if (!res.body || !res.body.getReader) {
    // 스트리밍 body를 못 받는 환경(구형 브라우저 등)이거나 서버가 단일
    // 응답만 준 경우 — 다운로드는 서버 쪽에서 계속 진행되므로 진행률 없이
    // 완료(이 fetch가 resolve됨)까지 기다린다.
    if (onProgress) onProgress({ status: '다운로드 중... (진행률 정보 없음)' });
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const processLine = function (line) {
      if (!line.trim()) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch (parseErr) {
        // 실측 안 된 가정(NDJSON)이 실제와 다를 가능성 대비 — 이 줄
        // 하나 때문에 전체 다운로드를 실패 처리하지 않는다.
        if (onProgress) onProgress({ status: '다운로드 중...' });
        return;
      }
      if (onProgress) onProgress(evt);
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) processLine(line);
      }
      // analyzeWithOllama()의 스트리밍 리더에서 실측으로 확인된 것과 같은
      // 버그(대화 참고) — 마지막 줄이 개행으로 안 끝나면 유실된다. 다운로드는
      // 보통 마지막 줄이 "완료(100%)" 이벤트라 이게 유실되면 진행률 표시가
      // 100% 못 채운 채 멈춘 것처럼 보일 수 있어 여기도 동일하게 고친다.
      processLine(buffer);
    } catch (e) {
      throw makeOllamaPullError('stream', (e && e.message) || '다운로드 스트림 오류', String(e));
    }
  }

  // 성공적으로 요청이 끝났다면 설치 목록을 강제 재검사해 최신 상태를
  // 반영한다(TICKET-2 detectOllama(forceRefresh)).
  await detectOllama(true);

  if (!isModelInstalled(modelId)) {
    // HTTP 응답은 정상이었지만(예: 모델명 오타 등) 설치 목록에서 끝내
    // 확인되지 않는 경우 — 조용히 성공 취급하지 않는다.
    throw makeOllamaPullError(
      'verify',
      '다운로드 요청은 완료됐지만 설치 목록에서 확인되지 않았습니다.',
      modelId
    );
  }

  lastPullError = null;
}

// ---------- 브라우저 내 모델 (wllama) ----------
let wllama = null;
let modelLoaded = false;
let loadingPromise = null;

function createWllama() {
  return new Wllama(WASM_PATH_CONFIG);
}

export async function ensureModelLoaded(onProgress) {
  if (modelLoaded) return;
  if (loadingPromise) return loadingPromise;

  if (!wllama) wllama = createWllama();

  loadingPromise = wllama
    .loadModelFromUrl(MODEL_URL, {
      // GPU(WebGPU) 사용. CPU 전용(n_gpu_layers:0) 싱글스레드는 응답 생성이
      // 수십 분 걸려 실사용 불가로 확인됨. GPU 행은 n_ctx 8192에서 발생했으므로
      // 4096으로 낮춰 운용한다 (성공 사례는 1024였음).
      n_ctx: N_CTX,
      // AMD WebGPU에서 "Queue wait timed out after 30000 ms" 크래시가 확인됨 —
      // 프롬프트 처리 배치가 커서 GPU 작업 1건이 30초 제한을 넘는 것이므로,
      // 배치를 잘게 쪼개 한 번에 넘기는 작업량을 줄인다 (총 작업량은 동일).
      n_batch: 512,
      n_ubatch: 128,
      progressCallback: ({ loaded, total }) => {
        if (onProgress) onProgress(loaded, total);
      },
    })
    .then(() => {
      modelLoaded = true;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

export function isModelReady() {
  return modelLoaded;
}

// 사용자가 "카나나로 전환" 버튼을 눌러 명시적으로 선택했을 때만 켜지는
// 플래그. Ollama가 연결·설치돼 있어도 이게 true면 analyzeWithAI()가 Ollama
// 경로를 건너뛴다. 속도 비교를 자동 판단해 몰래 전환하지 않고, 항상 사용자가
// 눈으로 안내를 보고 직접 선택한 경우에만 켠다(자동 전환은 다운로드 유발 등
// 부작용이 있어 채택하지 않음 — 대화 참고).
//
// sessionStorage에 저장하는 이유: 처음엔 메모리 변수(let)로만 뒀는데, 실사용
// 중 "카나나로 전환했다가 다운로드 오류로 새로고침 → Ollama로 도로 바뀌어
// 있고 다시 전환할 버튼도 안 보임"이 실측됐다(대화 참고). 새로고침에도
// 선택이 유지되도록 세션 스토리지에 함께 저장한다.
const FORCE_BROWSER_ENGINE_KEY = 'houtoti-force-browser-engine';

function readForceBrowserEngine() {
  try {
    return sessionStorage.getItem(FORCE_BROWSER_ENGINE_KEY) === '1';
  } catch (e) {
    return false; // sessionStorage 접근 불가(프라이빗 모드 등) — 메모리 전용으로 폴백
  }
}

let forceBrowserEngine = readForceBrowserEngine();

export function setForceBrowserEngine(value) {
  forceBrowserEngine = !!value;
  try {
    sessionStorage.setItem(FORCE_BROWSER_ENGINE_KEY, forceBrowserEngine ? '1' : '0');
  } catch (e) {
    /* 저장 실패는 무시 — 이번 세션(새로고침 전까지)엔 메모리 값으로 정상 동작 */
  }
}

export function getForceBrowserEngine() {
  return forceBrowserEngine;
}

// 현재 어떤 엔진이 쓰이는지 UI에서 표시할 수 있도록 노출.
// 외부 계약('ollama'/'browser' 두 값)은 TICKET-4·5·6이 그대로 소비하므로
// 바꾸지 않는다(00-overview.md §4.4) — 내부 판단 기준만 새 상태로 교체.
export function currentEngine() {
  if (forceBrowserEngine) return 'browser';
  return ollamaConnectionState === 'connected' && isModelInstalled(selectedOllamaModelId) ? 'ollama' : 'browser';
}

// ---------- Ollama GPU/CPU 처리 상태 확인 ----------
// Ollama는 연결·모델설치 여부만으로는 "빠른지"를 알 수 없다 — GPU를 못 써서
// CPU로만 도는 경우 응답이 수 분씩 걸릴 수 있는데(실측 사례 있음), 배지에는
// 그냥 "Ollama 사용 중"으로만 뜨니 사용자가 원인을 알 방법이 없었다.
// /api/ps는 로드된 모델의 size_vram(GPU에 올라간 바이트 수)을 알려주므로,
// size_vram이 0이면 완전 CPU 처리로 판단한다(ollama CLI의 `ollama ps`
// PROCESSOR 열과 같은 계산 방식). 모델이 아직 로드되지 않은 시점(첫 요청
// 전)에는 /api/ps에 항목이 없을 수 있어 그 경우 null을 반환한다 — 호출부는
// "판단 불가"로 취급하고 안내를 띄우지 않는다.
export async function getOllamaProcessorInfo() {
  try {
    const res = await fetch(OLLAMA_URL + '/api/ps', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const modelConf = OLLAMA_MODELS[selectedOllamaModelId];
    const entry = (data.models || []).find((m) => m.name === modelConf.id || m.name.indexOf(modelConf.id) === 0);
    if (!entry) return null;
    const size = entry.size || 0;
    const sizeVram = entry.size_vram || 0;
    const gpuRatio = size > 0 ? sizeVram / size : 0;
    return { isCpuOnly: gpuRatio === 0, gpuPercent: Math.round(gpuRatio * 100) };
  } catch (e) {
    return null; // 확인 실패는 조용히 무시 — 안내 문구를 못 띄울 뿐 분석 자체엔 영향 없음
  }
}

// TICKET-4: js/main.js는 <script src="js/main.js">(비-module)로 로드되어
// export된 함수를 import할 수 없다(00-overview.md §4.1 전역 브릿지 방식
// 확정). 모듈 톱레벨에서 실행되는 코드이므로, js/ai-ui.js(module)가 이
// 파일을 import하는 즉시(문서 파싱 완료 후, DOMContentLoaded 발생 전)
// window.__hututiEngine이 존재함이 보장된다.
if (typeof window !== 'undefined') {
  window.__hututiEngine = {
    currentEngine: currentEngine,
    getSelectedModelLabel: function () {
      var models = listOllamaModels();
      var m = models.filter(function (x) { return x.id === getSelectedModelId(); })[0];
      return m ? m.label : null;
    },
  };
}

// AI 응답에서 후속질문 섹션을 분리해 UI가 표시할 수 있게 해준다.
// followUpQuestionsText가 null이면 섹션 자체가 없었던 것(2차 분석 등).
export function splitFollowUpSection(answerText) {
  const idx = answerText.indexOf(FOLLOWUP_MARKER);
  if (idx === -1) return { mainText: answerText, followUpQuestionsText: null };

  const before = answerText.slice(0, idx).trim();
  const after = answerText.slice(idx + FOLLOWUP_MARKER.length).trim();
  const hasQuestions = after && after.indexOf(FOLLOWUP_NONE_TEXT) === -1;
  return { mainText: before, followUpQuestionsText: hasQuestions ? after : null };
}

// 결과 패널("유력한 진단")이 표시할 텍스트만 뽑아낸다. buildSystemPrompt()가
// FINAL_CANDIDATES_MARKER를 항상 FOLLOWUP_MARKER보다 먼저 쓰도록 지시해두었으므로,
// "FINAL_CANDIDATES_MARKER부터 FOLLOWUP_MARKER 직전(없으면 끝)까지"만 잘라내면 된다.
// 모델이 형식을 안 지켜 마커 자체가 없으면 null을 반환 — 이 경우 UI는 이전
// 턴에서 보여주던 값을 그대로 유지한다(패널이 빈 값으로 덮어써지지 않도록).
export function extractFinalCandidates(answerText) {
  const startIdx = answerText.indexOf(FINAL_CANDIDATES_MARKER);
  if (startIdx === -1) return null;
  const contentStart = startIdx + FINAL_CANDIDATES_MARKER.length;
  const followUpIdx = answerText.indexOf(FOLLOWUP_MARKER, contentStart);
  const contentEnd = followUpIdx === -1 ? answerText.length : followUpIdx;
  const text = answerText.slice(contentStart, contentEnd).trim();
  return text || null;
}

// conversation: [{ role: 'user'|'assistant', text: string }, ...] — 시간순,
// 최소 1개(최초 소견). 채팅형 다회 순환을 지원하기 위해 "소견 1개 + 답변
// 1개"였던 기존 2-메시지 고정 구조를 대화 배열 전체로 재설계했다(TICKET-1).
//
// forceConclusion: true면 상담자가 "충분함" 버튼을 눌러 AI 판단을 기다리지
// 않고 즉시 최종 결론만 요청하는 강제 종결 모드다(00-overview.md §4.4).
//
// 종료 감지 메커니즘 — 옵션 1(프롬프트 내재화) 채택:
// forceConclusion=false(진행 중) 모드에서 buildSystemPrompt()가 "상담자가
// 자연어로 종료 의사를 표현하면 더 묻지 말고 FOLLOWUP_MARKER 섹션에
// FOLLOWUP_NONE_TEXT만 쓰라"고 지시해두었으므로(위 buildSystemPrompt() 4번
// 항목), 그 결과 이번 턴 응답에 실질적인 후속 질문이 없어지는 것(
// splitFollowUpSection().followUpQuestionsText === null)을 "이번 턴에서
// 자연 종료됨"의 판정 신호로 그대로 재사용한다. 옵션 2(별도 분류 프롬프트,
// 매 턴 API 호출 2배)나 옵션 3(내부 접두어, "마커 방식 미채택" 확정과
// 긴장 관계)보다 추가 호출·설계 복잡도가 없고 기존 함수를 그대로 쓸 수
// 있어 채택했다. 판정 자체(즉 splitFollowUpSection() 호출)는 이 함수의
// 책임이 아니라 TICKET-3(js/ai-ui.js)의 책임이다 — 이 함수는 원문 텍스트만
// 반환한다.
// onDelta(선택, 신규): 넘기면 토큰이 생성되는 대로 그 조각 텍스트를 실시간
// 콜백으로 받는다(핵심요약 → 유력가설 → ... 순서로 채팅창에 하나씩 보여주는
// 기능의 기반 — 대화 참고). Ollama·wllama 둘 다 지원한다. 스트리밍 중
// onDelta로 넘어가는 텍스트는 원문 그대로(정리 전)라 극히 드물게 제어
// 토큰(<think> 등)이 잠깐 섞여 보일 수 있지만, 최종 저장되는 conversation
// 텍스트는 지금처럼 finalizeModelOutput()으로 정리된 버전이다 — 실시간
// 표시 중의 사소한 미정리보다 스트리밍 자체의 체감 이득이 크다고 판단해
// 받아들인 트레이드오프다.
// abortSignal(선택, 신규): "대화 초기화"를 누르면 진행 중인 요청을 즉시
// 취소할 수 있도록 호출부(ai-ui.js)가 AbortController.signal을 넘긴다.
// 취소되면 이 함수는 AbortError를 그대로 던진다(호출부가 "오류 발생"
// 문구를 안 띄우고 조용히 정리하도록) — Ollama 실패 시의 wllama 폴백
// 로직과 섞이지 않도록 아래에서 AbortError는 즉시 재던지고 폴백을 타지
// 않는다(취소된 요청을 취소 안 된 척 다른 엔진으로 재시도하면 안 됨).
export async function analyzeWithAI(conversation, onProgress, forceConclusion, onDelta, abortSignal) {
  const combinedUserText = conversation
    .filter(function (t) { return t.role === 'user'; })
    .map(function (t) { return t.text; })
    .join('\n');
  // §4.1 결정(옵션 B 채택): 최초 소견 하나가 아니라 대화 내 모든 user 발화를
  // 합쳐 진단 사전 그라운딩을 매번 재계산한다 — 후속 답변에서 나온 새 키워드도
  // 후보 추림에 반영되도록. DIAGNOSES 배열 크기상 매 턴 재계산 비용은 무시할
  // 수준이라 회귀 위험 없이 요구사항 취지("히스토리 전체 활용")에 더 부합한다.
  const relevant = pickRelevantDiagnoses(combinedUserText, MAX_DICT_DIAGNOSES);
  const dictionaryText = formatDiagnosisDictionary(relevant);
  const systemPrompt = buildSystemPrompt(dictionaryText, !!forceConclusion);

  const messages = [{ role: 'system', content: systemPrompt }]
    .concat(conversation.map(function (t) { return { role: t.role, content: t.text }; }));

  // 1순위: PC에 설치된 Ollama (빠름). 없으면 브라우저 내 모델로 폴백.
  //
  // 재검사 정책(계획 리뷰 Warning 1 반영, TICKET-2 §5): 방식 A(실패 시에만
  // 강제 재검사)를 채택했다. 방식 B(매 분석 시도마다 항상 강제 재검사)는
  // Ollama가 계속 켜져 있는 대다수 정상 경로에도 매번 최대 15초 타임아웃
  // 위험을 다시 노출시킨다(00-overview.md §5 위험 #10과 동일 트레이드오프).
  // 방식 A는 정상 경로엔 지연을 추가하지 않으면서도, "세션 초반엔 감지됐지만
  // 이후 Ollama가 꺼진" 흔한 시나리오에서 fetch 실패를 계기로 캐시를 무효화해
  // 최신 상태를 다시 확인한다.
  // forceBrowserEngine: 사용자가 "카나나로 전환" 배너 버튼을 눌렀으면 Ollama가
  // 연결돼 있어도 이 경로 자체를 건너뛴다(위 setForceBrowserEngine() 참고).
  if (!forceBrowserEngine && await detectOllama()) {
    try {
      return finalizeModelOutput(await analyzeWithOllama(messages, onDelta, abortSignal));
    } catch (e) {
      if (e && e.name === 'AbortError') throw e; // 취소는 폴백하지 않고 그대로 전파(위 주석 참고)
      // Ollama가 세션 중 꺼졌거나 대상 모델이 삭제됐을 가능성 — 캐시된 값을
      // 더 이상 신뢰하지 않고 강제 재검사로 상태를 갱신한 뒤, 그 결과와
      // 무관하게 아래 wllama 경로로 폴백한다(재검사 결과가 다시 true여도
      // 방금 실패한 요청을 이 함수 안에서 또 재시도하지는 않는다 — 무한
      // 재시도로 인한 지연·중복 요청을 피하기 위함).
      await detectOllama(true);
    }
  }

  if (abortSignal && abortSignal.aborted) {
    throw new DOMException('사용자가 취소함', 'AbortError');
  }

  await ensureModelLoaded(onProgress);

  // wllama(브라우저 내 Kanana)는 생각과정 유무 선택 대상이 아닌 별도 고정
  // 엔진이므로, 이번 engine-selector 트랙의 모델 레지스트리·토큰 파라미터화와
  // 무관하게 기존 고정값을 그대로 둔다(TICKET-1 판단, 00-overview.md §4·requirements.md §3.5 참고).
  // N_CTX=4096 컨텍스트 한도(00-overview.md §5 위험#3): 요약 압축 없이 전체
  // 누적 대화를 그대로 전달하므로, 대화가 매우 길어지면 한도 초과로 요청
  // 자체가 실패할 수 있다. 이 함수는 그 경우 예외를 그대로 던지며(조용히
  // 삼키지 않음), 호출부(TICKET-3)가 사용자에게 안내할 수 있게 한다.
  if (typeof onDelta !== 'function') {
    const result = await wllama.createChatCompletion({
      messages: messages,
      max_tokens: 1800,
      temperature: 0.3,
      abortSignal: abortSignal,
    });
    return finalizeModelOutput(result.choices[0].message.content);
  }

  // wllama 스트리밍: stream:true + onData 콜백 조합(@wllama/wllama 3.5.1
  // 확인된 API — 청크가 OpenAI 호환 형식이라 delta.content로 조각 텍스트가
  // 온다). onData가 있으면 함수가 void를 반환하므로 fullText를 직접 누적한다.
  let fullText = '';
  await wllama.createChatCompletion({
    messages: messages,
    max_tokens: 1800,
    temperature: 0.3,
    abortSignal: abortSignal,
    stream: true,
    onData: function (chunk) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
    },
  });

  return finalizeModelOutput(fullText);
}
