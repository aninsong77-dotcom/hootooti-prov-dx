/* ==========================================================================
   context-budget.js — 카나나(브라우저 wllama) 문맥 예산 관리
   N_CTX(4096)는 입력+출력 합산 예산이라, 사전(진단 기준)+누적 대화가 예산을
   넘으면 요청이 (ABORT)로 죽거나 답변이 잘린다. 이 모듈은 그 예산을
   프롬프트 조립 시점에 근사 계산해 (1) 한도 근접을 알리고 (2) 넘치면
   가장 오래된 턴부터 단순 탈락시킨다.

   설계 결정(docsPlan/ai-token-speed-accuracy/DECISION.md §1-A):
   - 요약 압축은 하지 않는다 — 임상 추론 루프 재설계(별도 트랙)에서 히스토리
     누적 문제 자체가 사라질 예정이라, 여기는 "당장 크래시만 막는" 최소 구현.
   - 토큰 수는 글자수 근사로 과대추정한다 — 정확한 토크나이저 없이도 안전
     여유가 남는 방향으로만 틀리게.
   순수 계산만 있고 DOM·네트워크 의존이 없어 node로 단독 테스트 가능하다.
   ========================================================================== */

// 한글 음절·자모 범위. 한국어 특화 토크나이저(카나나)도 1토큰당 1~2자
// 수준이므로 보수적으로 1.5자/토큰, 그 외 문자(영문·숫자·공백·기호)는
// 3.5자/토큰으로 근사한다.
function isHangulCode(c) {
  return (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f);
}

export function estimateTokens(text) {
  const s = String(text || '');
  let hangul = 0;
  for (let i = 0; i < s.length; i++) {
    if (isHangulCode(s.charCodeAt(i))) hangul++;
  }
  const other = s.length - hangul;
  return Math.ceil(hangul / 1.5 + other / 3.5);
}

// 챗 템플릿이 메시지마다 붙이는 특수 토큰(role 태그 등) 몫.
const PER_MESSAGE_OVERHEAD = 8;

// conversation은 ai.js의 대화 배열({ role, text }) 형태를 그대로 받는다.
export function estimateBudgetUse(systemPrompt, conversation) {
  let total = estimateTokens(systemPrompt) + PER_MESSAGE_OVERHEAD;
  (conversation || []).forEach((t) => { total += estimateTokens(t.text) + PER_MESSAGE_OVERHEAD; });
  return total;
}

// 대화가 진행될수록(사용자 턴이 쌓일수록) 후보는 좁아지므로, 기준 전문을
// 통째로 싣는 진단 수를 턴마다 1개씩 줄여 문맥을 회수한다. 최소 3개 유지 —
// 공존진단 대비 복수 후보를 끝까지 유지해야 하기 때문(DECISION.md §1-C).
export function pickFullDetailCount(userTurnCount, maxCount) {
  const reduced = maxCount - Math.max(0, userTurnCount - 1);
  return Math.max(3, Math.min(maxCount, reduced));
}

/* 대화를 예산(maxCtx - reservedOutput)에 맞춘다.
   반환 status:
   - 'ok'      여유 있음
   - 'near'    들어가긴 하지만 예산의 warnRatio(기본 80%)를 넘음 — 경고용
   - 'trimmed' 가장 오래된 턴부터 droppedCount개 탈락시켜 맞춤
   최근 턴은 최소 keepMinTurns(기본 2)개를 항상 보존한다 — 최소 구성으로도
   넘치면 'trimmed'인 채 그대로 반환한다(호출부는 지금처럼 시도하고, 실패
   시 기존 예외 경로를 탄다). 탈락 후 대화가 assistant 턴으로 시작하면
   챗 템플릿 혼란을 피하기 위해 그 턴도 함께 탈락시킨다. */
export function fitConversationToBudget(opts) {
  const source = (opts.conversation || []).slice();
  const budget = opts.maxCtx - opts.reservedOutput;
  const warnRatio = opts.warnRatio || 0.8;
  const keepMinTurns = opts.keepMinTurns || 2;

  const kept = source.slice();
  let dropped = 0;
  while (kept.length > keepMinTurns && estimateBudgetUse(opts.systemPrompt, kept) > budget) {
    kept.shift();
    dropped++;
    while (kept.length > keepMinTurns && kept[0] && kept[0].role === 'assistant') {
      kept.shift();
      dropped++;
    }
  }

  const estimatedTokens = estimateBudgetUse(opts.systemPrompt, kept);
  let status = 'ok';
  if (dropped > 0) status = 'trimmed';
  else if (estimatedTokens > budget * warnRatio) status = 'near';

  return {
    conversation: kept,
    droppedCount: dropped,
    estimatedTokens: estimatedTokens,
    budget: budget,
    status: status,
  };
}
