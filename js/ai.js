/* ==========================================================================
   후투티 — 브라우저 내 로컬 AI(카나나 GGUF, wllama) 연동
   모델은 사용자의 브라우저 안에서만 실행되며(WebAssembly), 소견 텍스트는
   외부 서버로 전송되지 않습니다. 최초 1회 모델 파일(약 1.4GB)을 내려받으며,
   이후에는 브라우저 캐시에 저장되어 다시 열 때 빠르게 로드됩니다.
   ========================================================================== */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/index.js';

const WASM_PATH_CONFIG = {
  default: 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/wasm/wllama.wasm',
};

const MODEL_URL = 'https://huggingface.co/aninsong/kanana-1.5-2.1b-instruct-gguf/resolve/main/kanana-1.5-2.1b-instruct-Q4_K_M.gguf';

const SYSTEM_PROMPT = [
  '당신은 정신건강 임상 스크리닝을 보조하는 한국어 도구입니다.',
  '아래 내담자 소견을 읽고, DSM-5-TR이 다루는 진단 범주의 개념에 근거하여',
  '가능성이 있는 진단 후보를 최대 5개까지 한국어로 제시하세요.',
  '각 후보마다 소견 속 어떤 표현이 근거가 되었는지 함께 설명하세요.',
  '반드시 "가능성이 있는 후보"로만 표현하고 확정적으로 단정하지 마세요.',
  '소견에 위기 징후(자살사고, 자해, 급성 정신병적 증상 등)가 보이면 가장 먼저 강조하세요.',
  '마지막 줄에 반드시 다음 문장을 그대로 포함하세요:',
  '"이는 참고용 스크리닝 결과이며 실제 진단이 아닙니다. 자격을 갖춘 임상가의 평가가 반드시 필요합니다."',
].join(' ');

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

  const result = await wllama.createChatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: noteText },
    ],
    max_tokens: 700,
    temperature: 0.4,
  });

  return result.choices[0].message.content;
}
