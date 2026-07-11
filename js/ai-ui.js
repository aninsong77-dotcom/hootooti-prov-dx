import { analyzeWithAI, isModelReady, currentEngine, splitFollowUpSection, detectOllama } from './ai.js?v=12';

function formatBytes(n) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

function formatRemaining(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return ' · 예상 남은 시간 약 ' + Math.ceil(seconds) + '초';
  var min = Math.round(seconds / 60);
  return ' · 예상 남은 시간 약 ' + min + '분';
}

function playDing() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var now = ctx.currentTime;
    [880, 1320].forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch (e) {
    /* 소리 재생 실패는 무시 (분석 결과 자체엔 영향 없음) */
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('ai-analyze-btn');
  var notesInput = document.getElementById('notes-input');
  var statusEl = document.getElementById('ai-status');
  var resultCard = document.getElementById('ai-result-card');
  var resultText = document.getElementById('ai-result-text');
  var copyBtn = document.getElementById('copy-ai-result-btn');
  var emptyHint = document.getElementById('results-empty-hint');
  var followUpBox = document.getElementById('ai-followup-box');
  var followUpQuestionsEl = document.getElementById('ai-followup-questions');
  var followUpAnswerEl = document.getElementById('ai-followup-answer');
  var followUpSubmitBtn = document.getElementById('ai-followup-submit-btn');
  var engineInfoBtn = document.getElementById('ai-engine-info-btn');
  var engineModalOverlay = document.getElementById('ai-engine-modal-overlay');
  var engineModalClose = document.getElementById('ai-engine-modal-close');
  var engineCurrentEl = document.getElementById('ai-engine-current');
  if (!btn || !notesInput) return;

  // "AI 엔진 안내" 모달 — 지금 어떤 엔진이 쓰이는지, 더 빠른 엔진을 쓰려면
  // 무엇을 설치해야 하는지 안내한다 (설치 자체는 웹페이지가 대신 해줄 수 없음).
  if (engineInfoBtn && engineModalOverlay) {
    engineInfoBtn.addEventListener('click', async function () {
      engineModalOverlay.hidden = false;
      engineCurrentEl.textContent = '현재 상태를 확인하는 중입니다...';
      var usingOllama = await detectOllama();
      engineCurrentEl.textContent = usingOllama
        ? '현재 상태: 2단계(Ollama · qwen3:4b-instruct)가 감지되어 사용 중입니다.'
        : '현재 상태: 1단계(브라우저 내장 Kanana)가 사용 중입니다. Ollama가 감지되지 않았습니다.';
    });
    if (engineModalClose) {
      engineModalClose.addEventListener('click', function () {
        engineModalOverlay.hidden = true;
      });
    }
    engineModalOverlay.addEventListener('click', function (e) {
      if (e.target === engineModalOverlay) engineModalOverlay.hidden = true;
    });
  }

  // 후속 질문에 답변을 반영해 재분석할 때 원본 소견 텍스트가 필요해 기억해둔다.
  var lastNoteText = '';

  function showFollowUp(followUpQuestionsText) {
    if (!followUpBox || !followUpQuestionsText) {
      if (followUpBox) followUpBox.hidden = true;
      return;
    }
    followUpQuestionsEl.textContent = followUpQuestionsText;
    followUpAnswerEl.value = '';
    followUpBox.hidden = false;
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = resultText.textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        var original = copyBtn.textContent;
        copyBtn.textContent = '복사됨';
        copyBtn.classList.add('copied');
        setTimeout(function () {
          copyBtn.textContent = original;
          copyBtn.classList.remove('copied');
        }, 1500);
      });
    });
  }

  btn.addEventListener('click', async function () {
    var noteText = notesInput.value.trim();
    if (!noteText) {
      statusEl.hidden = false;
      statusEl.textContent = '먼저 위 칸에 내담자 소견을 입력해 주세요.';
      return;
    }

    lastNoteText = noteText;
    if (followUpBox) followUpBox.hidden = true;

    btn.disabled = true;
    btn.classList.add('loading');
    statusEl.hidden = true;

    var sawRealDownload = false;
    var downloadStartedAt = 0;

    try {
      var answer = await analyzeWithAI(noteText, function (loaded, total) {
        if (isModelReady() || !total) return;
        if (loaded >= total) {
          // 다운로드 완료 후 적재/분석 단계 — 진행률 신호가 더 안 오므로 문구를 전환해둔다.
          if (sawRealDownload) {
            statusEl.hidden = false;
            statusEl.textContent = '다운로드 완료 — 모델을 준비하고 분석 중입니다 (수 분 걸릴 수 있습니다)...';
          }
          return;
        }
        // 실제로 바이트 단위로 늘어나는 경우만 "다운로드 중"으로 표시.
        // (캐시에서 불러올 때는 loaded===total로 즉시 호출되어 여기로 안 옴 — 버튼 스피너만으로 충분)
        if (!sawRealDownload) {
          sawRealDownload = true;
          downloadStartedAt = Date.now();
        }
        var elapsedSec = (Date.now() - downloadStartedAt) / 1000;
        var speed = elapsedSec > 0.3 ? loaded / elapsedSec : 0;
        var remainingSec = speed > 0 ? (total - loaded) / speed : NaN;
        statusEl.hidden = false;
        statusEl.textContent =
          '모델 다운로드 중 (최초 1회, 약 1.4GB)... ' + formatBytes(loaded) + ' / ' + formatBytes(total) +
          (isFinite(remainingSec) ? formatRemaining(remainingSec) : ' · 예상 남은 시간 계산 중...');
      });

      statusEl.hidden = true;
      if (emptyHint) emptyHint.hidden = true;
      resultCard.hidden = false;
      var split = splitFollowUpSection(answer);
      resultText.textContent = split.mainText;
      showFollowUp(split.followUpQuestionsText);
      var badge = document.getElementById('ai-mode-badge');
      if (badge) {
        badge.textContent = currentEngine() === 'ollama'
          ? '로컬 엔진 (Ollama · Qwen3-4B)'
          : '브라우저 내 로컬 AI (Kanana)';
      }
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      playDing();
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent =
        'AI 분석 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  if (followUpSubmitBtn) {
    followUpSubmitBtn.addEventListener('click', async function () {
      var answerText = followUpAnswerEl.value.trim();
      if (!answerText || !lastNoteText) return;

      followUpSubmitBtn.disabled = true;
      followUpSubmitBtn.classList.add('loading');
      statusEl.hidden = true;

      try {
        var answer = await analyzeWithAI(lastNoteText, null, answerText);
        var split = splitFollowUpSection(answer);
        resultText.textContent = split.mainText;
        // 2차 분석 프롬프트는 후속질문 섹션을 다시 만들지 않도록 지시했으므로
        // 정상적으로는 항상 숨겨지지만, 혹시 모델이 재차 질문을 붙였다면 보여준다.
        showFollowUp(split.followUpQuestionsText);
        var badge = document.getElementById('ai-mode-badge');
        if (badge) {
          badge.textContent = currentEngine() === 'ollama'
            ? '로컬 엔진 (Ollama · Qwen3-4B)'
            : '브라우저 내 로컬 AI (Kanana)';
        }
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        playDing();
      } catch (err) {
        statusEl.hidden = false;
        statusEl.textContent =
          'AI 재분석 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
      } finally {
        followUpSubmitBtn.disabled = false;
        followUpSubmitBtn.classList.remove('loading');
      }
    });
  }
});
