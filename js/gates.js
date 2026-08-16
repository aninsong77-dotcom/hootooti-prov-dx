/* ==========================================================================
   gates.js — 안내형 문진 위저드의 게이트(1차 선별) 질문 정의

   구조화 임상면담(SCID 등)이 쓰는 "관문 질문" 방식이다. 81개 진단을 처음부터
   전부 훑지 않고, 먼저 23개 게이트 질문으로 범주를 선별한 다음 걸린 범주의
   정밀 체크리스트만 확인한다.
   설계 근거 = docsPlan/guided-intake-wizard/requirements.md §4.2

   ── 이 질문들의 성격 (중요) ──────────────────────────────────────────────
   내담자에게 그대로 읽어주는 문항이 아니다. **상담사가 내담자를 관찰하거나
   보고받은 내용을 바탕으로 스스로 판단해서 답하는 문항**이다.
   따라서 문장은 "…있습니까?"로 끝나지만 묻는 대상은 상담사 자신이다.

   ── 문구의 출처와 한계 ───────────────────────────────────────────────────
   각 게이트는 그 범주에 속한 진단들의 **첫 항목군 대표 항목**(data.js의
   groups[0].items 앞부분)을 공통분모로 묶어 재서술한 것이다. 새로운 임상
   판단을 창작하지 않고 이미 있는 항목에서 도출했으므로, 검증 대상 콘텐츠가
   새로 늘지는 않는다.
   다만 data.js 자체가 "AI가 재서술한, 임상 전문가 미검증" 자료이므로
   (README 참고) 이 게이트 문구도 같은 한계를 그대로 물려받는다.
   → 임상 자문을 확보하면 1순위 검토 대상. requirements.md §8 참고.

   ── "아니오"는 배제가 아니다 ─────────────────────────────────────────────
   게이트에 "아니오"로 답해도 해당 범주를 숨기지 않는다. 후순위로 미룰 뿐이며
   결과 화면에서 언제든 펼쳐볼 수 있다. 실제 임상가도 관문 질문 하나로 진단을
   완전히 배제하지 않는다. "모름"은 "아니오"로 취급하지 않는다.

   ── 순서 ─────────────────────────────────────────────────────────────────
   기본 순서는 DSM-5-TR 챕터 순서(main.js CATEGORY_ORDER와 동일)다.
   소견 입력에서 키워드가 걸리면 그 게이트가 앞으로 당겨진다(정렬만, 배제 ❌).
   ※ "섬망·물질·의학적 원인을 먼저 배제한다" 같은 임상적 관례 순서는 반영하지
     않았다 — 임상 자문이 필요한 사항이라 추측으로 정하지 않았다.

   일반 스크립트(비-module)인 이유는 scoring.js와 같다 — 파일을 직접 열어도
   (file://) 동작해야 하기 때문. requirements.md §4.6
   ========================================================================== */

(function (root) {
  'use strict';

  // diagIds가 null이면 "그 category에 속한 진단 전체"를 뜻한다. data.js에
  // 진단이 추가돼도 자동으로 포함되므로, 범주 하나가 통째로 대응하는
  // 게이트는 목록을 나열하지 않는다. 범주를 쪼갠 게이트만 명시한다.
  var GATES = [

    /* ---------- I. 신경발달장애 — 성격이 크게 다른 4묶음으로 분할 ---------- */
    {
      id: 'g-nd-cognitive',
      label: '지적·학습',
      category: '신경발달장애',
      diagIds: ['nd-id', 'nd-sld'],
      question: '지적 기능(이해·추론·판단)이나 학습 수행(읽기·쓰기·수학)이 또래 수준에 비해 뚜렷하게 낮다는 소견이 있습니까?',
      keywords: ['지능', '아이큐', 'IQ', '학습', '공부', '이해력', '읽기', '난독', '쓰기', '수학', '산수', '발달지연', '느림'],
    },
    {
      id: 'g-nd-social',
      label: '사회적 의사소통·상동행동',
      category: '신경발달장애',
      diagIds: ['nd-asd', 'nd-smd'],
      question: '사회적 의사소통·상호작용의 지속적인 어려움(눈맞춤, 정서 나누기, 또래관계)이나 반복적·상동적 행동·제한된 관심사가 관찰됩니까?',
      keywords: ['자폐', '눈맞춤', '사회성', '또래', '상동', '반복행동', '집착', '감각예민', '변화거부', '혼잣말'],
    },
    {
      // ADHD는 단독 게이트로 둔다. 상담 현장에서 가장 흔한 의뢰 사유인 데다,
      // 부주의·과잉행동은 같은 신경발달장애 안에서도 운동·틱 문제와 성격이
      // 달라 한 질문으로 묶으면 어느 쪽 때문에 "예"인지 알 수 없다.
      id: 'g-nd-adhd',
      label: '주의·과잉행동',
      category: '신경발달장애',
      diagIds: ['nd-adhd'],
      question: '주의를 오래 유지하지 못해 부주의한 실수가 잦거나, 상황에 맞지 않게 가만히 있지 못하고 충동적으로 행동하는 모습이 두드러집니까?',
      keywords: ['산만', '집중', '주의력', 'ADHD', '과잉행동', '충동', '가만히', '실수', '덤벙', '깜빡', '끼어들'],
    },
    {
      id: 'g-nd-motor',
      label: '운동·틱',
      category: '신경발달장애',
      diagIds: ['nd-dcd', 'nd-tourette'],
      question: '또래에 비해 운동이 뚜렷하게 서툴러 일상 활동에 지장이 있거나, 갑작스럽고 반복적인 움직임·소리내기(틱)가 나타납니까?',
      keywords: ['틱', '서투름', '협응', '운동', '느림', '글씨', '자전거', '눈깜빡', '소리냄'],
    },

    /* ---------- II. 조현병 스펙트럼 ---------- */
    {
      id: 'g-psychotic',
      label: '정신병적 증상',
      category: '조현병 스펙트럼 및 기타 정신병적 장애',
      diagIds: null,
      question: '망상(사실과 다른 확고한 믿음), 환각(환청·환시 등), 와해된 언어나 행동 등 정신병적 증상이 있습니까?',
      keywords: ['망상', '환청', '환각', '환시', '피해', '감시', '도청', '와해', '혼잣말', '누가', '조종', '이상한소리'],
    },

    /* ---------- III. 양극성 ---------- */
    {
      id: 'g-bipolar',
      label: '조증·경조증',
      category: '양극성 및 관련 장애',
      diagIds: null,
      question: '평소와 확연히 다르게 들뜨거나 팽창되거나 과민한 기분이 일정 기간(며칠 이상) 지속된 시기가 있었습니까?',
      keywords: ['조증', '들뜸', '기분변화', '과민', '잠안자', '말많', '충동구매', '자신감', '기분기복', '업됨'],
    },

    /* ---------- IV. 우울장애 ---------- */
    {
      id: 'g-depressive',
      label: '우울·흥미상실',
      category: '우울장애',
      diagIds: null,
      question: '우울한 기분 또는 거의 모든 활동에서의 흥미·즐거움 상실이 지속됩니까? (아동·청소년은 만성적 과민성이나 심한 분노발작으로 나타날 수 있습니다.)',
      keywords: ['우울', '무기력', '처짐', '가라앉', '흥미', '재미없', '죽고싶', '자살', '눈물', '슬픔', '의욕', '공허', '자책', '분노발작'],
    },

    /* ---------- V. 불안장애 ---------- */
    {
      id: 'g-anxiety',
      label: '불안·공포·공황',
      category: '불안장애',
      diagIds: null,
      question: '과도한 불안·걱정이 지속되거나, 특정 대상·상황에 대한 공포로 회피가 나타납니까? 또는 갑작스러운 공황발작이 있습니까?',
      keywords: ['불안', '걱정', '공황', '두근', '숨막', '공포', '회피', '긴장', '초조', '발표', '사람들앞', '분리불안', '말안함'],
    },

    /* ---------- VI. 강박 및 관련 ---------- */
    {
      id: 'g-ocd',
      label: '강박·반복행동',
      category: '강박 및 관련 장애',
      diagIds: null,
      question: '원치 않는데 반복해서 떠오르는 생각이나, 그로 인한 반복 행동(확인·씻기)이 있습니까? 또는 물건 모으기, 털뽑기, 피부뜯기, 외모 결함에 대한 집착이 있습니까?',
      keywords: ['강박', '확인', '손씻', '반복', '정리', '대칭', '모으', '저장', '버리지못', '털뽑', '피부뜯', '외모', '거울'],
    },

    /* ---------- VII. 외상 및 스트레스 ---------- */
    {
      id: 'g-trauma',
      label: '외상·스트레스',
      category: '외상 및 스트레스 관련 장애',
      diagIds: null,
      question: '외상 사건(죽음의 위협, 심각한 부상, 성폭력 등)이나 뚜렷한 스트레스 사건 이후에 증상이 시작되었습니까? (아동의 경우 양육자와의 애착 문제도 포함합니다.)',
      keywords: ['외상', '트라우마', 'PTSD', '사고', '폭력', '학대', '성폭력', '플래시백', '악몽', '재경험', '스트레스', '이혼', '사별', '애착'],
    },

    /* ---------- VIII. 해리 ---------- */
    {
      id: 'g-dissociative',
      label: '해리',
      category: '해리장애',
      diagIds: null,
      question: '일상적 망각으로 설명되지 않는 기억의 공백, 정체성의 뚜렷한 변화, 또는 자신이나 주변이 비현실적으로 느껴지는 경험이 있습니까?',
      keywords: ['해리', '기억', '기억상실', '멍', '블랙아웃', '다른사람', '정체성', '비현실', '멀어지', '내가아닌'],
    },

    /* ---------- IX. 신체증상 ---------- */
    {
      id: 'g-somatic',
      label: '신체증상·질병불안',
      category: '신체증상 및 관련 장애',
      diagIds: null,
      question: '의학적으로 충분히 설명되지 않는 신체증상이 지속되거나, 심각한 질병에 걸렸다는 걱정에 과도하게 몰두합니까?',
      keywords: ['통증', '아프', '병원', '검사', '이상없', '건강염려', '질병', '마비', '감각', '어지럼', '소화'],
    },

    /* ---------- X. 급식 및 섭식 ---------- */
    {
      id: 'g-eating',
      label: '섭식',
      category: '급식 및 섭식장애',
      diagIds: null,
      question: '체중·체형에 대한 집착, 폭식이나 보상행동(구토·하제·과도한 운동), 또는 음식 섭취의 뚜렷한 제한·회피가 있습니까?',
      keywords: ['식욕', '폭식', '거식', '구토', '토함', '다이어트', '체중', '살', '먹지않', '편식', '굶'],
    },

    /* ---------- XI. 배설 ---------- */
    {
      id: 'g-elimination',
      label: '배설',
      category: '배설장애',
      diagIds: null,
      question: '연령에 맞지 않는 반복적인 소변·대변 실수(옷이나 침구, 부적절한 장소)가 있습니까?',
      keywords: ['소변', '대변', '오줌', '똥', '실수', '야뇨', '이불', '가리지못'],
    },

    /* ---------- XII. 수면-각성 ---------- */
    {
      id: 'g-sleep',
      label: '수면',
      category: '수면-각성장애',
      diagIds: null,
      question: '잠들거나 수면을 유지하기 어렵습니까? 또는 충분히 자도 과도하게 졸립거나, 수면 중 이상행동(악몽, 움직임, 다리 불편감)이 있습니까?',
      keywords: ['불면', '잠', '수면', '못자', '깨', '졸림', '낮잠', '악몽', '코골', '다리', '뒤척'],
    },

    /* ---------- XIII. 성기능부전 ---------- */
    {
      id: 'g-sexual',
      label: '성기능',
      category: '성기능부전',
      diagIds: null,
      question: '성기능(욕구·흥분·발기·극치감·성교 시 통증) 관련 어려움을 호소합니까?',
      keywords: ['성기능', '성욕', '발기', '사정', '극치감', '오르가',  '성교통', '부부관계', '성생활'],
    },

    /* ---------- XIV. 성별불쾌감 ---------- */
    {
      id: 'g-gender',
      label: '성별불쾌감',
      category: '성별불쾌감',
      diagIds: null,
      question: '지정성별과 스스로 경험하는 성별 사이의 불일치로 인해 뚜렷한 고통을 호소합니까?',
      keywords: ['성별', '젠더', '트랜스', '정체성', '남자로', '여자로', '몸이싫'],
    },

    /* ---------- XV. 파괴적·충동조절·품행 ---------- */
    {
      id: 'g-disruptive',
      label: '분노·공격·충동',
      category: '파괴적, 충동조절 및 품행장애',
      diagIds: null,
      question: '반복적인 분노발작이나 반항, 타인·동물에 대한 공격, 재산 파괴, 규칙 위반이 있습니까? 또는 충동을 못 이겨 불을 지르거나 물건을 훔친 적이 있습니까?',
      keywords: ['분노', '화', '폭발', '반항', '공격', '싸움', '때림', '규칙', '가출', '거짓말', '훔침', '도벽', '방화', '불'],
    },

    /* ---------- XVI. 물질관련 및 중독 ---------- */
    {
      id: 'g-substance',
      label: '물질·중독',
      category: '물질관련 및 중독장애',
      diagIds: null,
      question: '알코올·약물 등 물질 사용이나 도박을 스스로 줄이거나 조절하지 못하는 양상이 있습니까?',
      keywords: ['술', '음주', '알코올', '약물', '담배', '중독', '도박', '끊지못', '내성', '금단', '게임'],
    },

    /* ---------- XVII. 신경인지 ---------- */
    {
      id: 'g-neurocognitive',
      label: '인지 저하',
      category: '신경인지장애',
      diagIds: null,
      question: '이전 수행 수준에 비해 기억·주의·언어·실행기능 등 인지 능력이 뚜렷하게 저하되었습니까? 또는 주의·지남력이 급격히 변동합니까?',
      keywords: ['기억력', '치매', '건망', '깜빡', '길을', '인지', '지남력', '섬망', '혼란', '노인', '이름을'],
    },

    /* ---------- XVIII. 성격장애 — DSM의 A/B/C군으로 분할 ---------- */
    {
      id: 'g-pd-a',
      label: '성격 A군 (기이·괴팍)',
      category: '성격장애',
      diagIds: ['pd-paranoid', 'pd-schizoid', 'pd-schizotypal'],
      question: '오래 지속되어 온 성격 양상으로, 근거 없이 타인을 강하게 불신하거나, 친밀한 관계 자체에 관심이 없거나, 괴이한 믿음·지각·행동이 두드러집니까?',
      keywords: ['의심', '불신', '피해적', '혼자', '고립', '무관심', '괴이', '엉뚱', '미신', '기이'],
    },
    {
      id: 'g-pd-b',
      label: '성격 B군 (극적·불안정)',
      category: '성격장애',
      diagIds: ['pd-antisocial', 'pd-borderline', 'pd-histrionic', 'pd-narcissistic'],
      question: '오래 지속되어 온 성격 양상으로, 정서와 대인관계가 불안정하고 충동적이거나, 과도하게 주목을 추구하거나, 특권의식이 강하거나, 사회 규범·타인의 권리를 반복적으로 침해합니까?',
      keywords: ['불안정', '버림', '유기', '자해', '충동', '극단', '이상화', '관심', '주목', '과장', '특권', '공감부족', '규범', '착취'],
    },
    {
      id: 'g-pd-c',
      label: '성격 C군 (불안·두려움)',
      category: '성격장애',
      diagIds: ['pd-avoidant', 'pd-dependent', 'pd-ocpd'],
      question: '오래 지속되어 온 성격 양상으로, 비판·거절이 두려워 대인관계를 회피하거나, 스스로 결정하지 못하고 과도하게 의존하거나, 완벽주의·규칙 집착으로 경직되어 있습니까?',
      keywords: ['회피', '거절', '비판', '소심', '의존', '결정못', '매달', '완벽', '규칙', '경직', '융통성'],
    },
  ];

  // 게이트가 실제로 여는 진단 id 목록. diagIds가 null이면 category 전체.
  function resolveDiagIds(gate, diagnoses) {
    if (gate.diagIds) return gate.diagIds.slice();
    return diagnoses
      .filter(function (d) { return d.category === gate.category; })
      .map(function (d) { return d.id; });
  }

  // 이 게이트가 포괄하는 각 진단의 **핵심 항목**(첫 항목군의 첫 항목)을 돌려준다.
  // 게이트 질문이 어느 근거에서 나왔는지 드러내는 검토 자료다 — 임상 자문을 받을 때
  // "이 질문 하나로 이 진단들을 선별해도 되는가"를 이 목록으로 판단할 수 있다.
  //
  // 문구를 이 파일에 복사해 두지 않고 data.js 위치만 참조하는 것이 중요하다.
  // 복사본이 있으면 data.js가 바뀔 때 조용히 어긋나고, 옮겨 적는 과정에서 원문이
  // 왜곡될 수 있다. 사본이 없으면 어긋날 수도 없다.
  function coreItemsFor(gate, diagnoses) {
    return resolveDiagIds(gate, diagnoses).map(function (id) {
      var d = null;
      for (var i = 0; i < diagnoses.length; i++) if (diagnoses[i].id === id) d = diagnoses[i];
      if (!d || !d.groups || !d.groups[0] || !d.groups[0].items || !d.groups[0].items.length) {
        return { diagId: id, name: d ? d.name_kr : id, text: null };
      }
      return { diagId: id, name: d.name_kr, text: d.groups[0].items[0] };
    });
  }

  // 모든 진단이 최소 한 게이트에 속하는지 검사한다. 어느 진단이 어떤 게이트에도
  // 안 걸리면 그 진단은 문진에서 영영 보이지 않게 되므로(치명적 false negative),
  // 데이터가 바뀔 때 이 검사로 즉시 잡는다.
  function findCoverageGaps(diagnoses) {
    var covered = {};
    GATES.forEach(function (g) {
      resolveDiagIds(g, diagnoses).forEach(function (id) { covered[id] = true; });
    });
    var missing = diagnoses.filter(function (d) { return !covered[d.id]; }).map(function (d) { return d.id; });
    var unknown = [];
    GATES.forEach(function (g) {
      if (!g.diagIds) return;
      g.diagIds.forEach(function (id) {
        if (!diagnoses.some(function (d) { return d.id === id; })) unknown.push(g.id + ' → ' + id);
      });
    });
    // 핵심 항목을 못 찾는 진단도 잡아둔다 — 게이트 질문의 근거를 제시할 수 없다는
    // 뜻이고, data.js 구조가 예상과 달라졌다는 신호다.
    var noCoreItem = [];
    GATES.forEach(function (g) {
      coreItemsFor(g, diagnoses).forEach(function (c) {
        if (!c.text) noCoreItem.push(g.id + ' → ' + c.diagId);
      });
    });

    return { missing: missing, unknown: unknown, noCoreItem: noCoreItem };
  }

  // 소견 텍스트에서 키워드가 걸린 게이트를 앞으로 당긴다. **정렬만 하고
  // 제외하지 않는다** — 키워드가 안 걸려도 모든 게이트를 순회한다.
  // 형태소 분석 없이 단순 부분일치라 매칭률은 높지 않다. 그래도 결과
  // 정확도에는 영향이 없다(순서만 바뀜). requirements.md R14 참고.
  function rankGates(noteText, diagnoses) {
    var text = (noteText || '').toLowerCase();
    var scored = GATES.map(function (g, idx) {
      var hits = text ? g.keywords.filter(function (k) { return text.indexOf(k.toLowerCase()) !== -1; }) : [];
      return { gate: g, hits: hits, order: idx };
    });
    scored.sort(function (a, b) {
      return (b.hits.length - a.hits.length) || (a.order - b.order);
    });
    return scored;
  }

  var api = {
    GATES: GATES,
    resolveDiagIds: resolveDiagIds,
    coreItemsFor: coreItemsFor,
    findCoverageGaps: findCoverageGaps,
    rankGates: rankGates,
  };

  root.HututiGates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
