import {
  analyzeWithAI, isModelReady, currentEngine, splitFollowUpSection, detectOllama,
  listOllamaModels, getSelectedModelId, setSelectedModelId, getOllamaConnectionState,
  isModelInstalled, pullOllamaModel, getLastPullError, getLastOllamaError,
  extractFinalCandidates,
} from './ai.js?v=17';

function formatBytes(n) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

function formatRemaining(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return ' · 예상 남은 시간 약 ' + Math.ceil(seconds) + '초';
  var min = Math.round(seconds / 60);
  return ' · 예상 남은 시간 약 ' + min + '분';
}

// 모델 옵션 설명 문구(모달 안에 항상 보이는 텍스트 — 예전엔 호버 툴팁이었지만
// 화면 중앙 모달로 바뀌며 굳이 숨길 이유가 없어졌다). 모델의 동작 방식을
// 먼저 설명하고, 아직 설치되지 않은 모델일 때만 다운로드 용량 안내를
// 덧붙인다(설치된 모델엔 불필요한 정보라 생략). approxSizeGB가 null(TICKET-3
// §5 위험#8, 실측 전 미확정)이면 숫자를 지어내지 않고 "확인되지 않았습니다"
// 문구로 대체한다.
function buildEngineDescription(model, installed) {
  var behavior = model.thinking
    ? '결론을 내리기 전에 스스로 추론 과정을 먼저 풀어놓고, 그걸 바탕으로 최종 답을 정리하는 모델입니다. 판단 근거를 함께 확인할 수 있지만, 그만큼 응답까지 시간이 더 걸립니다.'
    : '추론 과정을 따로 보여주지 않고 곧바로 결론만 답하는 모델입니다. 응답이 빠르고 간결합니다.';
  if (installed) return behavior;
  var sizeText = typeof model.approxSizeGB === 'number'
    ? ('약 ' + model.approxSizeGB + 'GB를')
    : '용량이 아직 확인되지 않은 파일을';
  return behavior + ' 아직 설치되어 있지 않아, 선택하면 ' + sizeText + ' 새로 내려받는 것부터 시작합니다.';
}

// #ai-mode-badge를 갱신한다. #ai-result-title은 TICKET-2에서 제거되었으므로
// 그 참조 블록은 삭제한다(TICKET-3 §8, 삭제만 하고 새 로직 추가 없음).
function updateEngineDisplay() {
  var badge = document.getElementById('ai-mode-badge');
  var usingOllama = currentEngine() === 'ollama';

  if (badge) {
    badge.textContent = usingOllama
      ? '로컬 엔진 (Ollama · Qwen3-4B)'
      : '브라우저 내 로컬 AI (Kanana)';
  }
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
  var chatMessagesEl = document.getElementById('chat-messages');
  var chatEmptyHintEl = document.getElementById('chat-empty-hint');
  var chatInputEl = document.getElementById('chat-input');
  var chatSendBtn = document.getElementById('chat-send-btn');
  var chatSufficientBtn = document.getElementById('chat-sufficient-btn');
  var finalResultTextEl = document.getElementById('final-result-text');
  var finalResultEmptyHintEl = document.getElementById('final-result-empty-hint');
  var copyFinalResultBtn = document.getElementById('copy-final-result-btn');
  var statusEl = document.getElementById('ai-status'); // :85에서 이 줄만 재선언(그 외 82-93행 변수는 제거)
  // engineSelectBtn 등 94-108행의 엔진/실패배너 관련 변수 선언은 원본 그대로 유지 — 수정하지 않는다.
  var engineSelectBtn = document.getElementById('engine-select-btn');
  var engineSelectLabel = document.getElementById('engine-select-label');
  var engineSelectOverlay = document.getElementById('engine-select-overlay');
  var engineSelectClose = document.getElementById('engine-select-close');
  var engineOptionPopover = document.getElementById('engine-select-body');
  var downloadConfirmOverlay = document.getElementById('download-confirm-overlay');
  var downloadConfirmText = document.getElementById('download-confirm-text');
  var downloadConfirmCancel = document.getElementById('download-confirm-cancel');
  var downloadConfirmOk = document.getElementById('download-confirm-ok');
  var ollamaFailureBanner = document.getElementById('ollama-failure-banner');
  var ollamaFailureMessage = document.getElementById('ollama-failure-message');
  var ollamaDebugToggle = document.getElementById('ollama-debug-toggle');
  var ollamaDebugDetail = document.getElementById('ollama-debug-detail');
  var ollamaDebugRaw = document.getElementById('ollama-debug-raw');
  var ollamaDebugCopyBtn = document.getElementById('ollama-debug-copy-btn');
  if (!chatSendBtn || !chatInputEl || !chatMessagesEl) return;

  // 채팅 입력창의 전송 가능 여부 갱신(구 updateAnalyzeBtnEnabled() 대체) —
  // §4 sendTurn()/전송 트리거와 함께 동작해야 하므로 별도 함수로 아래
  // updateChatInputAvailability()에 통합한다(TICKET-3 §1).

  // Ollama 실패 안내 배너 — "왜 지금 Ollama가 아니라 Kanana로 동작하는지"에만
  // 집중한다("어떻게 설치하는지"는 "AI 선택다운" 팝오버의 설치 안내가 담당,
  // 중복 방지를 위해 이 배너에는 설치 안내를 다시 쓰지 않는다).
  // 최소 2종을 구분한다(요구사항 §3.7):
  //  1) 연결 자체 실패 — getOllamaConnectionState() === 'unreachable'
  //  2) 연결은 됐지만 선택한 모델이 설치돼 있지 않음 — 'connected' + !isModelInstalled(...)
  //     (요구사항 §6에서 우선순위가 가장 높다고 명시한 오분류 방지 항목)
  function renderOllamaFailure() {
    if (!ollamaFailureBanner || !ollamaFailureMessage) return;
    var state = getOllamaConnectionState();

    if (state === 'unreachable') {
      var err = getLastOllamaError();
      ollamaFailureMessage.textContent = (err && err.stage === 'fetch')
        ? 'Ollama에 연결할 수 없습니다. (네트워크 오류 또는 응답 없음 — Ollama가 켜져 있는지 확인해 주세요)'
        : 'Ollama에 연결은 됐지만 응답이 올바르지 않습니다. (서버 오류 또는 예상치 못한 응답 형식)';
      ollamaFailureBanner.hidden = false;
      return;
    }

    if (state === 'connected' && !isModelInstalled(getSelectedModelId())) {
      ollamaFailureMessage.textContent = '선택한 모델이 아직 설치되어 있지 않아 브라우저 내 Kanana로 대신 동작합니다. "AI 선택다운" 버튼에서 다운로드해 주세요.';
      ollamaFailureBanner.hidden = false;
      return;
    }

    ollamaFailureBanner.hidden = true;
    if (ollamaDebugDetail) ollamaDebugDetail.hidden = true;
    if (ollamaDebugToggle) ollamaDebugToggle.setAttribute('aria-expanded', 'false');
  }

  if (ollamaDebugToggle && ollamaDebugDetail && ollamaDebugRaw) {
    ollamaDebugToggle.addEventListener('click', function () {
      var err = getLastOllamaError();
      ollamaDebugRaw.textContent = err
        ? JSON.stringify({
            stage: err.stage,
            message: err.message,
            raw: err.raw,
            timestamp: new Date(err.timestamp).toLocaleString('ko-KR'),
          }, null, 2)
        : '(저장된 오류 정보 없음)';
      var expanded = ollamaDebugDetail.hidden;
      ollamaDebugDetail.hidden = !expanded;
      ollamaDebugToggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  if (ollamaDebugCopyBtn && ollamaDebugRaw) {
    ollamaDebugCopyBtn.addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(ollamaDebugRaw.textContent).then(function () {
        var original = ollamaDebugCopyBtn.textContent;
        ollamaDebugCopyBtn.textContent = '복사됨';
        setTimeout(function () {
          ollamaDebugCopyBtn.textContent = original;
        }, 1500);
      }).catch(function () {
        /* 클립보드 접근 실패는 무시 — 배너 자체는 계속 정상 동작 */
      });
    });
  }

  // "AI 선택다운" 버튼 — 클릭 한 번으로 모든 엔진 관련 안내·조작이 열리는
  // 단일 진입점이다. Ollama가 연결돼 있으면 모델(생각과정 없음/있음) 선택
  // 목록을, 연결돼 있지 않으면 같은 자리에 설치 안내를 보여준다(예전에
  // 있던 별도 "AI 엔진 안내" 모달과 이 버튼이 하던 안내를 하나로 합침 —
  // 같은 사실을 두 UI가 따로 알리지 않도록). 화면 크기에 따라 잘려 보이던
  // 위치계산 팝오버 대신, 화면 중앙에 뜨는 모달(#engine-select-overlay)로
  // 표시한다 — 버튼 위치나 뷰포트 여백을 계산할 필요가 없어 훨씬 단순하고
  // 어떤 화면 크기에서도 항상 완전히 보인다.
  if (engineSelectBtn && engineSelectLabel && engineOptionPopover && engineSelectOverlay) {
    var pendingDownloadModelId = null;

    function closeEnginePopover() {
      engineSelectOverlay.hidden = true;
    }

    // 버튼 라벨은 이제 "AI 선택다운"으로 고정이다(엔진 상태 요약은 팝오버
    // 안에서 보여준다). 페이지 로드 직후(§4.0 최초 감지 완료 전)에도, 이후
    // 감지 결과가 갱신될 때도 이 함수 하나로 버튼의 시각적 상태만 맞춘다 —
    // 더 이상 비활성화(aria-disabled)하지 않는다, Ollama 미감지 상태에서도
    // 이 버튼이 설치 안내를 여는 유일한 진입점이기 때문이다.
    function updateEngineSelectButtonState() {
      var state = getOllamaConnectionState(); // null(확인 전) | 'connected' | 'unreachable'
      engineSelectBtn.classList.remove('is-checking', 'is-unavailable');
      engineSelectBtn.setAttribute('aria-disabled', 'false');
      engineSelectLabel.textContent = 'AI 선택다운';

      if (state === 'unreachable') {
        engineSelectBtn.classList.add('is-unavailable');
      } else if (state !== 'connected') {
        // 아직 감지 중(최대 15초)
        engineSelectBtn.classList.add('is-checking');
      }
    }

    function statusLine(state) {
      if (state === 'connected') {
        var selected = listOllamaModels().filter(function (m) { return m.id === getSelectedModelId(); })[0];
        var modelText = selected ? (selected.thinking ? '생각과정 있음' : '생각과정 없음') : '';
        return '현재 상태: Ollama' + (modelText ? ' · ' + modelText : '') + '가 감지되어 사용 중입니다.';
      }
      if (state === 'unreachable') {
        return '현재 상태: 브라우저 내장 Kanana를 사용 중입니다. Ollama가 감지되지 않았습니다.';
      }
      return '현재 상태를 확인하는 중입니다...';
    }

    // "2단계" 영역 안에 실제 선택 버튼들을 그린다. 예전엔 호버해야만 보이는
    // 말풍선 툴팁이었는데, 화면 중앙 모달로 바뀌어 공간이 넉넉해진 만큼
    // 설명을 버튼 안에 항상 보이는 문단으로 넣었다.
    function renderEngineOptionButtons(container) {
      container.innerHTML = '';
      var models = listOllamaModels();
      var selectedId = getSelectedModelId();

      models.forEach(function (model) {
        var installed = isModelInstalled(model.id);

        var optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'engine-option';
        optBtn.dataset.modelId = model.id;
        if (model.id === selectedId) optBtn.classList.add('is-selected');

        var row = document.createElement('div');
        row.className = 'engine-option-row';
        var labelSpan = document.createElement('span');
        labelSpan.className = 'engine-option-label';
        labelSpan.textContent = model.label;
        row.appendChild(labelSpan);
        if (installed) {
          var installedSpan = document.createElement('span');
          installedSpan.className = 'engine-option-installed';
          installedSpan.textContent = '설치됨';
          row.appendChild(installedSpan);
        }
        optBtn.appendChild(row);

        var descP = document.createElement('p');
        descP.className = 'engine-option-desc';
        descP.textContent = buildEngineDescription(model, installed);
        optBtn.appendChild(descP);

        optBtn.addEventListener('click', function () {
          handleEngineOptionClick(model, installed);
        });

        container.appendChild(optBtn);
      });
    }

    // 모달 본문 전체를 그린다 — "현재 상태" + "1단계"(Kanana 안내, 항상
    // 동일) + "2단계"(Ollama 소개 + 실제 선택 버튼, 또는 미설치 시 설치
    // 안내만). 예전엔 "설치 안내"와 "모델 선택"을 서로 다른 화면으로
    // 나눠 보여줬는데, 사용자가 원래 있던 "현재 상태·1단계·2단계" 구조를
    // 그대로 유지하면서 그 2단계 안에 선택 버튼을 넣어 달라고 요청해
    // 하나로 합쳤다. 터미널 명령어 안내는 뺐다(자동 다운로드로 대체됨).
    function renderPopoverContent() {
      var state = getOllamaConnectionState();

      engineOptionPopover.innerHTML =
        '<p class="ai-engine-current">' + statusLine(state) + '</p>' +
        '<div class="ai-engine-tier">' +
          '<h4>1단계 · 지금 바로 사용 (설치 불필요)</h4>' +
          '<p>브라우저 안에서 바로 실행되는 경량 모델(Kanana)이 자동으로 준비됩니다. 아무것도 설치할 필요 없이 "AI 분석" 버튼만 누르면 됩니다. 다만 브라우저 안에서 도는 만큼 속도는 상대적으로 느릴 수 있습니다.</p>' +
        '</div>' +
        '<div class="ai-engine-tier" id="engine-tier-2">' +
          '<h4>2단계 · 더 빠르게, 원하는 방식으로</h4>' +
          (state === 'connected'
            ? '<p>Ollama가 연결되어 있습니다. 아래에서 원하는 방식을 선택하세요 — 아직 받지 않은 모델은 선택 시 자동으로 다운로드됩니다.</p>'
            : '<p>범용 로컬 AI 실행 프로그램인 <b>Ollama</b>를 설치하면, 이후 이 페이지가 자동으로 감지해 아래에서 원하는 방식을 선택해 쓸 수 있습니다.</p>' +
              '<p><a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com에서 Ollama 설치 프로그램을 내려받아 실행</a>(운영체제 설치 절차라 이 페이지가 대신 할 수 없는 유일한 단계입니다). 설치가 끝나면 이 페이지로 돌아와 새로고침 후 이 버튼을 다시 눌러주세요 — 터미널에 따로 입력할 것 없이, 원하는 모델을 클릭하면 자동으로 내려받습니다.</p>') +
        '</div>' +
        '<p class="ai-engine-note">소견 내용은 이 경우에도 사용자 PC의 localhost로만 전송되며, 외부 서버로 나가지 않습니다.</p>';

      if (state === 'connected') {
        var tier2 = document.getElementById('engine-tier-2');
        var list = document.createElement('div');
        list.className = 'engine-option-popover';
        tier2.appendChild(list);
        renderEngineOptionButtons(list);
      } else {
        // 사용자가 방금 Ollama를 설치·실행했을 수 있으니, 열려 있는 동안
        // 한 번 더 확인해서 내용을 최신화한다 — 연결되면 2단계에 선택
        // 버튼이 자동으로 나타난다.
        detectOllama(true).then(function () {
          updateEngineSelectButtonState();
          if (!engineSelectOverlay.hidden) renderPopoverContent();
        });
      }
    }

    function handleEngineOptionClick(model, installed) {
      closeEnginePopover();

      if (installed) {
        setSelectedModelId(model.id);
        updateEngineSelectButtonState();
        updateEngineDisplay();
        renderOllamaFailure();
        return;
      }

      if (!downloadConfirmOverlay || !downloadConfirmText) return;
      pendingDownloadModelId = model.id;
      var sizeText = typeof model.approxSizeGB === 'number'
        ? ('약 ' + model.approxSizeGB + 'GB입니다.')
        : '정확한 용량은 확인되지 않았습니다. 다운로드에 시간이 걸릴 수 있습니다.';
      downloadConfirmText.textContent = '"' + model.label + '" 모델은 아직 설치되어 있지 않습니다. ' + sizeText + ' 다운로드하시겠습니까?';
      if (downloadConfirmOk) downloadConfirmOk.disabled = false;
      downloadConfirmOverlay.hidden = false;
    }

    engineSelectBtn.addEventListener('click', function () {
      renderPopoverContent();
      engineSelectOverlay.hidden = false;
    });

    if (engineSelectClose) {
      engineSelectClose.addEventListener('click', closeEnginePopover);
    }
    engineSelectOverlay.addEventListener('click', function (e) {
      if (e.target === engineSelectOverlay) closeEnginePopover();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !engineSelectOverlay.hidden) closeEnginePopover();
    });

    if (downloadConfirmCancel && downloadConfirmOverlay) {
      downloadConfirmCancel.addEventListener('click', function () {
        pendingDownloadModelId = null;
        downloadConfirmOverlay.hidden = true;
      });
      downloadConfirmOverlay.addEventListener('click', function (e) {
        if (e.target === downloadConfirmOverlay && downloadConfirmOk && !downloadConfirmOk.disabled) {
          pendingDownloadModelId = null;
          downloadConfirmOverlay.hidden = true;
        }
      });
    }

    if (downloadConfirmOk) {
      downloadConfirmOk.addEventListener('click', async function () {
        if (!pendingDownloadModelId) return;
        var modelId = pendingDownloadModelId;
        downloadConfirmOk.disabled = true;
        if (downloadConfirmCancel) downloadConfirmCancel.disabled = true;
        downloadConfirmText.textContent = '다운로드를 시작합니다...';

        try {
          await pullOllamaModel(modelId, function (evt) {
            if (!evt) return;
            var progressText = evt.status || '다운로드 중...';
            if (evt.total && evt.completed) {
              progressText += ' (' + formatBytes(evt.completed) + ' / ' + formatBytes(evt.total) + ')';
            }
            downloadConfirmText.textContent = progressText;
          });

          setSelectedModelId(modelId);
          pendingDownloadModelId = null;
          downloadConfirmOverlay.hidden = true;
          updateEngineSelectButtonState();
          updateEngineDisplay();
          renderOllamaFailure();
        } catch (err) {
          var lastErr = getLastPullError();
          downloadConfirmText.textContent =
            '다운로드에 실패했습니다: ' + (lastErr && lastErr.message ? lastErr.message : (err && err.message) || String(err));
          renderOllamaFailure();
        } finally {
          downloadConfirmOk.disabled = false;
          if (downloadConfirmCancel) downloadConfirmCancel.disabled = false;
        }
      });
    }

    // §4.0 (계획 리뷰 반영): 페이지 진입과 동시에 백그라운드로 감지를 시작한다.
    // await로 감싸지 않아 나머지 초기화(아래 이어지는 버튼 바인딩들)를
    // 막지 않고, 감지가 끝나기 전에는 버튼을 "확인 중" 상태로 잠정 표시한다
    // (00-overview.md §5 위험#10 — 다수의 Ollama 미사용자가 페이지 진입마다
    // 최대 15초 대기하는 것을 방지).
    updateEngineSelectButtonState();
    detectOllama().then(function () {
      updateEngineSelectButtonState();
      renderOllamaFailure();
    });
  }

  // ---------- 채팅 대화 상태 모델 (TICKET-3 §2) ----------
  // conversation: [{ role: 'user'|'assistant', text: string, hasFollowUp: boolean }]
  // hasFollowUp: 그 assistant 턴이 후속질문을 포함했는지 — 렌더링 시 표시용.
  //              종료 판정 자체는 TICKET-1이 확정한 방식(옵션 1, 프롬프트 내재화)을
  //              그대로 따른다: splitFollowUpSection().followUpQuestionsText === null
  //              이면 그 턴에서 자연 종료됐다고 본다.
  var conversation = [];
  var isConversationFinalized = false; // "충분함" 버튼 또는 AI 자체 판단으로 종료된 상태
  var STORAGE_KEY = 'houtoti-chat-conversation-v1';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderConversation() {
    if (conversation.length === 0) {
      chatMessagesEl.innerHTML = '';
      if (chatEmptyHintEl) chatMessagesEl.appendChild(chatEmptyHintEl);
      return;
    }
    chatMessagesEl.innerHTML = conversation.map(function (turn) {
      var cls = 'chat-message ' + turn.role;
      if (turn.role === 'assistant' && !turn.hasFollowUp) cls += ' final-diagnosis';
      return '<div class="' + cls + '">' + escapeHtml(turn.text) + '</div>';
    }).join('');
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // 대화창 옆 "유력한 진단" 패널 — 가장 최근 assistant 턴에서
  // extractFinalCandidates()로 최종 후보 섹션만 뽑아 보여준다. 모델이 형식을
  // 안 지켜 특정 턴에 마커가 없으면(null) 그 턴은 건너뛰고 그 이전 턴에서
  // 마지막으로 뽑혔던 내용을 그대로 유지한다 — 패널이 느닷없이 빈 값으로
  // 덮어써지지 않게 하기 위함.
  function renderFinalCandidatesPanel() {
    if (!finalResultTextEl) return;
    var text = null;
    for (var i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role !== 'assistant') continue;
      text = extractFinalCandidates(conversation[i].text);
      if (text) break;
    }
    if (text) {
      finalResultTextEl.textContent = text;
      finalResultTextEl.hidden = false;
      if (finalResultEmptyHintEl) finalResultEmptyHintEl.hidden = true;
    } else {
      finalResultTextEl.hidden = true;
      if (finalResultEmptyHintEl) finalResultEmptyHintEl.hidden = false;
    }
  }

  // ---------- sessionStorage 저장·복원 (TICKET-3 §5) ----------
  function saveConversationToStorage() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conversation: conversation, finalized: isConversationFinalized }));
    } catch (e) {
      /* 용량 초과 등 — 00-overview.md §4.5, 이번 범위에서 심각하게 다루지 않음.
         조용히 무시(대화 자체는 메모리에서 계속 이어지되, 새로고침 시 유실될 뿐 앱이 죽지 않음). */
    }
  }

  function restoreConversationFromStorage() {
    var raw;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;

    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.conversation)) return false;
      var valid = parsed.conversation.every(function (t) {
        return t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string';
      });
      if (!valid) return false;
      conversation = parsed.conversation;
      isConversationFinalized = !!parsed.finalized;
      return true;
    } catch (e) {
      return false; // JSON.parse 실패 — 조용히 [빈 대화 상태]로 (requirements.md §4 권고 그대로 구현)
    }
  }

  // ---------- 채팅 전송 이벤트 루프 (TICKET-3 §4) ----------
  async function sendTurn(userText, forceConclusion) {
    if (!forceConclusion) {
      conversation.push({ role: 'user', text: userText });
      renderConversation();
    }
    saveConversationToStorage();

    chatSendBtn.disabled = true;
    chatSendBtn.classList.add('loading');
    chatSufficientBtn.disabled = true;
    statusEl.hidden = true;

    var sawRealDownload = false;
    var downloadStartedAt = 0;

    try {
      var answer = await analyzeWithAI(conversation, function (loaded, total) {
        // 기존 다운로드 진행률 표시 로직(구 :454-476)을 그대로 재사용.
        if (isModelReady() || !total) return;
        if (loaded >= total) {
          if (sawRealDownload) {
            statusEl.hidden = false;
            statusEl.textContent = '다운로드 완료 — 모델을 준비하고 분석 중입니다 (수 분 걸릴 수 있습니다)...';
          }
          return;
        }
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
      }, forceConclusion);

      var split = splitFollowUpSection(answer);
      var hasFollowUp = !!split.followUpQuestionsText;
      // 후속질문이 있으면 본문+질문을 하나의 말풍선(통짜 텍스트)으로 합쳐 보여준다
      // (structure.md §2.3 "통짜 텍스트" 확정 사항).
      var displayText = hasFollowUp
        ? split.mainText + '\n\n[추가로 확인하고 싶은 사항]\n' + split.followUpQuestionsText
        : split.mainText;

      conversation.push({ role: 'assistant', text: displayText, hasFollowUp: hasFollowUp });
      // isConversationFinalized는 "최종 진단에 도달했다"는 표시일 뿐, 더 이상
      // 대화를 못 하게 막는 잠금 장치가 아니다(버그 수정 — 아래 설명 참고).
      // TICKET-1의 종료 감지(옵션 1, 프롬프트 내재화)는 "AI 응답에 후속질문
      // 마커가 없으면 종료"로 판단하는데, 형식을 안 지키는 응답(특히 작은
      // 로컬 모델이거나 "안녕"처럼 임상 정보가 없는 입력)에서도 마커가
      // 누락될 수 있다. 이 경우 입력창까지 잠가버리면 상담자가 대화를 이어갈
      // 방법이 "대화 초기화"밖에 없어져, "AI 대화창처럼 계속 대화되게"라는
      // 원 요구사항과 어긋난다. 그래서 이 플래그는 최종 진단 말풍선 표시
      // 용도로만 쓰고, 입력 가능 여부와는 분리한다.
      if (!hasFollowUp) isConversationFinalized = true;
      statusEl.hidden = true;
      renderConversation();
      renderFinalCandidatesPanel();
      saveConversationToStorage();
      updateEngineDisplay();
      updateChatInputAvailability();
      playDing();
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent = '이번 턴에서 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
      // structure.md §2.1 "오류 상태" 요건 — 실패한 이 턴만 재시도 가능해야 하므로
      // 방금 push한 user 턴은 conversation에 유지한 채 재시도 버튼/재전송을 허용한다.
    } finally {
      chatSendBtn.disabled = chatInputEl.value.trim() === '';
      chatSendBtn.classList.remove('loading');
      chatSufficientBtn.disabled = false;
    }
  }

  function updateChatInputAvailability() {
    // 대화 종료 여부와 무관하게 입력은 항상 가능하다 — 위 sendTurn() 주석 참고.
    chatSendBtn.disabled = chatInputEl.value.trim() === '';
  }

  chatSendBtn.addEventListener('click', function () {
    var text = chatInputEl.value.trim();
    if (!text) return;
    chatInputEl.value = '';
    sendTurn(text, false);
  });

  chatInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatSendBtn.click();
    }
  });

  chatInputEl.addEventListener('input', updateChatInputAvailability);

  if (chatSufficientBtn) {
    chatSufficientBtn.addEventListener('click', function () {
      if (conversation.length === 0) return;
      sendTurn(null, true); // forceConclusion — 사용자 발화 추가 없이 즉시 최종 결론 요청
    });
  }

  // ---------- window.__hututiChat 브릿지 (TICKET-3 §7, 00-overview.md §4.2) ----------
  // js/main.js(비-module)가 대화 배열을 읽을 수 있도록 스냅샷 접근자를 노출한다
  // (window.__hututiEngine과 동일한 패턴, 이름 충돌 없이 독립적으로 공존).
  if (typeof window !== 'undefined') {
    window.__hututiChat = {
      getConversation: function () { return conversation.slice(); },
      isFinalized: function () { return isConversationFinalized; },
      resetConversation: function () {
        conversation = [];
        isConversationFinalized = false;
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
        renderConversation();
        renderFinalCandidatesPanel();
        updateChatInputAvailability();
      },
    };
  }

  if (copyFinalResultBtn && finalResultTextEl) {
    copyFinalResultBtn.addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(finalResultTextEl.textContent).then(function () {
        var original = copyFinalResultBtn.textContent;
        copyFinalResultBtn.textContent = '복사됨';
        copyFinalResultBtn.classList.add('copied');
        setTimeout(function () {
          copyFinalResultBtn.textContent = original;
          copyFinalResultBtn.classList.remove('copied');
        }, 1500);
      }).catch(function () {
        /* 클립보드 접근 실패는 무시 */
      });
    });
  }

  // ---------- 초기화 (TICKET-3 §6) ----------
  restoreConversationFromStorage();
  renderConversation();
  renderFinalCandidatesPanel();
  updateChatInputAvailability();
  updateEngineDisplay();
});

// ---------- 버튼 행(.notes-actions) 한 줄 자동 맞춤 ----------
// 폰트(Pretendard/SUIT)는 CDN에서 비동기로 로드되고, 실제 글자 너비는
// OS·브라우저·확대 배율마다 달라 CSS 값만으로 "몇 px이면 한 줄에 들어간다"를
// 미리 계산해 고정할 수 없다. 그래서 실제 렌더링된 너비를 이 브라우저에서
// 직접 재보고, 넘치면 넘치지 않을 때까지 글자 크기를 조금씩 줄인다.
(function () {
  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  function fitNotesActionsRow() {
    var row = document.querySelector('.chat-actions'); // 기존 '.notes-actions' → TICKET-2가 바꾼 클래스명
    if (!row) return;

    var maxFont = 12; // .btn-compact 기본값과 동일한 상한
    var minFont = 9; // 이 밑으로는 가독성이 떨어져 더 줄이지 않음(스크롤로 대체)
    var step = 0.5;

    function apply(font) {
      row.style.setProperty('--notes-actions-font', font + 'px');
      var padV = Math.max(4, Math.round(font * 0.55));
      var padH = Math.max(4, Math.round(font * 0.64));
      row.style.setProperty('--notes-actions-pad', padV + 'px ' + padH + 'px');
    }

    apply(maxFont);
    var font = maxFont;
    // 한 프레임 뒤(레이아웃 반영 후) 실제 스크롤 너비를 재서 넘치는 동안 축소.
    requestAnimationFrame(function () {
      var guard = 0; // 무한루프 방지
      while (row.scrollWidth > row.clientWidth + 1 && font > minFont && guard < 20) {
        font -= step;
        apply(font);
        guard++;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    fitNotesActionsRow();
    window.addEventListener('resize', debounce(fitNotesActionsRow, 150));
    if (document.fonts && document.fonts.ready) {
      // 웹폰트가 늦게 로드되면 글자 너비가 바뀌어 다시 맞춰야 할 수 있다.
      document.fonts.ready.then(fitNotesActionsRow).catch(function () {});
    }
  });
})();
