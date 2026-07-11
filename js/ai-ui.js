import { analyzeWithAI, isModelReady } from './ai.js?v=2';

function formatBytes(n) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('ai-analyze-btn');
  var notesInput = document.getElementById('notes-input');
  var statusEl = document.getElementById('ai-status');
  var resultCard = document.getElementById('ai-result-card');
  var resultText = document.getElementById('ai-result-text');
  var copyBtn = document.getElementById('copy-ai-result-btn');
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
    statusEl.hidden = false;
    statusEl.textContent = isModelReady()
      ? 'AI가 분석 중입니다...'
      : 'Kanana 모델을 준비하는 중입니다...';

    var sawRealDownload = false;

    try {
      var answer = await analyzeWithAI(noteText, function (loaded, total) {
        if (isModelReady() || !total) return;
        if (loaded < total) {
          // 실제로 바이트 단위로 늘어나는 경우만 "다운로드"로 표시.
          sawRealDownload = true;
          statusEl.textContent =
            '모델 다운로드 중 (최초 1회, 약 1.4GB)... ' + formatBytes(loaded) + ' / ' + formatBytes(total);
        } else if (sawRealDownload) {
          statusEl.textContent = '모델을 초기화하는 중입니다...';
        } else {
          // 캐시에 이미 있는 경우 진행률 콜백이 곧바로 100%로 옴 — 다운로드가 아니라 로딩임.
          statusEl.textContent = '캐시된 모델을 불러오는 중입니다 (다운로드 없음)...';
        }
      });

      statusEl.hidden = true;
      resultCard.hidden = false;
      resultText.textContent = answer;
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent =
        'AI 분석 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });
});
