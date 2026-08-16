/* ==========================================================================
   interview-ai.js — 문답 화면의 AI 연동 (설명 생성 · 후속 질문)

   AI가 관여하는 지점은 둘뿐이다.
     ① 문답이 끝난 뒤 "AI 설명 받기" — 확정된 결과를 문장으로 정리 (호출 1회)
     ② 그 뒤 입력창으로 던지는 추가 질문 — chat.html이 하던 자유 대화를 흡수

   보내는 것은 이미 확정된 후보 몇 개와 체크된 근거, 축별 판정뿐이다.
   진단 사전 전체도, 문답 과정도 보내지 않는다(이미 결과로 요약돼 있다).

   ── 2026-08-16 수정: "멈춘 것처럼 보이고 이후 대꾸가 없다" ─────────────────
   세 가지가 겹친 문제였다.
     1. 응답을 토큰 단위로 보여주지 않아, 느린 기기에서 몇 분간 아무 변화가 없어
        멈춘 것으로 보였다 → onDelta로 생성되는 대로 화면에 흘린다.
     2. 생성 중에 사용자가 질문을 입력하면 `if (running) return`으로 **조용히
        버려졌다.** 말풍선은 남는데 답이 영영 오지 않았다 → 생성 중에는 입력창을
        잠그고, 그래도 들어오면 이유를 화면에 알린다.
     3. 취소할 방법이 없어 한 번 늦어지면 되돌릴 수 없었다 → 취소 버튼을 준다.

   이 파일만 ES module인 이유: js/ai.js가 module이라 import하려면 이쪽도 module이어야
   한다. 반면 문답 본체(interview.js)는 파일을 직접 열어도(file://) 동작해야 해서 일반
   스크립트다. 그 환경에서는 이 파일이 로드되지 않고, 화면은 AI 없이 정상 동작한다.
   ========================================================================== */

import { explainCandidates, followUpChat, currentEngine, detectOllama } from './ai.js?v=34';

var running = false;
var abortCtrl = null;

function session() { return window.__hututiSession || null; }

function setStatus(text) {
  var box = document.getElementById('ai-status');
  if (!box) return;
  box.hidden = !text;
  box.textContent = text || '';
}

function formatBytes(n) { return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB'; }

// 카나나는 최초 1회 약 1.4GB 모델을 내려받는다. 안내가 없으면 고장으로 오해한다.
function onProgress(loaded, total) {
  if (!total) return;
  var pct = Math.round((loaded / total) * 100);
  setStatus('브라우저 AI 모델을 준비하는 중입니다 — ' + pct + '% (' +
    formatBytes(loaded) + ' / ' + formatBytes(total) + '). 최초 1회만 내려받습니다.');
}

async function announceEngine(what) {
  try {
    await detectOllama();
    setStatus(currentEngine() === 'ollama'
      ? 'Ollama(설치된 로컬 AI)로 ' + what + ' 중입니다…'
      : '브라우저 내 AI(카나나)로 ' + what + ' 중입니다. 기기에 따라 몇 분 걸릴 수 있습니다…');
  } catch (e) {
    setStatus(what + ' 중입니다…');
  }
}

// 생성 중 공통 처리 — 화면에 "쓰는 중" 말풍선을 띄우고 토큰을 흘려 넣는다.
async function generate(kind, work) {
  var S = session();
  if (!S) return;
  if (running) {
    setStatus('AI가 아직 답하는 중입니다. 끝난 뒤에 다시 시도해 주세요.');
    return;
  }

  running = true;
  abortCtrl = new AbortController();
  S.streamBegin(kind);

  // 응답이 왜 끝났는지 엔진이 알려주는 값. 분량이 차서 잘렸으면 화면에 알린다.
  var meta = null;
  try {
    await announceEngine(kind === 'explain' ? '결과를 정리하는' : '답을 만드는');
    var text = await work(
      abortCtrl.signal,
      function (chunk) { S.streamChunk(chunk); },
      function (m) { meta = m; }
    );
    S.streamEnd(text, null, meta);
    setStatus('');
  } catch (e) {
    if (e && e.name === 'AbortError') {
      S.streamEnd(null, '취소되었습니다.', null);
      setStatus('');
    } else {
      // 실패해도 판정 결과는 이미 화면에 있다 — AI는 보조일 뿐임을 분명히 한다.
      S.streamEnd(null, 'AI 응답을 만들지 못했습니다: ' +
        (e && e.message ? e.message : '알 수 없는 오류') +
        '\n판정 결과와 저장 기능은 그대로 사용하실 수 있습니다.');
      setStatus('');
    }
  } finally {
    running = false;
    abortCtrl = null;
  }
}

function explain() {
  var S = session();
  if (!S) return;
  var snapshot = S.getSnapshot();
  if (!snapshot.candidates || !snapshot.candidates.length) {
    setStatus('먼저 증상 항목에 체크해 주세요. 체크된 근거가 있어야 설명을 만들 수 있습니다.');
    return;
  }
  return generate('explain', function (signal, onDelta, onMeta) {
    return explainCandidates(snapshot, onProgress, signal, onDelta, onMeta);
  });
}

function ask(question) {
  var S = session();
  if (!S) return;
  var snapshot = S.getSnapshot();
  var history = S.getFollowUp().filter(function (t, i, arr) {
    // 방금 밀어 넣은 마지막 사용자 질문은 followUpChat이 따로 받으므로 제외한다
    return !(i === arr.length - 1 && t.role === 'user');
  });
  return generate('ask', function (signal, onDelta, onMeta) {
    return followUpChat(snapshot, history, question, onProgress, signal, onDelta, onMeta);
  });
}

function cancel() {
  if (abortCtrl) abortCtrl.abort();
}

window.__hututiInterviewAI = {
  available: true,
  explain: explain,
  ask: ask,
  cancel: cancel,
  isRunning: function () { return running; },
};

// 이 파일은 ai.js를 통해 외부 CDN(wllama)을 import하므로 실행이 화면 첫 렌더보다
// 늦어지는 일이 흔하다. 그대로 두면 화면이 "AI 없음" 상태로 굳는다.
function notifyReady() {
  var S = session();
  if (S && typeof S.refresh === 'function') S.refresh();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', notifyReady);
else notifyReady();
