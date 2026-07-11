import { analyzeWithAI, isModelReady, currentEngine } from './ai.js?v=11';

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
  if (!btn || !notesInput) return;

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
      resultText.textContent = answer;
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
});
