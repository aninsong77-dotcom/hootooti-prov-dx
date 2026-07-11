/* ==========================================================================
   후투티 — 브라우저 내 로컬 AI(Qwen3-4B GGUF, wllama) 연동
   모델은 사용자의 브라우저 안에서만 실행되며(WebAssembly), 소견 텍스트는
   외부 서버로 전송되지 않습니다. 최초 1회 모델 파일(약 2.4GB)을 내려받으며,
   이후에는 브라우저 캐시에 저장되어 다시 열 때 빠르게 로드됩니다.

   모델 출처: 알리바바 Qwen 팀 공식 배포본 (Apache 2.0)
   https://huggingface.co/Qwen/Qwen3-4B-GGUF
   SHA256: 7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5

   AI는 js/data.js의 DSM-5-TR 기반 진단 기준("사전")과 무관하게 자기 지식만으로
   답하면 근거가 부실해지므로, 소견과 겹치는 진단 후보를 먼저 키워드로 추려
   그 기준 항목을 프롬프트에 함께 제공(그라운딩)한다.
   ========================================================================== */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/index.js';

const WASM_PATH_CONFIG = {
  default: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/wasm/wllama.wasm',
};

const MODEL_URL = 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf';

const N_CTX = 8192;
const MAX_DICT_DIAGNOSES = 12;

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
  return diagnoses
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
      n_ctx: N_CTX,
      // WebGPU(특히 일부 AMD 드라이버)에서 컨텍스트가 커지면 GPU 큐가 멈추는
      // 사례가 확인되어(DXGI_ERROR_DEVICE_HUNG), 안정성을 위해 CPU로만 실행한다.
      n_gpu_layers: 0,
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

export async function analyzeWithAI(noteText, onProgress) {
  await ensureModelLoaded(onProgress);

  const relevant = pickRelevantDiagnoses(noteText, MAX_DICT_DIAGNOSES);
  const dictionaryText = formatDiagnosisDictionary(relevant);
  const systemPrompt = buildSystemPrompt(dictionaryText);

  const result = await wllama.createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: noteText },
    ],
    max_tokens: 700,
    temperature: 0.3,
    // Qwen3의 "생각 과정(thinking)" 출력을 끔 — 스크리닝 결과만 깔끔하게 받기 위함.
    chat_template_kwargs: { enable_thinking: false },
  });

  const content = result.choices[0].message.content;
  // 템플릿 설정이 안 먹는 경우를 대비해 <think>...</think> 블록은 결과에서 제거.
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
