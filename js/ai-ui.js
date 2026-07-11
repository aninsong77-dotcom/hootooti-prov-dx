import { analyzeWithAI, isModelReady } from './ai.js?v=3';

function formatBytes(n) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

function formatRemaining(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return ' · 예상 남은 시간 약 ' + Math.ceil(seconds) + '초';
  var min = Math.round(seconds / 60);
  return ' · 예상 남은 시간 약 ' + min + '분';
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
        if (isModelReady() || !total || loaded >= total) return;
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
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
