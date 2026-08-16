/* ==========================================================================
   criteria.js — 진단기준의 정량 규칙 (기간·연령·빈도·기능손상·하루 소요시간)

   js/data.js의 duration·other는 사람이 읽는 줄글이라 자동 채점에서 빠져 있었다
   (README 명시). 그래서 "우울 증상 5개"가 2주짜리든 이틀짜리든 똑같이 "기준 충족
   가능성"으로 표시됐다. 이 파일은 그 줄글에서 기계가 판정할 수 있는 부분만 뽑아
   규칙으로 옮긴 것이다. 판정은 js/criteria-engine.js가 한다.

   설계 = docsPlan/quantified-criteria/{requirements,structure}.md

   ── 왜 data.js에 넣지 않고 별도 파일인가 ─────────────────────────────────
   data.js는 임상 콘텐츠(진단명·증상 문구)다. 기계용 규칙을 섞으면 임상 자문을
   받을 때 사람이 읽을 것과 코드가 읽을 것이 뒤엉킨다. 분리해 두면 data.js를
   수정하지 않아도 되므로 checklist.html 회귀 위험이 없고, 각 규칙 옆에 원문을
   그대로 붙여둘 수 있어 대조 검증이 이 파일 하나로 끝난다.

   ── source 필드 ──────────────────────────────────────────────────────────
   각 항목의 source는 data.js의 duration·other **원문 그대로**다. 손으로 옮기지
   않고 생성 스크립트가 주입했다 — 옮겨 적다 생기는 왜곡을 구조적으로 막기 위함.
   규칙의 모든 수치는 이 원문 안에서 확인할 수 있어야 한다(대조 테스트로 검증).

   ── 중요한 한계 ──────────────────────────────────────────────────────────
   이 규칙이 원문과 일치함은 증명할 수 있지만, **원문 자체가 임상적으로 옳은지는
   증명하지 못한다.** data.js는 DSM-5-TR 개념을 AI가 재서술한 미검증 자료다.

   ── 계산하지 않는 조건 ───────────────────────────────────────────────────
   "2개월 이상 증상 없는 기간이 없음"처럼 중첩된 조건은 계산하지 않는다. 대신
   notes에 남겨 화면에 "직접 확인할 것"으로 표시한다. 조용히 통과시키지 않는다.

   일반 스크립트(비-module)인 이유는 scoring.js·gates.js와 같다 — 파일을 직접
   열어도(file://) 동작해야 하기 때문(requirements.md §2-18).
   ========================================================================== */

(function (root) {
  'use strict';

  var CRITERIA = {
    /* 지적발달장애 — 신경발달장애 */
    "nd-id": {
      source: {
        duration: "발달시기(18세 이전)에 발병",
        other: "지능검사와 적응기능 평가가 함께 이루어져야 함",
      },
      age: { max: { value: 18, unit: 'years' }, kind: 'onset' },
      confirmations: [
        { id: "iq-adaptive", text: "지능검사와 적응기능 평가가 함께 이루어졌습니까?" },
      ],
    },

    /* 자폐스펙트럼장애 — 신경발달장애 */
    "nd-asd": {
      source: {
        duration: "발달 초기부터 존재(나중에 사회적 요구가 커지며 뚜렷해질 수 있음)",
        other: "증상으로 사회적·직업적 기능에 뚜렷한 지장이 있어야 함",
      },
      qualitative: true,
    },

    /* 주의력결핍 과잉행동장애 (ADHD) — 신경발달장애 */
    "nd-adhd": {
      source: {
        duration: "여러 증상이 12세 이전부터 존재, 6개월 이상 지속",
        other: "2개 이상의 환경(가정·학교·직장 등)에서 증상이 나타나야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      age: { max: { value: 12, unit: 'years' }, kind: 'onset' },
      confirmations: [
        { id: "two-settings", text: "2개 이상의 환경(가정·학교·직장 등)에서 증상이 나타납니까?" },
      ],
    },

    /* 특정학습장애 — 신경발달장애 */
    "nd-sld": {
      source: {
        duration: "학습을 요하는 시기부터 최소 6개월 이상 증상이 지속",
        other: "개인의 생활연령에 기대되는 수준보다 뚜렷하게 낮으며 지적장애 등으로 설명되지 않아야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
    },

    /* 발달성 협응장애 — 신경발달장애 */
    "nd-dcd": {
      source: {
        duration: "초기 발달 시기부터 존재",
        other: "지속적으로 학업·놀이·일상활동을 방해하며, 지적장애나 시각손상, 신경학적 질환으로 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 상동증적 운동장애 — 신경발달장애 */
    "nd-smd": {
      source: {
        duration: "초기 발달시기부터 지속",
        other: "사회·학업 활동을 방해하거나 자해 위험이 있어야 함",
      },
      qualitative: true,
    },

    /* 뚜렛장애 — 신경발달장애 */
    "nd-tourette": {
      source: {
        duration: "틱이 시작된 이후 1년 이상 지속(사라지지 않고 지속됨), 18세 이전 발병",
        other: "증상이 동시에 나타나지 않아도 됨",
      },
      duration: { min: { value: 1, unit: 'years' } },
      age: { max: { value: 18, unit: 'years' }, kind: 'onset' },
    },

    /* 조현병 — 조현병 스펙트럼 및 기타 정신병적 장애 */
    "ps-schizo": {
      source: {
        duration: "위 증상이 1개월 중 상당 기간 존재, 발병의 징후는 6개월 이상 지속",
        other: "발병 이후 직업·대인관계·자기돌봄 등 기능수준이 뚜렷하게 저하되어야 하며, 조현정동장애·기분장애·물질 등으로 배제되어야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      impairment: { required: true },
      confirmations: [
        { id: "active-phase", text: "활성기 증상이 1개월 중 상당 기간 존재했습니까?" },
        { id: "not-other", text: "조현정동장애·기분장애·물질로 더 잘 설명되지 않습니까?" },
      ],
    },

    /* 조현정동장애 — 조현병 스펙트럼 및 기타 정신병적 장애 */
    "ps-schizoaffective": {
      source: {
        duration: "전체 활성기·잔류기 기간의 상당 부분에서 기분삽화 기준을 충족",
        other: "물질이나 다른 의학적 상태로 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 조현양상장애 — 조현병 스펙트럼 및 기타 정신병적 장애 */
    "ps-schizophreniform": {
      source: {
        duration: "증상 지속기간이 1개월 이상 6개월 미만",
        other: "조현병과 증상은 유사하나 지속기간이 짧음",
      },
      duration: { min: { value: 1, unit: 'months' }, max: { value: 6, unit: 'months' }, maxInclusive: false },
    },

    /* 단기정신병적장애 — 조현병 스펙트럼 및 기타 정신병적 장애 */
    "ps-brief": {
      source: {
        duration: "1일 이상 1개월 이내 지속 후 병전 기능 수준으로 완전히 회복",
        other: "흔히 극심한 스트레스 사건 이후 발생",
      },
      duration: { min: { value: 1, unit: 'days' }, max: { value: 1, unit: 'months' }, maxInclusive: true },
      confirmations: [
        { id: "full-recovery", text: "이후 병전 기능 수준으로 완전히 회복했습니까?" },
      ],
    },

    /* 망상장애 — 조현병 스펙트럼 및 기타 정신병적 장애 */
    "ps-delusional": {
      source: {
        duration: "1개월 이상 지속",
        other: "망상 외에는 기능이 뚜렷하게 손상되지 않고 행동이 명백히 기이하지 않음. 조현병의 다른 활성기 증상은 두드러지지 않음",
      },
      duration: { min: { value: 1, unit: 'months' } },
    },

    /* 제1형 양극성장애 — 양극성 및 관련 장애 */
    "bp-1": {
      source: {
        duration: "증상이 최소 1주간 거의 매일 하루 대부분 지속(입원이 필요할 정도면 기간 무관)",
        other: "사회적·직업적 기능에 뚜렷한 지장을 주거나 입원이 필요할 정도로 심각해야 함",
      },
      duration: { min: { value: 1, unit: 'weeks' } },
      impairment: { required: true },
      exceptions: [{"id":"hospitalized","label":"입원이 필요할 정도로 심각함","waives":["duration"]}],
    },

    /* 제2형 양극성장애 — 양극성 및 관련 장애 */
    "bp-2": {
      source: {
        duration: "경조증 최소 4일, 주요우울삽화는 2주 이상",
        other: "조증 삽화가 있었던 적은 없어야 함(있었다면 제1형에 해당)",
      },
      duration: { min: { value: 4, unit: 'days' } },
      confirmations: [
        { id: "mde-2w", text: "주요우울삽화가 별도로 2주 이상 지속되었습니까?" },
        { id: "no-mania", text: "조증 삽화가 있었던 적이 없습니까? (있었다면 제1형입니다)" },
      ],
    },

    /* 순환성장애 — 양극성 및 관련 장애 */
    "bp-cyclo": {
      source: {
        duration: "최소 2년(소아·청소년은 1년) 동안 증상이 없던 기간이 2개월을 넘지 않음",
        other: "이 기간 동안 주요우울·조증·경조증 삽화의 전체 기준을 만족한 적은 없어야 함",
      },
      duration: { min: { value: 2, unit: 'years' }, minIfUnder: { age: 18, value: 1, unit: 'years' } },
      confirmations: [
        { id: "no-gap-2m", text: "증상이 없던 기간이 2개월을 넘지 않았습니까?" },
        { id: "no-full-episode", text: "주요우울·조증·경조증 삽화의 전체 기준을 만족한 적이 없습니까?" },
      ],
    },

    /* 주요우울장애 — 우울장애 */
    "dep-mdd": {
      source: {
        duration: "위 증상 중 다수가 2주 이상 거의 매일 지속(우울감 또는 흥미상실 중 1개는 반드시 포함)",
        other: "증상으로 인한 뚜렷한 고통이나 사회적·직업적 기능 저하가 있어야 하며 물질이나 다른 의학적 상태로 설명되지 않아야 함",
      },
      duration: { min: { value: 2, unit: 'weeks' } },
      frequency: { level: 'most_days' },
      impairment: { required: true },
    },

    /* 지속성우울장애 (기분저하증) — 우울장애 */
    "dep-pdd": {
      source: {
        duration: "우울한 기분이 최소 2년(소아·청소년은 1년) 동안 없는 날보다 있는 날이 더 많음, 2개월 이상 증상 없는 기간이 없음",
        other: "주요우울삽화가 만성적으로 겹쳐 나타날 수도 있음",
      },
      duration: { min: { value: 2, unit: 'years' }, minIfUnder: { age: 18, value: 1, unit: 'years' } },
      confirmations: [
        { id: "no-gap-2m", text: "증상이 없던 기간이 2개월을 넘지 않았습니까?" },
      ],
    },

    /* 월경전불쾌장애 — 우울장애 */
    "dep-pmdd": {
      source: {
        duration: "월경 시작 전 주에 증상이 나타나 월경 시작 후 며칠 내 호전, 월경 후에는 최소화되거나 소실",
        other: "대부분의 월경 주기에서 나타나야 하며 사회적·직업적 기능에 지장을 주어야 함",
      },
      qualitative: true,
    },

    /* 파괴적 기분조절부전장애 — 우울장애 */
    "dep-dmdd": {
      source: {
        duration: "증상이 12개월 이상 지속되며 3개월 이상 증상 없는 기간이 없음, 6~18세에 진단, 10세 이전 발병",
        other: "분노발작이 주 3회 이상, 2개 이상의 환경에서 나타나야 함",
      },
      duration: { min: { value: 12, unit: 'months' } },
      age: { min: { value: 6, unit: 'years' }, max: { value: 18, unit: 'years' }, kind: 'diagnosis' },
      frequency: { minCount: 3, per: 'week' },
      confirmations: [
        { id: "onset-before-10", text: "10세 이전에 발병했습니까?" },
        { id: "no-gap-3m", text: "증상이 없던 기간이 3개월을 넘지 않았습니까?" },
        { id: "two-settings", text: "2개 이상의 환경에서 나타납니까?" },
      ],
    },

    /* 범불안장애 — 불안장애 */
    "anx-gad": {
      source: {
        duration: "최소 6개월 이상 대부분의 날에 증상이 나타남",
        other: "증상으로 사회적·직업적 기능에 뚜렷한 지장이 있어야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'most_days' },
      impairment: { required: true },
    },

    /* 공황장애 — 불안장애 */
    "anx-panic": {
      source: {
        duration: "예기치 못한 공황발작이 반복되며 위 우려가 1개월 이상 지속",
        other: "물질이나 다른 의학적 상태로 설명되지 않아야 함",
      },
      duration: { min: { value: 1, unit: 'months' } },
      confirmations: [
        { id: "unexpected-attacks", text: "예기치 못한 공황발작이 반복됩니까?" },
      ],
    },

    /* 광장공포증 — 불안장애 */
    "anx-agora": {
      source: {
        duration: "6개월 이상 지속",
        other: "공황과 유사한 증상이 생겼을 때 도움을 받기 어렵거나 빠져나가기 어렵다는 생각 때문에 위 상황을 두려워하거나 회피함",
      },
      duration: { min: { value: 6, unit: 'months' } },
    },

    /* 사회불안장애 — 불안장애 */
    "anx-social": {
      source: {
        duration: "6개월 이상 지속",
        other: "해당 상황을 거의 항상 회피하거나 극심한 공포·불안 속에서 견디며, 실제 위협에 비해 반응이 지나침",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'almost_always' },
    },

    /* 특정공포증 — 불안장애 */
    "anx-specific": {
      source: {
        duration: "6개월 이상 지속",
        other: "해당 대상·상황을 거의 항상 즉각적인 공포로 회피하거나 견디며, 실제 위험에 비해 반응이 지나침",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'almost_always' },
    },

    /* 분리불안장애 — 불안장애 */
    "anx-sep": {
      source: {
        duration: "소아·청소년은 4주 이상, 성인은 6개월 이상 지속",
        other: "사회적·학업적·직업적 기능에 뚜렷한 지장을 주어야 함",
      },
      duration: { min: { value: 6, unit: 'months' }, minIfUnder: { age: 18, value: 4, unit: 'weeks' } },
      impairment: { required: true },
    },

    /* 선택적함구증 — 불안장애 */
    "anx-mutism": {
      source: {
        duration: "최소 1개월 이상 지속(입학 첫 달은 제외)",
        other: "언어 지식이 부족해서가 아니며 학업적·사회적 의사소통에 지장을 줌",
      },
      duration: { min: { value: 1, unit: 'months' } },
      notes: [
        "입학 첫 달은 제외",
      ],
    },

    /* 강박장애 — 강박 및 관련 장애 */
    "ocd-ocd": {
      source: {
        duration: "하루 1시간 이상을 소요하는 등 시간소모적임",
        other: "증상이 뚜렷한 고통이나 기능 저하를 유발해야 함",
      },
      duration: { qualitative: true },
      dailyTime: { min: { value: 1, unit: 'hours' } },
      impairment: { required: true },
    },

    /* 신체이형장애 — 강박 및 관련 장애 */
    "ocd-bdd": {
      source: {
        duration: "지속적",
        other: "섭식장애의 체형·체중에 대한 집착만으로는 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 저장장애 — 강박 및 관련 장애 */
    "ocd-hoarding": {
      source: {
        duration: "지속적",
        other: "다른 의학적 상태(뇌손상 등)로 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 발모광 (털뽑기장애) — 강박 및 관련 장애 */
    "ocd-trich": {
      source: {
        duration: "지속적",
        other: "뚜렷한 고통이나 사회적·직업적 기능 손상을 유발해야 함",
      },
      qualitative: true,
    },

    /* 피부뜯기장애 — 강박 및 관련 장애 */
    "ocd-excor": {
      source: {
        duration: "지속적",
        other: "뚜렷한 고통이나 사회적·직업적 기능 손상을 유발해야 함",
      },
      qualitative: true,
    },

    /* 외상후스트레스장애 (PTSD) — 외상 및 스트레스 관련 장애 */
    "trauma-ptsd": {
      source: {
        duration: "위 증상이 1개월 이상 지속",
        other: "뚜렷한 고통이나 사회적·직업적 기능 저하를 유발해야 함",
      },
      duration: { min: { value: 1, unit: 'months' } },
      impairment: { required: true },
    },

    /* 급성스트레스장애 — 외상 및 스트레스 관련 장애 */
    "trauma-asd": {
      source: {
        duration: "외상 노출 후 3일~1개월 사이 발생·지속",
        other: "9개 항목 중 다수(대략 9개 이상)가 나타나야 하며 뚜렷한 고통이나 기능저하를 유발해야 함",
      },
      duration: { min: { value: 3, unit: 'days' }, max: { value: 1, unit: 'months' }, maxInclusive: true },
      impairment: { required: true },
    },

    /* 적응장애 — 외상 및 스트레스 관련 장애 */
    "trauma-adjustment": {
      source: {
        duration: "스트레스 요인 발생 후 3개월 이내 발생, 스트레스 요인 종료 후 6개월 이내 소실",
        other: "다른 정신질환의 진단기준을 만족하지 않고, 정상적인 애도반응이 아니어야 함",
      },
      duration: { qualitative: true },
      confirmations: [
        { id: "onset-3m", text: "스트레스 요인 발생 후 3개월 이내에 증상이 시작되었습니까?" },
        { id: "resolve-6m", text: "스트레스 요인이 종료된 뒤 6개월 이내에 증상이 사라집니까?" },
      ],
    },

    /* 반응성애착장애 — 외상 및 스트레스 관련 장애 */
    "trauma-rad": {
      source: {
        duration: "생후 9개월~5세 사이 발현, 극심한 방임·학대 등 불충분한 양육 병력이 있음",
        other: "자폐스펙트럼장애 기준을 만족하지 않아야 함",
      },
      age: { min: { value: 9, unit: 'months' }, max: { value: 5, unit: 'years' }, kind: 'onset' },
      confirmations: [
        { id: "insufficient-care", text: "극심한 방임·학대 등 불충분한 양육 병력이 있습니까?" },
      ],
    },

    /* 탈억제성사회적유대감장애 — 외상 및 스트레스 관련 장애 */
    "trauma-dsed": {
      source: {
        duration: "생후 9개월 이상부터 나타남, 불충분한 양육 병력이 있음",
        other: "주의력결핍 과잉행동장애의 충동성만으로는 설명되지 않아야 함",
      },
      age: { min: { value: 9, unit: 'months' }, kind: 'onset' },
      confirmations: [
        { id: "insufficient-care", text: "불충분한 양육 병력이 있습니까?" },
      ],
    },

    /* 해리성정체성장애 — 해리장애 */
    "diss-did": {
      source: {
        duration: "지속적",
        other: "뚜렷한 고통이나 기능 저하를 유발해야 하며 문화·종교적 관습이나 물질로 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 해리성기억상실 — 해리장애 */
    "diss-amnesia": {
      source: {
        duration: "삽화적",
        other: "해리성 둔주(목적있는 여행이나 방황을 동반한 기억상실)를 동반할 수 있음",
      },
      qualitative: true,
    },

    /* 이인성/비현실감장애 — 해리장애 */
    "diss-dpdr": {
      source: {
        duration: "반복적이거나 지속적",
        other: "이러한 경험 중에도 현실검증력은 유지되어 있음",
      },
      qualitative: true,
    },

    /* 신체증상장애 — 신체증상 및 관련 장애 */
    "som-ssd": {
      source: {
        duration: "보통 6개월 이상 증상 상태가 지속됨",
        other: "신체증상이 다른 질환으로 완전히 설명되더라도 진단 가능",
      },
      duration: { min: { value: 6, unit: 'months' } },
    },

    /* 질병불안장애 — 신체증상 및 관련 장애 */
    "som-illness": {
      source: {
        duration: "6개월 이상 지속(구체적 두려움의 대상은 변할 수 있음)",
        other: "다른 신체증상장애로 더 잘 설명되지 않아야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
    },

    /* 전환장애 (기능성 신경학적 증상장애) — 신체증상 및 관련 장애 */
    "som-conversion": {
      source: {
        duration: "삽화적 또는 지속적",
        other: "뚜렷한 고통이나 기능저하를 유발하거나 의학적 평가가 필요함",
      },
      qualitative: true,
    },

    /* 인위성장애 — 신체증상 및 관련 장애 */
    "som-factitious": {
      source: {
        duration: "반복적일 수 있음",
        other: "자신에게 부여(가장성장애)하거나 타인에게 부여(대리인위성장애)하는 형태로 나타남",
      },
      qualitative: true,
    },

    /* 신경성 식욕부진증 — 급식 및 섭식장애 */
    "eat-anorexia": {
      source: {
        duration: "지속적",
        other: "제한형과 폭식/제거형으로 구분됨",
      },
      qualitative: true,
    },

    /* 신경성 폭식증 — 급식 및 섭식장애 */
    "eat-bulimia": {
      source: {
        duration: "폭식과 보상행동이 평균적으로 주 1회 이상, 3개월 이상 지속",
        other: "신경성 식욕부진증 삽화 중에만 발생하는 것이 아니어야 함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 1, per: 'week' },
    },

    /* 폭식장애 — 급식 및 섭식장애 */
    "eat-binge": {
      source: {
        duration: "평균적으로 3개월 동안 주 1회 이상 발생",
        other: "신경성 폭식증과 달리 반복적인 부적절한 보상행동이 동반되지 않음",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 1, per: 'week' },
    },

    /* 회피적/제한적 음식섭취장애 — 급식 및 섭식장애 */
    "eat-arfid": {
      source: {
        duration: "지속적",
        other: "체형·체중에 대한 왜곡된 인식으로 인한 것이 아니어야 함(신경성 식욕부진증과 구분)",
      },
      qualitative: true,
    },

    /* 이식증 — 급식 및 섭식장애 */
    "eat-pica": {
      source: {
        duration: "최소 1개월 이상 지속",
        other: "발달수준에 비추어 부적절하며 문화적으로 용인되는 관습이 아니어야 함",
      },
      duration: { min: { value: 1, unit: 'months' } },
    },

    /* 유뇨증 — 배설장애 */
    "elim-enuresis": {
      source: {
        duration: "3개월 연속 주 2회 이상, 또는 임상적으로 뚜렷한 고통·기능저하",
        other: "역연령 5세 이상이어야 하며 물질이나 다른 의학적 상태로 설명되지 않아야 함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      age: { min: { value: 5, unit: 'years' }, kind: 'diagnosis' },
      frequency: { minCount: 2, per: 'week' },
      notes: [
        "기간·빈도를 채우지 못해도 임상적으로 뚜렷한 고통·기능저하가 있으면 해당될 수 있음",
      ],
    },

    /* 유분증 — 배설장애 */
    "elim-encopresis": {
      source: {
        duration: "최소 3개월 동안 월 1회 이상",
        other: "역연령 4세 이상이어야 하며 물질이나 다른 의학적 상태로 설명되지 않아야 함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      age: { min: { value: 4, unit: 'years' }, kind: 'diagnosis' },
      frequency: { minCount: 1, per: 'month' },
    },

    /* 불면장애 — 수면-각성장애 */
    "sleep-insomnia": {
      source: {
        duration: "주 3회 이상, 3개월 이상 지속",
        other: "충분한 수면 기회가 있음에도 발생하며 낮 시간 기능에 뚜렷한 고통·지장을 유발함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 3, per: 'week' },
      impairment: { required: true },
    },

    /* 과다수면장애 — 수면-각성장애 */
    "sleep-hyper": {
      source: {
        duration: "주 3회 이상, 3개월 이상 지속",
        other: "뚜렷한 고통이나 기능저하를 유발해야 함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 3, per: 'week' },
      impairment: { required: true },
    },

    /* 기면증 — 수면-각성장애 */
    "sleep-narcolepsy": {
      source: {
        duration: "주 3회 이상, 3개월 이상 지속",
        other: "수면다원검사·뇌척수액 히포크레틴 검사 등 객관적 검사로 확인이 필요함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 3, per: 'week' },
      confirmations: [
        { id: "objective-test", text: "수면다원검사·뇌척수액 히포크레틴 검사 등 객관적 검사로 확인되었습니까?" },
      ],
    },

    /* 악몽장애 — 수면-각성장애 */
    "sleep-nightmare": {
      source: {
        duration: "반복적",
        other: "뚜렷한 고통이나 사회적·직업적 기능저하를 유발해야 함",
      },
      qualitative: true,
    },

    /* 렘수면행동장애 — 수면-각성장애 */
    "sleep-rbd": {
      source: {
        duration: "반복적",
        other: "깨어나면 빠르게 각성상태로 돌아오고 지남력이 명료함, 자신이나 배우자에게 손상을 줄 수 있음",
      },
      qualitative: true,
    },

    /* 하지불안증후군 — 수면-각성장애 */
    "sleep-rls": {
      source: {
        duration: "주 3회 이상, 3개월 이상 지속",
        other: "뚜렷한 고통이나 기능저하를 유발해야 함",
      },
      duration: { min: { value: 3, unit: 'months' } },
      frequency: { minCount: 3, per: 'week' },
      impairment: { required: true },
    },

    /* 사정지연 — 성기능부전 */
    "sex-delayed-ejac": {
      source: {
        duration: "6개월 이상, 대부분의 성적 활동에서 발생(75~100%)",
        other: "뚜렷한 고통을 유발해야 하며 다른 정신질환·심각한 관계 문제·물질로 온전히 설명되지 않아야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'almost_always' },
      notes: [
        "대부분의 성적 활동(75~100%)에서 발생해야 함",
      ],
    },

    /* 발기장애 — 성기능부전 */
    "sex-erectile": {
      source: {
        duration: "6개월 이상, 대부분의 성적 활동에서 발생(75~100%)",
        other: "뚜렷한 고통을 유발해야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'almost_always' },
      notes: [
        "대부분의 성적 활동(75~100%)에서 발생해야 함",
      ],
    },

    /* 여성극치감장애 — 성기능부전 */
    "sex-female-orgasmic": {
      source: {
        duration: "6개월 이상, 대부분의 성적 활동에서 발생(75~100%)",
        other: "뚜렷한 고통을 유발해야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      frequency: { level: 'almost_always' },
      notes: [
        "대부분의 성적 활동(75~100%)에서 발생해야 함",
      ],
    },

    /* 생식기-골반통증/삽입장애 — 성기능부전 */
    "sex-gpppd": {
      source: {
        duration: "6개월 이상 지속",
        other: "뚜렷한 고통을 유발해야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
    },

    /* 성별불쾌감 — 성별불쾌감 */
    "gender-dysphoria": {
      source: {
        duration: "최소 6개월 이상 지속",
        other: "뚜렷한 고통이나 사회적·직업적 기능저하와 관련되어야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      impairment: { required: true },
    },

    /* 적대적 반항장애 — 파괴적, 충동조절 및 품행장애 */
    "disr-odd": {
      source: {
        duration: "최소 6개월 이상 지속(연령에 따라 빈도 기준이 달라짐)",
        other: "사회적·학업적·직업적 기능에 부정적 영향을 미쳐야 함",
      },
      duration: { min: { value: 6, unit: 'months' } },
      impairment: { required: true },
      notes: [
        "연령에 따라 요구되는 빈도 기준이 달라짐",
      ],
    },

    /* 간헐적 폭발성장애 — 파괴적, 충동조절 및 품행장애 */
    "disr-ied": {
      source: {
        duration: "반복적",
        other: "공격성의 정도가 스트레스 요인에 비해 명백히 과도하며 미리 계획된 것이 아님",
      },
      qualitative: true,
    },

    /* 품행장애 — 파괴적, 충동조절 및 품행장애 */
    "disr-cd": {
      source: {
        duration: "최근 12개월 이내 3개 이상, 최근 6개월 이내 1개 이상 항목 충족",
        other: "사회적·학업적·직업적 기능에 뚜렷한 지장을 유발해야 함",
      },
      duration: { qualitative: true },
      impairment: { required: true },
      confirmations: [
        { id: "window-12m-3", text: "최근 12개월 이내에 3개 이상 항목을 충족했습니까?" },
        { id: "window-6m-1", text: "최근 6개월 이내에 1개 이상 항목을 충족했습니까?" },
      ],
    },

    /* 병적방화 — 파괴적, 충동조절 및 품행장애 */
    "disr-pyro": {
      source: {
        duration: "반복적",
        other: "금전적 이득, 사상 표현, 분노·복수, 망상·환각 등 다른 이유로 인한 방화가 아니어야 함",
      },
      qualitative: true,
    },

    /* 병적도벽 — 파괴적, 충동조절 및 품행장애 */
    "disr-klepto": {
      source: {
        duration: "반복적",
        other: "분노나 보복 표현, 망상·환각으로 인한 것이 아니어야 함",
      },
      qualitative: true,
    },

    /* 물질사용장애 (공통기준) — 물질관련 및 중독장애 */
    "sub-use": {
      source: {
        duration: "12개월 이내 발생",
        other: "충족 항목 수에 따라 경도(2~3개), 중등도(4~5개), 중증(6개 이상)으로 심각도가 구분됨. 특정 물질(알코올, 대마, 아편계, 자극제, 진정제 등)마다 별도 진단으로 명명됨",
      },
      duration: { qualitative: true },
      confirmations: [
        { id: "window-12m", text: "증상이 최근 12개월 이내에 발생했습니까?" },
      ],
      notes: [
        "충족 항목 수로 경도(2~3개)·중등도(4~5개)·중증(6개 이상)을 구분합니다",
      ],
    },

    /* 도박장애 — 물질관련 및 중독장애 */
    "sub-gambling": {
      source: {
        duration: "12개월 동안의 문제성 도박행동",
        other: "조증삽화로 더 잘 설명되지 않아야 함",
      },
      duration: { qualitative: true },
      confirmations: [
        { id: "window-12m", text: "최근 12개월 동안의 문제성 도박행동입니까?" },
        { id: "not-mania", text: "조증삽화로 더 잘 설명되지 않습니까?" },
      ],
    },

    /* 섬망 — 신경인지장애 */
    "ncd-delirium": {
      source: {
        duration: "급성 또는 아급성 발병, 변동성 경과",
        other: "다른 신경인지장애로 더 잘 설명되지 않으며, 의학적 상태·물질중독/금단·독소 노출 등 직접적 생리적 결과로 발생함. 응급 의학적 평가가 필요함",
      },
      qualitative: true,
    },

    /* 경도 신경인지장애 — 신경인지장애 */
    "ncd-mild": {
      source: {
        duration: "점진적",
        other: "인지결함이 일상생활의 독립적 수행능력을 저해하지는 않음(도구적 일상활동에 다소의 노력이나 보상전략이 필요할 수는 있음)",
      },
      qualitative: true,
    },

    /* 주요 신경인지장애 (치매) — 신경인지장애 */
    "ncd-major": {
      source: {
        duration: "점진적(원인 질환에 따라 다양)",
        other: "섬망 상태에서만 발생하는 것이 아니며, 다른 정신질환으로 더 잘 설명되지 않아야 함. 알츠하이머병, 혈관성, 루이소체 등 원인에 따라 세분화됨",
      },
      qualitative: true,
    },

    /* 편집성 성격장애 — 성격장애 */
    "pd-paranoid": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "조현병, 기분장애, 다른 정신병적 장애의 경과 중에만 나타나는 것이 아니어야 함",
      },
      qualitative: true,
    },

    /* 조현성 성격장애 — 성격장애 */
    "pd-schizoid": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "조현병, 기분장애, 자폐스펙트럼장애 등으로 더 잘 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 조현형 성격장애 — 성격장애 */
    "pd-schizotypal": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "조현병, 기분장애, 자폐스펙트럼장애 등으로 더 잘 설명되지 않아야 함",
      },
      qualitative: true,
    },

    /* 반사회성 성격장애 — 성격장애 */
    "pd-antisocial": {
      source: {
        duration: "18세 이상에서 진단, 15세 이전 품행장애 병력 필요",
        other: "반사회적 행동이 조현병이나 양극성장애의 경과 중에만 나타나는 것이 아니어야 함",
      },
      age: { min: { value: 18, unit: 'years' }, kind: 'diagnosis' },
      confirmations: [
        { id: "cd-before-15", text: "15세 이전에 품행장애 병력이 있습니까?" },
      ],
    },

    /* 경계성 성격장애 — 성격장애 */
    "pd-borderline": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "자살위험이 있는 경우 반드시 전문적 위기평가가 필요함",
      },
      qualitative: true,
    },

    /* 연극성 성격장애 — 성격장애 */
    "pd-histrionic": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "",
      },
      qualitative: true,
    },

    /* 자기애성 성격장애 — 성격장애 */
    "pd-narcissistic": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "",
      },
      qualitative: true,
    },

    /* 회피성 성격장애 — 성격장애 */
    "pd-avoidant": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "",
      },
      qualitative: true,
    },

    /* 의존성 성격장애 — 성격장애 */
    "pd-dependent": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "",
      },
      qualitative: true,
    },

    /* 강박성 성격장애 — 성격장애 */
    "pd-ocpd": {
      source: {
        duration: "성인 초기부터 다양한 상황에서 지속되는 양상",
        other: "순수한 강박장애와 달리 침습적 강박사고나 의례적 강박행동이 핵심이 아니라 성격 전반의 완벽주의·경직성이 핵심임",
      },
      qualitative: true,
    },
  };

  // 진단에 계산 가능한 축이 하나라도 있으면 true.
  function hasComputableAxis(c) {
    if (!c || c.qualitative) return false;
    if (c.duration && !c.duration.qualitative) return true;
    return !!(c.age || c.frequency || c.dailyTime || c.impairment || c.confirmations);
  }

  var api = {
    CRITERIA: CRITERIA,
    get: function (diagId) { return CRITERIA[diagId] || null; },
    hasComputableAxis: hasComputableAxis,
    // 계산 가능한 축을 가진 진단 id 목록 (통계·테스트용)
    computableIds: function () {
      return Object.keys(CRITERIA).filter(function (id) { return hasComputableAxis(CRITERIA[id]); });
    },
  };

  root.HututiCriteria = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
