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

function buildSystemPrompt(dictionaryText) {
  return [
    '당신은 정신건강 임상 스크리닝을 보조하는 한국어 도구입니다.',
    '아래 "진단 기준 사전"은 DSM-5-TR의 개념을 참고하여 재서술한 체크리스트 데이터이며,',
    '당신이 근거로 삼을 수 있는 것은 이 사전에 적힌 항목뿐입니다. 사전에 없는 진단명이나',
    '기준을 만들어내지 마세요.',
    '',
    '=== 진단 기준 사전 (내담자 소견과 키워드가 겹치는 상위 후보) ===',
    dictionaryText,
    '=== 사전 끝 ===',
    '',
    '위 사전을 참고하여, 아래 내담자 소견을 분석하세요.',
    '가능성이 있는 진단 후보를 최대 5개까지, 반드시 사전에 있는 이름으로만 한국어로 제시하세요.',
    '각 후보마다 사전의 어떤 기준 항목과 소견의 어떤 표현이 근거가 되었는지 함께 설명하세요.',
    '사전의 항목들과 뚜렷이 겹치는 근거가 없다면 "뚜렷이 부합하는 후보 없음"이라고 답하세요.',
    '반드시 "가능성이 있는 후보"로만 표현하고 확정적으로 단정하지 마세요.',
    '소견에 위기 징후(자살사고, 자해, 급성 정신병적 증상 등)가 보이면 가장 먼저 강조하세요.',
    '마지막 줄에 반드시 다음 문장을 그대로 포함하세요:',
    '"이는 참고용 스크리닝 결과이며 실제 진단이 아닙니다. 자격을 갖춘 임상가의 평가가 반드시 필요합니다."',
  ].join('\n');
}

// ---------- Ollama (설치형 로컬 엔진) 연동 ----------
// PC에 Ollama가 설치·실행 중이면 브라우저 내 모델 대신 그쪽을 쓴다.
// 훨씬 빠르고(네이티브 실행) 더 큰 모델을 쓸 수 있다. 소견은 localhost로만
// 전송되므로 개인정보는 동일하게 PC 밖으로 나가지 않는다.
const OLLAMA_URL = 'http://localhost:11434';
// qwen3:4b(생각모드 버전)는 최종 답을 내기 전 영어로 아주 길게 "생각"하다가
// 토큰 한도를 다 써버려 실사용이 어려움 — 바로 한국어 최종 답만 내는
// instruct(생각모드 없는) 버전을 쓴다.
const OLLAMA_MODEL = 'qwen3:4b-instruct';

let ollamaAvailable = null; // null = 미확인, true/false = 확인됨

export async function detectOllama() {
  if (ollamaAvailable !== null) return ollamaAvailable;
  try {
    // 첫 방문 시 "PC의 사설망(localhost) 접근 허용" 권한 창이 뜨는데, 사용자가
    // 그 창을 확인하고 누르는 시간까지 감안해 넉넉하게 잡는다 (너무 짧으면
    // 권한 창이 떠 있는 동안 자체적으로 타임아웃돼 버려 항상 실패로 오판했었음).
    const res = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    ollamaAvailable = models.some((n) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL));
  } catch (e) {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}

// 모델 내부 제어 토큰(<|eot_id|>, <|im_end|> 등)이나 <think> 블록이 응답에
// 섞여 나오는 경우가 있어 사용자에게 보여주기 전에 걸러낸다.
function cleanModelOutput(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\|[a-zA-Z0-9_]+\|>/g, '')
    .trim();
}

async function analyzeWithOllama(systemPrompt, noteText) {
  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: noteText },
      ],
      stream: false,
      options: { temperature: 0.3, num_predict: 800 },
    }),
  });
  if (!res.ok) throw new Error('Ollama 응답 오류 (HTTP ' + res.status + ')');
  const data = await res.json();
  return data.message.content;
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

// 현재 어떤 엔진이 쓰이는지 UI에서 표시할 수 있도록 노출.
export function currentEngine() {
  return ollamaAvailable === true ? 'ollama' : 'browser';
}

export async function analyzeWithAI(noteText, onProgress) {
  const relevant = pickRelevantDiagnoses(noteText, MAX_DICT_DIAGNOSES);
  const dictionaryText = formatDiagnosisDictionary(relevant);
  const systemPrompt = buildSystemPrompt(dictionaryText);

  // 1순위: PC에 설치된 Ollama (빠름). 없으면 브라우저 내 모델로 폴백.
  if (await detectOllama()) {
    return cleanModelOutput(await analyzeWithOllama(systemPrompt, noteText));
  }

  await ensureModelLoaded(onProgress);

  const result = await wllama.createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: noteText },
    ],
    max_tokens: 800,
    temperature: 0.3,
  });

  return cleanModelOutput(result.choices[0].message.content);
}
