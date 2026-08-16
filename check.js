/* ==========================================================================
   check.js — 후투티 데이터 점검 도구

   쓰는 법 (이 폴더에서):
       node check.js

   무엇을 하나
     진단 데이터(js/data.js)와 규칙(js/criteria.js·js/gates.js)이 서로 어긋나지
     않는지 훑어본다. DSM 원문을 보며 문구를 한 문장씩 고칠 때, 고친 뒤 이걸
     한 번 돌리면 조용히 깨진 곳을 잡을 수 있다.

   왜 필요한가
     눈으로는 안 보이는 어긋남이 생긴다. 예를 들어
       · 항목 순서를 바꿨는데 "우울 기분 또는 흥미상실 중 1개 필수" 규칙이
         옛 위치(0번·1번)를 그대로 가리킨 채 남는다 → 엉뚱한 항목을 필수로 본다
       · 진단을 하나 추가했는데 23개 문항 어디에도 안 들어간다 → 그 진단은
         문진에서 영영 나타나지 않는다(가장 위험한 종류의 오류)
       · 규칙에 "6개월"이라 적었는데 원문을 "3개월"로 고쳤다 → 판정이 틀린다
     이런 것은 화면을 봐서는 모르고, 결과만 조용히 잘못 나온다.

   주의
     이 도구가 확인하는 것은 **데이터끼리 앞뒤가 맞는지**까지다.
     문구가 DSM 원문과 맞는지는 사람이 원서를 보고 판단해야 한다.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const load = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let problems = [];   // 반드시 고쳐야 하는 것
let notices = [];    // 사람이 한 번 봐야 하는 것
let checks = 0;

const bad = (msg) => problems.push(msg);
const note = (msg) => notices.push(msg);

/* ---------------------------------------------------------------- 불러오기 */

let DIAGNOSES, CRITERIA, GATES, ENGINE;
try {
  DIAGNOSES = new Function(load('js/data.js') + '\n; return DIAGNOSES;')();
  CRITERIA = require('./js/criteria.js');
  GATES = require('./js/gates.js');
  ENGINE = require('./js/criteria-engine.js');
} catch (e) {
  console.error('파일을 읽지 못했습니다: ' + e.message);
  console.error('js/data.js 를 고치다 문법이 깨졌을 수 있습니다(쉼표·따옴표 확인).');
  process.exit(1);
}

console.log('후투티 데이터 점검');
console.log('='.repeat(60));
console.log('');

/* -------------------------------------------------- 1. 진단 데이터 기본 검사 */

console.log('[1] 진단 데이터 기본 형태');
const ids = {};
DIAGNOSES.forEach((d, i) => {
  checks++;
  const where = '진단 #' + (i + 1) + ' (' + (d.name_kr || d.id || '이름 없음') + ')';
  if (!d.id) bad(where + ' — id가 없습니다');
  if (ids[d.id]) bad(where + ' — id "' + d.id + '"가 중복입니다');
  ids[d.id] = true;
  if (!d.name_kr) bad(where + ' — 한글 진단명이 없습니다');
  if (!d.category) bad(where + ' — 범주(category)가 없습니다');
  if (!d.groups || !d.groups.length) bad(where + ' — 항목군(groups)이 없습니다');
  if (d.groupLogic !== 'AND' && d.groupLogic !== 'OR') {
    bad(where + ' — groupLogic이 AND/OR 가 아닙니다: ' + d.groupLogic);
  }
  (d.groups || []).forEach((g, gi) => {
    if (!g.items || !g.items.length) bad(where + ' 항목군' + (gi + 1) + ' — 항목이 없습니다');
    if (typeof g.min !== 'number' || g.min < 1) {
      bad(where + ' 항목군' + (gi + 1) + ' — 최소 개수(min)가 이상합니다: ' + g.min);
    }
    if (g.items && g.min > g.items.length) {
      bad(where + ' 항목군' + (gi + 1) + ' — 항목은 ' + g.items.length + '개인데 ' +
        g.min + '개를 요구합니다(충족 불가능)');
    }
    (g.items || []).forEach((it, ii) => {
      if (!it || !String(it).trim()) bad(where + ' 항목군' + (gi + 1) + ' ' + (ii + 1) + '번 — 빈 항목');
    });
  });
  if (!d.duration) note(where + ' — 기간 기준(duration)이 비어 있습니다');
});
console.log('    진단 ' + DIAGNOSES.length + '개 확인');

/* ------------------------------------------ 2. 필수 포함 조건(requiredAny) */

console.log('[2] "그중 최소 하나는 반드시" 조건');
let reqCount = 0;
DIAGNOSES.forEach((d) => {
  (d.requiredAny || []).forEach((req, ri) => {
    checks++; reqCount++;
    const where = d.name_kr + ' 필수조건 ' + (ri + 1);
    const g = d.groups[req.group];
    if (!g) { bad(where + ' — 항목군 ' + req.group + '이 없습니다'); return; }
    if (!req.indexes || !req.indexes.length) { bad(where + ' — 대상 항목이 비었습니다'); return; }
    req.indexes.forEach((idx) => {
      if (idx < 0 || idx >= g.items.length) {
        bad(where + ' — ' + idx + '번 항목을 가리키는데 그 항목군엔 ' + g.items.length +
          '개뿐입니다. 항목 순서를 바꾸셨다면 이 숫자도 함께 고쳐야 합니다');
      }
    });
    if ((req.min || 1) > req.indexes.length) {
      bad(where + ' — 대상 ' + req.indexes.length + '개 중 ' + req.min + '개를 요구합니다(불가능)');
    }
    if (!req.label) note(where + ' — 설명(label)이 없어 화면에 이유를 못 보여줍니다');
  });
});
console.log('    ' + reqCount + '건 확인' + (reqCount ? '' : ' (현재 주요우울장애·조현병 2건이 정상)'));

/* ------------------------------------------------ 3. 규칙과 원문이 맞는지 */

console.log('[3] 규칙(criteria.js)과 진단 원문 대조');
Object.keys(CRITERIA.CRITERIA).forEach((id) => {
  checks++;
  if (!ids[id]) bad('규칙에 있는 "' + id + '"가 진단 데이터에 없습니다');
});
DIAGNOSES.forEach((d) => {
  checks++;
  const c = CRITERIA.get(d.id);
  if (!c) { bad(d.name_kr + ' — 규칙 파일에 등록되어 있지 않습니다'); return; }
  // criteria.js의 source는 data.js 원문을 그대로 담고 있어야 한다.
  // 원문을 고쳤다면 규칙 파일도 함께 갱신해야 어긋나지 않는다.
  if (c.source.duration !== (d.duration || '')) {
    bad(d.name_kr + ' — 기간 기준 원문이 규칙 파일과 다릅니다.\n' +
      '        진단 데이터: ' + (d.duration || '(비어 있음)') + '\n' +
      '        규칙 파일  : ' + (c.source.duration || '(비어 있음)') + '\n' +
      '        → 원문을 고치셨다면 규칙 파일의 source도 같이 고쳐야 합니다');
  }
  if (c.source.other !== (d.other || '')) {
    bad(d.name_kr + ' — 추가 확인사항 원문이 규칙 파일과 다릅니다');
  }
});

// 규칙에 적힌 수치가 원문 안에서 확인되는가
const DUR = { hours: '시간', days: '일', weeks: '주', months: '개월', years: '년' };
const AGE = { years: '세', months: '개월' };
const PER = { week: '주', month: '월' };
function checkNumber(name, what, value, suffix, text) {
  checks++;
  if (new RegExp(value + ' *' + suffix).test(text)) return;
  if (new RegExp('(^|[^0-9])' + value + '([^0-9]|$)').test(text)) {
    note(name + ' — ' + what + ' ' + value + suffix + ' : 숫자는 원문에 있으나 표기가 다릅니다(확인 필요)');
    return;
  }
  bad(name + ' — ' + what + ' ' + value + suffix + ' 이(가) 원문에 없습니다\n' +
    '        원문: ' + text);
}
Object.keys(CRITERIA.CRITERIA).forEach((id) => {
  const c = CRITERIA.CRITERIA[id];
  const d = DIAGNOSES.filter((x) => x.id === id)[0];
  if (!d) return;
  const text = (c.source.duration + ' ' + c.source.other).replace(/\s+/g, ' ');
  const n = d.name_kr;
  if (c.duration && !c.duration.qualitative) {
    if (c.duration.min) checkNumber(n, '기간 최소', c.duration.min.value, DUR[c.duration.min.unit], text);
    if (c.duration.max) checkNumber(n, '기간 최대', c.duration.max.value, DUR[c.duration.max.unit], text);
    if (c.duration.minIfUnder) checkNumber(n, '소아 기준', c.duration.minIfUnder.value, DUR[c.duration.minIfUnder.unit], text);
    if (c.duration.max && c.duration.maxInclusive === undefined) {
      bad(n + ' — 기간 상한이 있는데 "이내"인지 "미만"인지(maxInclusive) 적혀 있지 않습니다');
    }
  }
  if (c.age) {
    if (c.age.min) checkNumber(n, '연령 최소', c.age.min.value, AGE[c.age.min.unit], text);
    if (c.age.max) checkNumber(n, '연령 최대', c.age.max.value, AGE[c.age.max.unit], text);
  }
  if (c.frequency && c.frequency.minCount) {
    checks++;
    if (!new RegExp(PER[c.frequency.per] + ' *' + c.frequency.minCount + ' *회').test(text)) {
      bad(n + ' — 빈도 ' + PER[c.frequency.per] + ' ' + c.frequency.minCount + '회가 원문에 없습니다');
    }
  }
  if (c.dailyTime && c.dailyTime.min) {
    checkNumber(n, '하루 소요시간', c.dailyTime.min.value, DUR[c.dailyTime.min.unit], text);
  }
  if (c.impairment && c.impairment.required) {
    checks++;
    if (!/지장|저하|고통|손상|영향/.test(text)) {
      bad(n + ' — 기능 손상을 요구하는데 원문에 그런 표현이 없습니다');
    }
  }
});

/* ------------------------------------------------ 4. 문진 문항이 다 덮는가 */

console.log('[4] 문진 문항이 81개 진단을 다 덮는가');
checks++;
const gaps = GATES.findCoverageGaps(DIAGNOSES);
if (gaps.missing.length) {
  bad('어느 문항에도 속하지 않는 진단이 있습니다 — ' + gaps.missing.join(', ') + '\n' +
    '        이 진단들은 문진 화면에서 영영 나타나지 않습니다.\n' +
    '        진단을 새로 추가하셨다면 js/gates.js의 해당 문항 diagIds에 넣어 주세요');
}
if (gaps.unknown.length) bad('문항이 없는 진단을 가리킵니다 — ' + gaps.unknown.join(', '));
if (gaps.noCoreItem.length) bad('근거 항목을 못 찾는 문항이 있습니다 — ' + gaps.noCoreItem.join(', '));

let total = 0;
GATES.GATES.forEach((g) => { total += GATES.resolveDiagIds(g, DIAGNOSES).length; });
checks++;
if (total !== DIAGNOSES.length) {
  bad('문항이 맡은 진단 합계가 ' + total + '개인데 실제 진단은 ' + DIAGNOSES.length +
    '개입니다(같은 진단이 두 문항에 들어갔을 수 있습니다)');
}
console.log('    문항 ' + GATES.GATES.length + '개 / 맡은 진단 합계 ' + total + '개');

/* ------------------------------------------------------- 5. 판정 엔진 동작 */

console.log('[5] 판정 엔진이 제대로 도는가');
// 아무것도 답하지 않았을 때 어떤 진단도 "충족"이 되면 안 된다.
// 이게 깨지면 확인하지 않은 것을 충족으로 처리하게 되어 가장 위험하다.
let silent = [];
CRITERIA.computableIds().forEach((id) => {
  checks++;
  if (ENGINE.evaluate(CRITERIA.get(id), {}).overall === 'PASS') silent.push(id);
});
if (silent.length) {
  bad('답을 하나도 안 했는데 충족으로 나오는 진단이 있습니다 — ' + silent.join(', '));
}

// 질문 문장이 제대로 만들어지는가
let badQ = [];
CRITERIA.computableIds().forEach((id) => {
  const r = ENGINE.evaluate(CRITERIA.get(id), { age: 30, onsetAge: 10 });
  ['duration', 'frequency', 'dailyTime', 'impairment'].forEach((k) => {
    const a = r.axes[k];
    if (!a || a.status === 'NA' || a.status === 'QUALITATIVE') return;
    checks++;
    const text = a.question || a.need || '';
    if (!/\?$/.test(text)) badQ.push(id + ' → ' + text);
  });
});
if (badQ.length) bad('질문 문장이 이상합니다 — ' + badQ.join(' | '));
console.log('    자동 판정 대상 ' + CRITERIA.computableIds().length + '개 진단 확인');

/* ------------------------------------------------------------------ 결과 */

console.log('');
console.log('='.repeat(60));
console.log('검사 ' + checks + '건 수행');
console.log('');

if (notices.length) {
  console.log('한 번 봐 주세요 (' + notices.length + '건)');
  notices.forEach((m) => console.log('  · ' + m));
  console.log('');
}

if (problems.length) {
  console.log('고쳐야 합니다 (' + problems.length + '건)');
  problems.forEach((m) => console.log('  ✗ ' + m));
  console.log('');
  console.log('위 내용을 고친 뒤 다시 실행해 주세요.');
  process.exit(1);
}

console.log('이상 없습니다.');
console.log('');
console.log('다만 이 도구가 확인한 것은 데이터끼리 앞뒤가 맞는지까지입니다.');
console.log('문구가 DSM-5-TR 원문과 맞는지는 원서를 보고 직접 판단하셔야 합니다.');
