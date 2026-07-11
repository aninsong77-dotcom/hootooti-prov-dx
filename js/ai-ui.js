import { analyzeWithAI, isModelReady } from './ai.js';

function formatBytes(n) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('ai-analyze-btn');
  var notesInput = document.getElementById('notes-input');
  var statusEl = document.getElementById('ai-status');
  var resultCard = document.getElementById('ai-result-card');
  var resultText = document.getElementById('ai-result-text');
  if (!btn || !notesInput) return;

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
      : '카나나 모델을 처음 불러오는 중입니다 (최초 1회, 약 1.4GB)...';

    try {
      var answer = await analyzeWithAI(noteText, function (loaded, total) {
        if (!isModelReady() && total) {
          statusEl.textContent =
            '모델 다운로드 중... ' + formatBytes(loaded) + ' / ' + formatBytes(total);
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
