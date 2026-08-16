/* ==========================================================================
   interview-ai.js — 문답 화면의 "AI 설명 받기" 연동

   AI가 관여하는 유일한 지점이다. 호출은 문답이 끝난 뒤 버튼을 누를 때 **딱 한 번**,
   보내는 것은 이미 확정된 후보 몇 개와 상담자가 체크한 근거, 그리고 기간·빈도 등
   축별 판정 결과뿐이다(진단 사전 전체 ❌, 대화 이력 ❌ — 애초에 대화가 없다).

   AI는 판단·계산을 하지 않는다. 프로그램이 이미 낸 결론을 문장으로 정리할 뿐이다.
   축별 판정을 함께 넘기므로 "무엇이 아직 확인되지 않았는지"까지 짚어줄 수 있다.

   이 파일만 ES module인 이유:
     js/ai.js가 module이라 import하려면 이쪽도 module이어야 한다. 반면 문답 본체
     (interview.js)는 파일을 직접 열었을 때(file://)도 동작해야 해서 일반 스크립트다.
     브라우저는 file:// 에서 module 로드를 차단하므로 그 환경에서는 이 파일이 아예
     실행되지 않는데, 그때는 window.__hututiInterviewAI가 정의되지 않아 문답 화면이
     "AI 설명 받기" 버튼을 내놓지 않는다. 나머지 기능은 전부 정상 동작한다.

   두 파일은 서로 import할 수 없으므로 window 전역으로 연결한다.
     interview.js가 노출  window.__hututiSession     (재료 제공·결과 수신)
     이 파일이 노출       window.__hututiInterviewAI (가용 여부·실행)
   ========================================================================== */

import { explainCandidates, followUpChat, currentEngine, detectOllama } from './ai.js?v=32';

var running = false;

function el(id) { return document.getElementById(id); }

function setStatus(text) {
  var box = el('ai-status');
  if (!box) return;
  box.hidden = !text;
  box.textContent = text || '';
}

function setBusy(busy) {
  running = busy;
  var btn = el('ai-explain-btn');
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-loading', busy);
  var label = btn.querySelector('.ai-btn-label');
  if (label) label.textContent = busy ? '정리하는 중…' : 'AI 설명 받기';
}

function formatBytes(n) { return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB'; }

// 카나나는 최초 1회 약 1.4GB 모델을 내려받는다. 아무 안내 없이 몇 분이 흐르면
// 고장으로 오해하므로 진행률을 그대로 보여준다.
function onProgress(loaded, total) {
  if (!total) return;
  var pct = Math.round((loaded / total) * 100);
  setStatus('브라우저 AI 모델을 준비하는 중입니다 — ' + pct + '% (' +
    formatBytes(loaded) + ' / ' + formatBytes(total) + '). 최초 1회만 내려받고 이후에는 바로 시작합니다.');
}

async function run() {
  if (running) return;
  if (!window.__hututiSession) {
    setStatus('문답 상태를 읽을 수 없습니다. 페이지를 새로고침해 주세요.');
    return;
  }

  var snapshot = window.__hututiSession.getSnapshot();
  if (!snapshot.candidates || !snapshot.candidates.length) {
    setStatus('먼저 증상 항목에 체크해 주세요. 체크된 근거가 있어야 설명을 만들 수 있습니다.');
    return;
  }

  setBusy(true);
  try {
    await detectOllama();
    setStatus(currentEngine() === 'ollama'
      ? 'Ollama(설치된 로컬 AI)로 정리하고 있습니다…'
      : '브라우저 내 AI(카나나)로 정리하고 있습니다. 잠시 걸릴 수 있습니다…');
  } catch (e) {
    setStatus('정리하고 있습니다…');
  }

  try {
    var text = await explainCandidates(snapshot, onProgress, null);
    window.__hututiSession.setAiText(text);   // 화면 갱신은 interview.js가 맡는다
    setStatus('');
  } catch (e) {
    // 실패해도 판정 결과는 이미 화면에 있다 — AI는 보조일 뿐임을 문구로 분명히 한다.
    setStatus('AI 설명을 만들지 못했습니다: ' + (e && e.message ? e.message : '알 수 없는 오류') +
      ' — 오른쪽 판정 결과와 "결과 저장"은 그대로 사용하실 수 있습니다.');
  } finally {
    setBusy(false);
  }
}

// 문답이 끝난 뒤 이어지는 자유 질문. 입력창이 다시 살아나면 이 함수가 받는다.
// chat.html이 하던 일을 문답 화면 안으로 들여온 것이다.
async function ask(question) {
  if (running) return;
  if (!window.__hututiSession) return;

  var snapshot = window.__hututiSession.getSnapshot();
  setBusy(true);
  try {
    await detectOllama();
    setStatus(currentEngine() === 'ollama' ? 'Ollama로 답을 만들고 있습니다…' : '브라우저 내 AI로 답을 만들고 있습니다…');
  } catch (e) {
    setStatus('답을 만들고 있습니다…');
  }

  try {
    var history = window.__hututiSession.getFollowUp();
    var text = await followUpChat(snapshot, history, question, onProgress, null);
    window.__hututiSession.pushFollowUp('assistant', text);
    setStatus('');
  } catch (e) {
    window.__hututiSession.pushFollowUp('assistant',
      '답변을 만들지 못했습니다: ' + (e && e.message ? e.message : '알 수 없는 오류') +
      '\n\n문진 결과와 "결과 저장"은 그대로 사용하실 수 있습니다.');
    setStatus('');
  } finally {
    setBusy(false);
  }
}

// 이 객체의 존재 여부로 문답 화면이 AI 기능 노출을 결정한다.
// file:// 환경에서는 이 파일이 로드되지 않아 객체 자체가 없다 —
// 그때는 AI 버튼도, 후속 질문 입력창도 나타나지 않는다.
window.__hututiInterviewAI = { available: true, explain: run, ask: ask };

// **중요**: 이 파일은 ai.js를 통해 외부 CDN(wllama)을 import하므로 실행이
// 화면 첫 렌더보다 늦어지는 일이 흔하다. 그대로 두면 문답 화면이 "AI 없음"
// 상태로 굳어 입력창이 잠기고 버튼도 안 나온다. 준비됐음을 알려 다시 그리게 한다.
if (window.__hututiSession && typeof window.__hututiSession.refresh === 'function') {
  window.__hututiSession.refresh();
} else {
  // 문답 화면이 아직 초기화되기 전이면 그쪽이 끝난 뒤에 알린다.
  document.addEventListener('DOMContentLoaded', function () {
    if (window.__hututiSession && typeof window.__hututiSession.refresh === 'function') {
      window.__hututiSession.refresh();
    }
  });
}
