import {
  analyzeWithAISequential, beginSequentialTurn, stepSequentialTurn,
  isModelReady, currentEngine, splitFollowUpSection, detectOllama,
  listOllamaModels, getSelectedModelId, setSelectedModelId, getOllamaConnectionState,
  isModelInstalled, pullOllamaModel, getLastPullError, getLastOllamaError,
  extractFinalCandidates, getOllamaProcessorInfo, setForceBrowserEngine, getForceBrowserEngine,
  getSectionMarkers, extractNoteSummary,
} from './ai.js?v=27';

// "충분함"(forceConclusion) 턴 전용 — 전체 섹션을 자동으로 연달아 받아오므로
// 사이사이 멈추지 않는다는 뜻에서 "이어서 정리한다"는 문구를 쓴다.
var SECTION_FILLER_TEXT = '다음 내용을 정리해서 보여드리겠습니다...';
// 일반 대화형 턴(방식 A-2, 대화 참고) 전용 — 한 섹션이 끝나면 다음 요청을
// 자동으로 쏘지 않고 사용자가 "다음 내용 보기"를 눌러야 이어진다. 카나나
// (브라우저 WASM)에게 요청을 연달아 몰아치면 GPU 부담으로 크래시가 실측된
// 것을 막고, 그 사이 상담자가 의견을 더할 수 있게 하기 위함(사용자 의도).
var SECTION_PAUSE_TEXT = '다음 순서를 보려면 아래 "다음 내용 보기"를 눌러주세요. 추가로 궁금한 점이나 의견이 있다면 먼저 입력해 주셔도 됩니다.';
// 후속질문이 없거나(FOLLOWUP_NONE_TEXT) 상담자가 "충분함"으로 강제 종결한
// 턴처럼 더 나올 섹션이 없을 때 채팅 마지막에 보여주는 마무리 문구(대화 참고).
var CLOSING_MESSAGE_TEXT = '이제 더 정리할 내용이 없습니다. 추가로 확인하고 싶은 점이나 의견이 있으시면 말씀해 주세요.';

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
  var chatContinueBtn = document.getElementById('chat-continue-btn');
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
  var ollamaCpuBanner = document.getElementById('ollama-cpu-banner');
  var ollamaCpuSwitchBtn = document.getElementById('ollama-cpu-switch-btn');
  var ollamaCpuDismissBtn = document.getElementById('ollama-cpu-dismiss-btn');
  var engineBadgeBtn = document.getElementById('ai-mode-badge');
  var engineBadgeDropdown = document.getElementById('engine-badge-dropdown');
  var engineLockToast = document.getElementById('engine-lock-toast');
  if (!chatSendBtn || !chatInputEl || !chatMessagesEl) return;

  // 답변을 생성하는 도중(currentAbortController가 있는 동안) 또는 한 턴이
  // 잠시 멈춰 사용자의 "다음 내용 보기" 클릭을 기다리는 동안(pendingTurnSequence가
  // 있는 동안)엔 AI 전환 자체를 막는다 — 예전엔 조용히 무시(다음 턴부터만
  // 반영)했는데, 그건 "눌렀는데 왜 안 바뀌지" 하고 혼란스러울 수 있어 명확히
  // 안내하기로 했다(대화 참고). currentAbortController·pendingTurnSequence는
  // 아래(§연결)에서 선언되지만 var 호이스팅으로 이 함수들이 실제 클릭
  // 시점(항상 선언 이후)에 실행되므로 문제없다.
  var engineLockToastTimer = null;
  function isTurnInProgress() {
    return !!currentAbortController || !!pendingTurnSequence;
  }
  function showEngineLockToast() {
    if (!engineLockToast) return;
    engineLockToast.hidden = false;
    clearTimeout(engineLockToastTimer);
    engineLockToastTimer = setTimeout(function () {
      engineLockToast.hidden = true;
    }, 2600);
  }

  // Ollama가 CPU로만 도는 걸 확인해도 매 턴마다 배너를 다시 띄우면 성가시므로,
  // 이번 세션에서 이미 한 번 보여줬으면(전환했든 "그대로 사용"을 눌렀든)
  // 다시 띄우지 않는다. 새로고침하면 다시 판단한다.
  var cpuBannerDecided = false;

  if (ollamaCpuSwitchBtn && ollamaCpuDismissBtn && ollamaCpuBanner) {
    ollamaCpuSwitchBtn.addEventListener('click', function () {
      if (isTurnInProgress()) { showEngineLockToast(); return; }
      setForceBrowserEngine(true);
      cpuBannerDecided = true;
      ollamaCpuBanner.hidden = true;
      updateEngineDisplay();
    });
    ollamaCpuDismissBtn.addEventListener('click', function () {
      cpuBannerDecided = true;
      ollamaCpuBanner.hidden = true;
    });
  }

  // 채팅 입력창의 전송 가능 여부 갱신(구 updateAnalyzeBtnEnabled() 대체) —
  // §4 sendTurn()/전송 트리거와 함께 동작해야 하므로 별도 함수로 아래
  // updateChatInputAvailability()에 통합한다(TICKET-3 §1).

  // Ollama 실패 안내 배너 — "왜 지금 Ollama가 아니라 Kanana로 동작하는지"에만
  // 집중한다("어떻게 설치하는지"는 "AI 선택" 팝오버의 설치 안내가 담당,
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
      ollamaFailureMessage.textContent = '선택한 모델이 아직 설치되어 있지 않아 브라우저 내 Kanana로 대신 동작합니다. "AI 선택" 버튼에서 다운로드해 주세요.';
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

  // "AI 선택" 버튼 — 클릭 한 번으로 모든 엔진 관련 안내·조작이 열리는
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

    // 버튼 라벨은 이제 "AI 선택"으로 고정이다(엔진 상태 요약은 팝오버
    // 안에서 보여준다). 페이지 로드 직후(§4.0 최초 감지 완료 전)에도, 이후
    // 감지 결과가 갱신될 때도 이 함수 하나로 버튼의 시각적 상태만 맞춘다 —
    // 더 이상 비활성화(aria-disabled)하지 않는다, Ollama 미감지 상태에서도
    // 이 버튼이 설치 안내를 여는 유일한 진입점이기 때문이다.
    function updateEngineSelectButtonState() {
      var state = getOllamaConnectionState(); // null(확인 전) | 'connected' | 'unreachable'
      engineSelectBtn.classList.remove('is-checking', 'is-unavailable');
      engineSelectBtn.setAttribute('aria-disabled', 'false');
      engineSelectLabel.textContent = 'AI 선택';

      if (state === 'unreachable') {
        engineSelectBtn.classList.add('is-unavailable');
      } else if (state !== 'connected') {
        // 아직 감지 중(최대 15초)
        engineSelectBtn.classList.add('is-checking');
      }
    }

    function statusLine(state) {
      // forceBrowserEngine이 켜져 있으면 Ollama 연결 상태와 무관하게 항상
      // 브라우저 내장을 쓰는 중이므로, 그 사실을 최우선으로 보여준다(연결
      // 상태 문구와 섞이면 "Ollama가 감지됐는데 왜 카나나?"로 오해할 수 있음).
      if (getForceBrowserEngine()) {
        return '현재 상태: 브라우저 내장 Kanana를 사용 중입니다 (직접 선택해 Ollama 대신 사용 중).';
      }
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

      // forceBrowserEngine 토글 버튼 — 예전엔 "Ollama가 CPU라 느립니다" 배너
      // 안에서만 카나나로 전환할 수 있었는데, 그 배너는 세션당 한 번만
      // 뜨고 새로고침되면 선택도 초기화돼 "다시 바꾸고 싶은데 버튼이 안
      // 보인다"는 문제가 실측됐다(대화 참고). 여기 1단계 안에 상시 눌러볼
      // 수 있는 버튼을 둬서, Ollama 연결 상태나 배너 노출 여부와 무관하게
      // 언제든 직접 전환·복귀할 수 있게 한다.
      var forcedBrowser = getForceBrowserEngine();
      var tier1ToggleHtml = forcedBrowser
        ? '<p class="ai-engine-forced-note">지금 이 카나나를 직접 선택해 사용 중입니다(Ollama가 감지돼도 쓰지 않음).</p>' +
          '<button class="btn btn-compact" id="force-browser-toggle-btn" type="button">Ollama 자동 감지로 되돌리기</button>'
        : '<button class="btn btn-compact" id="force-browser-toggle-btn" type="button">지금 카나나로 전환</button>';

      engineOptionPopover.innerHTML =
        '<p class="ai-engine-current">' + statusLine(state) + '</p>' +
        '<div class="ai-engine-tier">' +
          '<h4>1단계 · 지금 바로 사용 (설치 불필요)</h4>' +
          '<p>브라우저 안에서 바로 실행되는 경량 모델(Kanana)이 자동으로 준비됩니다. 아무것도 설치할 필요 없이 "AI 분석" 버튼만 누르면 됩니다. 다만 브라우저 안에서 도는 만큼 속도는 상대적으로 느릴 수 있습니다.</p>' +
          tier1ToggleHtml +
        '</div>' +
        '<div class="ai-engine-tier" id="engine-tier-2">' +
          '<h4>2단계 · 더 빠르게, 원하는 방식으로</h4>' +
          (state === 'connected'
            ? '<p>Ollama가 연결되어 있습니다. 아래에서 원하는 방식을 선택하세요 — 아직 받지 않은 모델은 선택 시 자동으로 다운로드됩니다.</p>'
            : '<p>범용 로컬 AI 실행 프로그램인 <b>Ollama</b>를 설치하면, 이후 이 페이지가 자동으로 감지해 아래에서 원하는 방식을 선택해 쓸 수 있습니다.</p>' +
              '<p><a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com에서 Ollama 설치 프로그램을 내려받아 실행</a>(운영체제 설치 절차라 이 페이지가 대신 할 수 없는 유일한 단계입니다). 설치가 끝나면 이 페이지로 돌아와 새로고침 후 이 버튼을 다시 눌러주세요 — 터미널에 따로 입력할 것 없이, 원하는 모델을 클릭하면 자동으로 내려받습니다.</p>') +
        '</div>' +
        '<p class="ai-engine-note">소견 내용은 이 경우에도 사용자 PC의 localhost로만 전송되며, 외부 서버로 나가지 않습니다.</p>';

      var forceBrowserToggleBtn = document.getElementById('force-browser-toggle-btn');
      if (forceBrowserToggleBtn) {
        forceBrowserToggleBtn.addEventListener('click', function () {
          if (isTurnInProgress()) { showEngineLockToast(); return; }
          setForceBrowserEngine(!forcedBrowser);
          cpuBannerDecided = true; // 방금 직접 선택했으니 CPU 배너가 또 끼어들 필요 없음
          if (ollamaCpuBanner) ollamaCpuBanner.hidden = true;
          updateEngineDisplay();
          renderPopoverContent();
        });
      }

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
        if (isTurnInProgress()) { showEngineLockToast(); return; }
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
      // 최초 진입 시 이 콜백이 #ai-mode-badge(updateEngineDisplay())를 갱신하지
      // 않아, Ollama가 실제로 감지돼도 첫 채팅 응답 전까지는 배지가 계속
      // "브라우저 내 로컬 AI(Kanana)"로 남아 있던 버그를 수정 — 감지가
      // 끝나는 즉시 배지도 함께 최신 상태로 맞춘다.
      updateEngineDisplay();
    });
  }

  // ---------- 우측 상단 엔진 배지 → 빠른 전환 드롭다운 (대화 참고) ----------
  // "AI 선택"(하단, 설치 안내·다운로드 확인까지 포함하는 큰 모달)과 역할을
  // 나눈다 — 이 드롭다운은 이미 설치·사용 가능한 것 중에서 빠르게 고르는
  // 용도로만 쓰고, 아직 설치 안 된 모델을 눌렀을 땐 여기서 새로 다운로드
  // 흐름을 만들지 않고 기존 큰 모달을 그대로 열어 안내한다(로직 중복 방지 —
  // 사용자 승인 반영).
  if (engineBadgeBtn && engineBadgeDropdown) {
    function closeEngineBadgeDropdown() {
      engineBadgeDropdown.hidden = true;
      engineBadgeBtn.setAttribute('aria-expanded', 'false');
    }

    function renderEngineBadgeDropdown() {
      var isOllamaEngine = currentEngine() === 'ollama';
      var selectedId = getSelectedModelId();
      var items = [{
        key: 'browser',
        label: '브라우저 내장 카나나',
        checked: !isOllamaEngine,
        installed: true,
      }];

      listOllamaModels().forEach(function (model) {
        items.push({
          key: model.id,
          label: 'Ollama · ' + (model.thinking ? '생각과정 있음' : '생각과정 없음'),
          checked: isOllamaEngine && selectedId === model.id,
          installed: isModelInstalled(model.id),
        });
      });

      engineBadgeDropdown.innerHTML = items.map(function (item) {
        var cls = 'engine-badge-option' + (item.installed ? '' : ' is-disabled');
        var statusHtml = item.installed ? '' : '<span class="engine-badge-status">설치 필요 →</span>';
        return '<button class="' + cls + '" type="button" data-key="' + item.key + '" data-installed="' + item.installed + '">' +
          '<span class="engine-badge-check" aria-hidden="true">' + (item.checked ? '✓' : '') + '</span>' +
          '<span class="engine-badge-label">' + item.label + '</span>' +
          statusHtml +
          '</button>';
      }).join('');

      Array.prototype.forEach.call(engineBadgeDropdown.querySelectorAll('.engine-badge-option'), function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.dataset.key;
          var installed = btn.dataset.installed === 'true';
          closeEngineBadgeDropdown();

          if (!installed) {
            // 아직 설치 안 된 Ollama 모델 — 다운로드 흐름은 기존 "AI 선택"
            // 큰 모달이 담당하므로 그걸 그대로 연다.
            if (engineSelectBtn) engineSelectBtn.click();
            return;
          }

          if (isTurnInProgress()) { showEngineLockToast(); return; }

          if (key === 'browser') {
            setForceBrowserEngine(true);
          } else {
            setForceBrowserEngine(false);
            setSelectedModelId(key);
          }
          updateEngineDisplay();
          renderOllamaFailure();
        });
      });
    }

    engineBadgeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (engineBadgeDropdown.hidden) {
        renderEngineBadgeDropdown();
        engineBadgeDropdown.hidden = false;
        engineBadgeBtn.setAttribute('aria-expanded', 'true');
      } else {
        closeEngineBadgeDropdown();
      }
    });

    document.addEventListener('click', function (e) {
      if (!engineBadgeDropdown.hidden && !engineBadgeDropdown.contains(e.target) && e.target !== engineBadgeBtn) {
        closeEngineBadgeDropdown();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !engineBadgeDropdown.hidden) closeEngineBadgeDropdown();
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
  // 지금 진행 중인 AI 요청의 취소 컨트롤러 — "대화 초기화"를 눌러도 이미
  // 보낸 요청이 백그라운드에서 계속 돌아 전송 버튼이 로딩 상태로 남아있던
  // 버그(대화 참고)를 고치기 위해 추가. sendTurn() 시작 시 새로 만들어
  // 여기 저장하고, resetConversation()이 있으면 이걸 abort()한다.
  var currentAbortController = null;
  // 일반 대화형 턴(방식 A-2)이 한 섹션을 보여준 뒤 "다음 내용 보기" 클릭을
  // 기다리며 멈춰 있는 상태를 담는다 — { seq, sequencer } | null. seq는
  // ai.js의 beginSequentialTurn()이 반환한, 이 턴 전체에서 고정해 쓰는
  // 엔진·모델·사전 텍스트 컨텍스트다(대화 참고).
  var pendingTurnSequence = null;

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

  // 일시정지 중(다음 내용 보기를 기다리는 동안) 사용자가 의견을 입력해
  // 전송하면, renderConversation()으로 전체를 다시 그리면 안 된다 — 그건
  // conversation 배열(아직 assistant 통짜 텍스트가 안 들어간 상태)만 보고
  // 다시 그려서, 그 사이 화면에 실시간으로 쌓아둔 섹션 말풍선들이 전부
  // 사라져 버린다(실측 확인 — 대화 참고). 대신 사용자 말풍선 하나만
  // 지금 쌓여있는 말풍선 목록 맨 끝에 그대로 추가한다.
  function appendUserBubble(text) {
    var el = document.createElement('div');
    el.className = 'chat-message user';
    el.textContent = text;
    if (chatEmptyHintEl && chatEmptyHintEl.parentNode === chatMessagesEl) chatMessagesEl.removeChild(chatEmptyHintEl);
    chatMessagesEl.appendChild(el);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // 상담자가 입력한 소견(대화 중 모든 user 턴)을 원문 그대로 이어붙인다 —
  // 요약·재구성이 아니라 원문 그대로 모아서, 이 패널만 보고도 어떤 소견을
  // 근거로 나온 결과인지 알 수 있고 상담자가 그대로 복사해 편집해 쓸 수
  // 있게 한다(대화 참고).
  function buildNoteSummaryText() {
    var userTurns = conversation.filter(function (t) { return t.role === 'user' && t.text.trim() !== ''; });
    if (userTurns.length === 0) return null;
    return userTurns.map(function (t) { return t.text.trim(); }).join('\n\n');
  }

  // 대화창 옆 "유력한 진단" 패널 — 맨 위에 내담자 소견, 그 아래 AI 답변을
  // 순서대로 보여준다. 소견은 이제 AI가 정리한 버전(extractNoteSummary(),
  // "정리된 소견" 마커 섹션 — 대화 참고: 상담자가 이미 정리해서 올렸으면
  // 그대로, 대화체로 적었으면 항목별로 다듬어서)을 우선 쓰고, 모델이 형식을
  // 안 지켜 그 섹션이 없는 극히 드문 경우에만 원문 그대로 이어붙이는
  // buildNoteSummaryText()로 폴백한다. AI 답변은 가장 최근 assistant 턴에서
  // extractFinalCandidates()로 최종 후보 섹션(및 그 뒤 이어지는 추가질문)을
  // 뽑아 쓴다. 모델이 형식을 안 지켜 특정 턴에 마커가 없으면(null) 그 턴은
  // 건너뛰고 그 이전 턴에서 마지막으로 뽑혔던 내용을 그대로 유지한다 —
  // 패널이 느닷없이 빈 값으로 덮어써지지 않게 하기 위함.
  function renderFinalCandidatesPanel() {
    if (!finalResultTextEl) return;
    var noteSummary = null;
    var aiText = null;
    for (var i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role !== 'assistant') continue;
      if (noteSummary === null) noteSummary = extractNoteSummary(conversation[i].text);
      if (aiText === null) aiText = extractFinalCandidates(conversation[i].text);
      if (noteSummary && aiText) break;
    }
    if (!noteSummary) noteSummary = buildNoteSummaryText();

    var parts = [];
    if (noteSummary) parts.push('[내담자 소견]\n' + noteSummary);
    if (aiText) parts.push('[AI 분석 결과]\n' + aiText);

    if (parts.length > 0) {
      finalResultTextEl.textContent = parts.join('\n\n----------------------------------------\n\n');
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

  // ---------- 섹션별 개별 요청 결과 표시 (방식 A, 대화 참고) ----------
  // 예전엔 한 번의 스트리밍 응답을 마커 경계로 잘라 보여주는 방식(방식 B)을
  // 썼는데, 그건 "잘리지 않는 것"을 보장하지 못했다(여전히 하나의 응답 안에
  // 6단계를 다 담아야 했음, 실측 확인). 이제 ai.js의 analyzeWithAISequential()가
  // 매 섹션을 진짜 별도 요청으로 짧게 받아오므로, 여기서는 그 결과를 받는
  // 대로(onSectionComplete 콜백) 바로 말풍선 하나씩 그리기만 하면 된다 —
  // 마커 스캐닝이 필요 없어져 훨씬 단순해졌다.
  function createSequentialRenderer(fillerText) {
    var markers = getSectionMarkers();
    var hasFollowUp = false;

    function makeBubble(text, extraClass) {
      var el = document.createElement('div');
      el.className = 'chat-message assistant' + (extraClass ? ' ' + extraClass : '');
      el.textContent = text;
      if (chatEmptyHintEl && chatEmptyHintEl.parentNode === chatMessagesEl) chatMessagesEl.removeChild(chatEmptyHintEl);
      chatMessagesEl.appendChild(el);
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      return el;
    }

    return {
      // sectionKey 하나가 완성될 때마다 analyzeWithAISequential()이 호출.
      onSection: function (sectionKey, content) {
        if (sectionKey === 'noteSummary') {
          return; // 결과 패널 전용(renderFinalCandidatesPanel()) — 채팅엔 안 띄움
        }
        if (sectionKey === 'followUp') {
          var hasReal = content !== '' && content.indexOf(markers.followUpNoneText) === -1;
          if (hasReal) {
            makeBubble(content, '');
            hasFollowUp = true;
          } else {
            makeBubble(CLOSING_MESSAGE_TEXT, 'final-diagnosis');
            hasFollowUp = false;
          }
          return;
        }
        makeBubble(content, '');
        if (sectionKey === 'summary' || sectionKey === 'hypotheses' || sectionKey === 'uncertain') {
          makeBubble(fillerText, 'chat-message-filler');
        }
      },
      // forceConclusion 턴처럼 finalCandidates에서 그대로 끝나(followUp
      // 섹션 자체가 없어) 마무리 문구가 아직 안 붙었을 때 sendForceConclusionTurn()이 호출.
      finishWithoutFollowUp: function () {
        makeBubble(CLOSING_MESSAGE_TEXT, 'final-diagnosis');
        hasFollowUp = false;
      },
      didRenderAnything: function () { return true; },
      getHasFollowUp: function () { return hasFollowUp; },
    };
  }

  // ---------- "충분함" 전용 일괄 요청 (forceConclusion) ----------
  // 상담자가 "충분함 — 진단 결과 보기"를 누르면 더 묻지 않고 지금 바로
  // 결론까지 쭉 받고 싶다는 뜻이므로, 아래 §paced 흐름처럼 사용자 클릭을
  // 기다리지 않고 예전처럼 6단계를 자동으로 연달아 받아온다(analyzeWithAISequential).
  async function sendForceConclusionTurn() {
    // 일반 대화형(paced) 시퀀스가 멈춰 대기 중이었다면 여기서 포기한다 —
    // "충분함"은 지금까지의 전체 대화를 바탕으로 처음부터 다시 결론을
    // 내는 것이라 남은 일시정지 상태와 섞이면 안 된다.
    pendingTurnSequence = null;
    updateContinueButtonVisibility();
    saveConversationToStorage();

    chatSendBtn.disabled = true;
    chatContinueBtn.disabled = true;
    chatSendBtn.classList.add('loading');
    chatSufficientBtn.disabled = true;
    // 응답을 기다리는 동안 아무 표시도 없으면(특히 Ollama 경로는 아래
    // onProgress 콜백이 아예 호출되지 않음) 몇 분씩 걸리는 로컬 모델
    // 응답 중에 "멈췄다"고 오해하기 쉽다. 브라우저 모델 다운로드 진행률
    // 콜백이 오면 아래에서 바로 이 문구를 덮어쓴다.
    statusEl.hidden = false;
    statusEl.textContent = '답변을 생성하는 중입니다. 로컬 AI 모델 속도에 따라 다소 시간이 걸릴 수 있습니다...';

    var sawRealDownload = false;
    var downloadStartedAt = 0;
    var sequencer = createSequentialRenderer(SECTION_FILLER_TEXT);
    var sectionsSeen = 0;
    var abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    currentAbortController = abortController;

    try {
      var answer = await analyzeWithAISequential(conversation, function (loaded, total) {
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
      }, true, function (sectionKey, content) {
        // 섹션 하나가 완성되는 대로(analyzeWithAISequential이 독립 요청을
        // 하나씩 보내며 호출) 즉시 말풍선으로 반영한다(대화 참고).
        sectionsSeen++;
        statusEl.hidden = true;
        sequencer.onSection(sectionKey, content);
      }, abortController ? abortController.signal : undefined);

      // forceConclusion 턴은 followUp 섹션 자체가 없어(sectionOrder가
      // finalCandidates에서 끝남) 위 onSection 콜백만으로는 마무리 문구가
      // 안 붙는다 — 여기서 명시적으로 붙여준다.
      sequencer.finishWithoutFollowUp();

      var split = splitFollowUpSection(answer);
      var hasFollowUp = !!split.followUpQuestionsText;
      // 후속질문이 있으면 본문+질문을 하나의 말풍선(통짜 텍스트)으로 합쳐 보여준다
      // (structure.md §2.3 "통짜 텍스트" 확정 사항). 이 값은 여전히 sessionStorage에
      // 저장되는 대화 기록·저장(결과 저장)·새로고침 복원용 "완성된 한 덩어리"
      // 텍스트로 남는다 — 화면에 실시간으로 보여준 단계별 말풍선은 이 턴 한정
      // 표시 방식일 뿐, 데이터 모델 자체는 예전과 동일하게 유지한다(회귀 최소화).
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
      // 섹션별 요청으로 이미 말풍선을 하나씩 그려뒀으므로 renderConversation()을
      // 다시 부르지 않는다 — 부르면 방금 그린 여러 말풍선이 conversation
      // 배열의 통짜 텍스트 하나로 다시 뭉쳐져 애써 보여준 단계별 진행이
      // 눈앞에서 사라져 버린다. 섹션이 하나도 안 왔다면(극단적 실패 등)만
      // 예전처럼 통짜로 렌더링한다.
      if (sectionsSeen === 0) renderConversation();
      renderFinalCandidatesPanel();
      saveConversationToStorage();
      updateEngineDisplay();
      updateChatInputAvailability();
      playDing();

      // 방금 이 턴이 Ollama로 처리됐다면, 모델이 GPU 없이 CPU로만 돌고
      // 있는지 확인해 느린 이유를 정확히 안내한다(배지에는 "Ollama 사용
      // 중"으로만 보여 CPU 병목을 사용자가 알 방법이 없었음 — 대화 참고).
      // 세션당 한 번만 판단하고, 판단 실패(getOllamaProcessorInfo()가
      // null)면 조용히 넘어간다.
      if (!cpuBannerDecided && ollamaCpuBanner && currentEngine() === 'ollama') {
        getOllamaProcessorInfo().then(function (info) {
          if (cpuBannerDecided || !info || !info.isCpuOnly) return;
          ollamaCpuBanner.hidden = false;
        });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // "대화 초기화"로 사용자가 직접 취소한 경우 — 대화 자체가 이미
        // 비워졌으므로 "오류 발생" 문구를 띄우지 않고 조용히 정리만 한다.
        statusEl.hidden = true;
      } else {
        statusEl.hidden = false;
        statusEl.textContent = '이번 턴에서 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
        // structure.md §2.1 "오류 상태" 요건 — 실패한 이 턴만 재시도 가능해야 하므로
        // 방금 push한 user 턴은 conversation에 유지한 채 재시도 버튼/재전송을 허용한다.
      }
    } finally {
      if (currentAbortController === abortController) currentAbortController = null;
      chatSendBtn.disabled = chatInputEl.value.trim() === '';
      chatSendBtn.classList.remove('loading');
      chatSufficientBtn.disabled = false;
      if (chatContinueBtn) chatContinueBtn.disabled = false;
    }
  }

  function updateContinueButtonVisibility() {
    if (chatContinueBtn) chatContinueBtn.hidden = !pendingTurnSequence;
  }

  // ---------- 일반 대화형 턴 — 사용자 클릭으로 한 단계씩 진행 (방식 A-2) ----------
  // 새 메시지를 보내면 새 시퀀스를 시작하고(beginTurnSequence), 첫 눈에 보이는
  // 섹션(핵심요약)까지만 받아온 뒤 멈춘다. 이후 "다음 내용 보기"를 누르거나
  // 텍스트를 입력해 전송하면 continueTurnSequence()가 다음 섹션 하나만 더
  // 받아온다 — 카나나(브라우저 WASM)에게 요청을 몰아쳐 GPU 크래시가 나던
  // 문제를, 사람이 클릭할 때만 다음 요청이 나가게 해서 근본적으로 없앤다
  // (실측된 "(ABORT)" 크래시 — 대화 참고).
  async function runTurnSequenceLoop(isNewSequence) {
    chatSendBtn.disabled = true;
    chatSendBtn.classList.add('loading');
    chatSufficientBtn.disabled = true;
    if (chatContinueBtn) chatContinueBtn.disabled = true;
    statusEl.hidden = false;
    statusEl.textContent = '답변을 생성하는 중입니다. 로컬 AI 모델 속도에 따라 다소 시간이 걸릴 수 있습니다...';

    var sawRealDownload = false;
    var downloadStartedAt = 0;
    var abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    currentAbortController = abortController;

    function onDownloadProgress(loaded, total) {
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
    }

    try {
      if (isNewSequence) {
        var seq = await beginSequentialTurn(conversation, onDownloadProgress, abortController ? abortController.signal : undefined);
        pendingTurnSequence = { seq: seq, sequencer: createSequentialRenderer(SECTION_PAUSE_TEXT) };
      }
      statusEl.hidden = true;

      var finalRawText = null;
      // noteSummary(숨김 섹션)는 화면에 보여줄 게 없으니 사용자를 기다리게
      // 하지 않고 곧바로 다음 섹션까지 이어서 받아온다 — 눈에 보이는 섹션이
      // 하나라도 나오면(또는 시퀀스가 끝나면) 거기서 멈춘다.
      while (true) {
        var result = await stepSequentialTurn(conversation, pendingTurnSequence.seq, abortController ? abortController.signal : undefined);
        if (result.sectionKey) pendingTurnSequence.sequencer.onSection(result.sectionKey, result.content);
        if (result.isDone) {
          finalRawText = result.fullRawText;
          pendingTurnSequence = null;
          break;
        }
        if (result.sectionKey !== 'noteSummary') break; // 눈에 보이는 섹션 하나 그렸으니 멈춤
      }
      updateContinueButtonVisibility();

      if (finalRawText !== null) {
        var split = splitFollowUpSection(finalRawText);
        var hasFollowUp = !!split.followUpQuestionsText;
        // 후속질문이 있으면 본문+질문을 하나의 말풍선(통짜 텍스트)으로 합쳐 보여준다
        // (structure.md §2.3 "통짜 텍스트" 확정 사항). 이 값은 여전히 sessionStorage에
        // 저장되는 대화 기록·저장(결과 저장)·새로고침 복원용 "완성된 한 덩어리"
        // 텍스트로 남는다 — 화면에 실시간으로 보여준 단계별 말풍선은 이 턴 한정
        // 표시 방식일 뿐, 데이터 모델 자체는 예전과 동일하게 유지한다(회귀 최소화).
        var displayText = hasFollowUp
          ? split.mainText + '\n\n[추가로 확인하고 싶은 사항]\n' + split.followUpQuestionsText
          : split.mainText;

        conversation.push({ role: 'assistant', text: displayText, hasFollowUp: hasFollowUp });
        if (!hasFollowUp) isConversationFinalized = true;
        playDing();

        // 방금 이 턴이 Ollama로 처리됐다면, 모델이 GPU 없이 CPU로만 돌고
        // 있는지 확인해 느린 이유를 정확히 안내한다(위 sendForceConclusionTurn()과 동일 로직).
        if (!cpuBannerDecided && ollamaCpuBanner && currentEngine() === 'ollama') {
          getOllamaProcessorInfo().then(function (info) {
            if (cpuBannerDecided || !info || !info.isCpuOnly) return;
            ollamaCpuBanner.hidden = false;
          });
        }
      }
      renderFinalCandidatesPanel();
      saveConversationToStorage();
      updateEngineDisplay();
    } catch (err) {
      pendingTurnSequence = null;
      updateContinueButtonVisibility();
      if (err && err.name === 'AbortError') {
        statusEl.hidden = true;
      } else {
        statusEl.hidden = false;
        statusEl.textContent = '이번 턴에서 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err));
      }
    } finally {
      if (currentAbortController === abortController) currentAbortController = null;
      chatSendBtn.disabled = chatInputEl.value.trim() === '';
      chatSendBtn.classList.remove('loading');
      chatSufficientBtn.disabled = false;
      if (chatContinueBtn) chatContinueBtn.disabled = false;
    }
  }

  // 새 메시지 전송 — 항상 새 시퀀스를 시작한다.
  function startNewTurnSequence(userText) {
    conversation.push({ role: 'user', text: userText });
    renderConversation();
    saveConversationToStorage();
    return runTurnSequenceLoop(true);
  }

  // "다음 내용 보기" 클릭, 또는 일시정지 중에 사용자가 의견/추가 정보를
  // 입력해 전송한 경우 — optionalUserText가 있으면 먼저 대화에 추가해
  // 다음 섹션 판단에 반영되게 한다(사용자 의도 — "대화가 더 풍성해지길").
  function continueTurnSequence(optionalUserText) {
    if (optionalUserText) {
      conversation.push({ role: 'user', text: optionalUserText });
      appendUserBubble(optionalUserText);
      saveConversationToStorage();
    }
    return runTurnSequenceLoop(false);
  }

  function updateChatInputAvailability() {
    // 대화 종료 여부와 무관하게 입력은 항상 가능하다 — 위 주석 참고.
    chatSendBtn.disabled = chatInputEl.value.trim() === '';
  }

  chatSendBtn.addEventListener('click', function () {
    var text = chatInputEl.value.trim();
    if (!text) return;
    chatInputEl.value = '';
    // 일시정지 중(다음 내용 보기를 기다리는 중)이면 새 턴을 시작하는 게
    // 아니라, 이 입력을 의견/추가 정보로 얹어서 지금 시퀀스를 이어간다
    // (사용자 의도 — "추가 질문이 있어도 하라고 해서 대화가 풍성해지길").
    if (pendingTurnSequence) {
      continueTurnSequence(text);
    } else {
      startNewTurnSequence(text);
    }
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
      sendForceConclusionTurn(); // 사용자 발화 추가 없이 즉시 최종 결론 요청(일시정지 상태였다면 포기하고 처음부터 재정리)
    });
  }

  if (chatContinueBtn) {
    chatContinueBtn.addEventListener('click', function () {
      if (!pendingTurnSequence) return;
      continueTurnSequence(null); // 텍스트 추가 없이 다음 섹션만 이어서 요청
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
        // 진행 중인 AI 요청이 있으면 즉시 취소한다 — 안 그러면 대화는
        // 비워졌는데 이미 보낸 요청이 백그라운드에서 계속 돌아 전송
        // 버튼이 로딩 상태로 남아있던 버그가 있었다(대화 참고). runTurnSequenceLoop()의
        // catch(AbortError)·finally가 마무리 처리를 이어받으므로 여기서는
        // 취소 신호만 보내고 버튼 상태는 즉시 시각적으로도 풀어준다(요청이
        // 실제로 정리되기까지의 짧은 지연 동안 사용자가 "아직도 도네" 하고
        // 오해하지 않도록).
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        // 한 섹션까지 보여주고 "다음 내용 보기"를 기다리며 멈춰 있던
        // 상태도 함께 버린다 — 진행 중인 네트워크 요청은 없으므로 abort()
        // 없이 상태만 지우면 된다.
        pendingTurnSequence = null;
        updateContinueButtonVisibility();
        conversation = [];
        isConversationFinalized = false;
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
        renderConversation();
        renderFinalCandidatesPanel();
        updateChatInputAvailability();
        chatSendBtn.classList.remove('loading');
        chatSufficientBtn.disabled = false;
        statusEl.hidden = true;
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
