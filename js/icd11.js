/* ==========================================================================
   ICD-11(WHO) 챕터06+07 분류 지도 페이지.
   icd11-source/icd11_curated_top_level.json(상위 진단명 149개 + 대분류 31개,
   자체 번역)을 불러와 클릭으로 펼치고 접을 수 있는 트리로 렌더링한다.
   ========================================================================== */

const DATA_URL = 'icd11-source/icd11_curated_top_level.json?v=1';

const CHAPTER_LABEL = {
  '06': { kr: '정신, 행동 및 신경발달장애', en: 'Mental, behavioural or neurodevelopmental disorders' },
  '07': { kr: '수면-각성장애', en: 'Sleep-wake disorders' },
};

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (children) {
    children.forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return node;
}

function renderItem(item) {
  const details = el('details', 'icd11-item');
  const summary = el('summary', null, [
    el('span', 'icd11-code', [item.code]),
    ' ' + item.title_kr + ' ',
    el('span', 'icd11-en', [item.title_en]),
  ]);
  details.appendChild(summary);

  const detail = el('div', 'icd11-detail');
  if (item.definition_en) {
    detail.appendChild(el('p', 'icd11-def-en', [item.definition_en]));
  }
  if (item.inclusions_en && item.inclusions_en.length > 0) {
    detail.appendChild(el('p', 'icd11-incl', ['포함: ' + item.inclusions_en.join(', ')]));
  }
  if (item.exclusions_en && item.exclusions_en.length > 0) {
    detail.appendChild(el('p', 'icd11-excl', ['제외: ' + item.exclusions_en.join(', ')]));
  }
  details.appendChild(detail);

  const li = el('li', null, [details]);
  return li;
}

function renderBlock(blockTitleEn, blockData) {
  const details = el('details', 'icd11-block');
  const summary = el('summary', null, [
    (blockData.block_kr || blockTitleEn) + ' ',
    el('span', 'icd11-en', [blockTitleEn]),
    el('span', 'icd11-count', [' (' + blockData.items.length + '개)']),
  ]);
  details.appendChild(summary);

  const ul = el('ul', 'icd11-items');
  blockData.items.forEach((item) => ul.appendChild(renderItem(item)));
  details.appendChild(ul);

  return details;
}

function renderChapter(chapterCode, blocks) {
  const label = CHAPTER_LABEL[chapterCode] || { kr: '챕터 ' + chapterCode, en: '' };
  const totalItems = Object.values(blocks).reduce((sum, b) => sum + b.items.length, 0);
  const totalBlocks = Object.keys(blocks).length;

  const details = el('details', 'icd11-chapter');
  details.open = true;
  const summary = el('summary', null, [
    '챕터 ' + chapterCode + ' · ' + label.kr + ' ',
    el('span', 'icd11-en', [label.en]),
    el('span', 'icd11-count', [' (대분류 ' + totalBlocks + '개 · 진단명 ' + totalItems + '개)']),
  ]);
  details.appendChild(summary);

  const blocksWrap = el('div', 'icd11-blocks');
  Object.keys(blocks).forEach((blockTitleEn) => {
    blocksWrap.appendChild(renderBlock(blockTitleEn, blocks[blockTitleEn]));
  });
  details.appendChild(blocksWrap);

  return details;
}

async function init() {
  const root = document.getElementById('icd11-tree-root');
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    root.innerHTML = '';
    Object.keys(data.chapters).forEach((chapterCode) => {
      root.appendChild(renderChapter(chapterCode, data.chapters[chapterCode]));
    });
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(el('p', 'icd11-error', ['분류 데이터를 불러오지 못했습니다: ' + (e && e.message ? e.message : String(e))]));
  }
}

document.addEventListener('DOMContentLoaded', function () {
  init();

  const expandBtn = document.getElementById('icd11-expand-all');
  const collapseBtn = document.getElementById('icd11-collapse-all');
  if (expandBtn) {
    expandBtn.addEventListener('click', function () {
      document.querySelectorAll('#icd11-tree-root details').forEach((d) => { d.open = true; });
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function () {
      document.querySelectorAll('#icd11-tree-root details').forEach((d) => { d.open = false; });
    });
  }
});
