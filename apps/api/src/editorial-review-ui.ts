export const editorialReviewHtml = String.raw`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WHICH Editorial Review</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/" aria-label="WHICH Editorial Review 홈"><span>W</span>HICH</a>
      <div class="topbar-copy">
        <strong>Editorial Review</strong>
        <span>게시 전 사람 검토 영역</span>
      </div>
      <label class="reviewer-field">
        <span>검토자</span>
        <input id="reviewer" maxlength="100" value="WHICH_PRODUCT_OWNER" />
      </label>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">EXPANDED ISSUE CATALOG · LOCAL ONLY</p>
          <h1>좋은 질문만<br />다음 단계로 보냅니다.</h1>
          <p class="hero-copy">원본 카탈로그는 유지하고, 사람의 승인 결정만 별도 파일에 기록합니다.</p>
        </div>
        <button class="export-button" id="open-export" type="button">승인 후보 내보내기 <span>↗</span></button>
      </section>

      <section class="metrics" aria-label="검토 진행률">
        <article><span>전체 후보</span><strong id="metric-total">—</strong></article>
        <article><span>검토 대기</span><strong id="metric-pending">—</strong></article>
        <article class="approved"><span>승인</span><strong id="metric-approved">—</strong></article>
        <article class="changes"><span>수정 필요</span><strong id="metric-changes">—</strong></article>
        <article class="rejected"><span>반려</span><strong id="metric-rejected">—</strong></article>
      </section>

      <section class="workspace">
        <aside class="candidate-panel">
          <div class="filters">
            <label class="search-field"><span class="sr-only">후보 검색</span><input id="search" type="search" placeholder="질문·ID 검색" /></label>
            <div class="filter-grid">
              <label><span>재고</span><select id="scope"><option value="ACTIVE">Active 72</option><option value="RESERVE">Reserve 108</option><option value="LONG_TERM">Long-term 482</option><option value="ALL">전체</option></select></label>
              <label><span>상태</span><select id="status"><option value="ALL">전체 상태</option><option value="PENDING">검토 대기</option><option value="APPROVED">승인</option><option value="NEEDS_CHANGES">수정 필요</option><option value="REJECTED">반려</option></select></label>
              <label><span>범주</span><select id="category"><option value="ALL">전체 범주</option></select></label>
              <label><span>위험도</span><select id="risk"><option value="ALL">전체</option><option value="LOW">LOW</option><option value="MEDIUM">MEDIUM</option></select></label>
            </div>
          </div>
          <div class="list-heading"><strong>검토 후보</strong><span id="visible-count">—</span></div>
          <div class="candidate-list" id="candidate-list" aria-live="polite"></div>
        </aside>

        <section class="review-panel" id="review-panel">
          <div class="empty-state"><span>W</span><strong>검토할 후보를 선택해 주세요.</strong><p>왼쪽 목록에서 질문을 고르면 전체 맥락과 출처를 확인할 수 있어요.</p></div>
        </section>
      </section>
    </main>

    <dialog id="export-dialog">
      <form method="dialog" class="dialog-card" id="export-form">
        <button class="dialog-close" value="cancel" aria-label="닫기">×</button>
        <p class="eyebrow">PUBLICATION DRAFT</p>
        <h2>승인 후보 내보내기</h2>
        <p>승인된 LOW 후보만 별도 승인 카탈로그와 Publication Plan 초안으로 생성합니다.</p>
        <label><span>대상 재고</span><select id="export-scope"><option value="ACTIVE">Active</option><option value="RESERVE">Reserve</option><option value="LONG_TERM">Long-term</option><option value="ALL">전체</option></select></label>
        <label><span>첫 게시 시각</span><input id="export-start" type="datetime-local" required /></label>
        <label><span>Pack당 질문 수</span><input id="export-daily" type="number" min="1" max="100" value="6" required /></label>
        <button class="primary-button" id="export-submit" value="default" type="submit">초안 파일 만들기</button>
      </form>
    </dialog>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <script src="/app.js" defer></script>
  </body>
</html>`;

export const editorialReviewCss = String.raw`:root {
  color-scheme: light;
  --ink: #0a1b22;
  --muted: #68808a;
  --line: #dce7eb;
  --paper: #f4f8f9;
  --white: #ffffff;
  --cyan: #18bdd0;
  --cyan-dark: #008ea7;
  --cyan-soft: #e5f8fb;
  --orange: #ff6534;
  --orange-soft: #fff0e9;
  --yellow-soft: #fff8d8;
  font-family: Inter, Pretendard, "Noto Sans KR", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.topbar { height: 76px; display: flex; align-items: center; gap: 24px; padding: 0 36px; background: var(--white); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 20; }
.brand { color: var(--ink); text-decoration: none; font-size: 28px; font-weight: 900; letter-spacing: -1.8px; }
.brand span { color: var(--cyan-dark); }
.topbar-copy { display: flex; gap: 12px; align-items: baseline; padding-left: 24px; border-left: 1px solid var(--line); }
.topbar-copy strong { font-size: 15px; }
.topbar-copy span { color: var(--muted); font-size: 13px; }
.reviewer-field { margin-left: auto; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; font-weight: 700; }
.reviewer-field input { width: 205px; height: 38px; border: 1px solid var(--line); border-radius: 20px; padding: 0 16px; color: var(--ink); background: #fbfdfe; }
main { width: min(1600px, 100%); margin: 0 auto; padding: 34px 36px 60px; }
.hero { min-height: 210px; padding: 34px 40px; display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; background: radial-gradient(circle at 70% 20%, rgba(24,189,208,.15), transparent 30%), var(--ink); color: var(--white); border-radius: 24px; overflow: hidden; }
.eyebrow { margin: 0 0 13px; color: var(--cyan); font-size: 12px; font-weight: 900; letter-spacing: 2.2px; }
.hero h1 { margin: 0; font-size: clamp(34px, 4vw, 56px); line-height: 1.08; letter-spacing: -3px; }
.hero-copy { margin: 18px 0 0; color: #aac1c9; font-size: 16px; }
.export-button { min-width: 220px; height: 58px; padding: 0 22px; border: 0; border-radius: 30px; background: var(--cyan); color: var(--ink); font-weight: 900; display: flex; align-items: center; justify-content: space-between; }
.export-button span { font-size: 22px; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
.metrics article { min-height: 96px; padding: 20px 22px; background: var(--white); border: 1px solid var(--line); border-radius: 16px; display: flex; flex-direction: column; justify-content: space-between; }
.metrics span { color: var(--muted); font-size: 12px; font-weight: 800; }
.metrics strong { font-size: 28px; letter-spacing: -1px; }
.metrics .approved { border-top: 4px solid var(--cyan); }
.metrics .changes { border-top: 4px solid #f0bd30; }
.metrics .rejected { border-top: 4px solid var(--orange); }
.workspace { min-height: 720px; display: grid; grid-template-columns: minmax(330px, 430px) minmax(0, 1fr); background: var(--white); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
.candidate-panel { min-width: 0; border-right: 1px solid var(--line); display: flex; flex-direction: column; }
.filters { padding: 22px; background: #fbfdfe; border-bottom: 1px solid var(--line); }
.search-field input { width: 100%; height: 46px; border: 1px solid var(--line); border-radius: 12px; padding: 0 15px; background: var(--white); }
.filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; }
.filter-grid label, .dialog-card label { display: flex; flex-direction: column; gap: 6px; color: var(--muted); font-size: 11px; font-weight: 800; }
select, .dialog-card input { width: 100%; height: 38px; border: 1px solid var(--line); border-radius: 9px; padding: 0 10px; background: var(--white); color: var(--ink); }
.list-heading { display: flex; justify-content: space-between; padding: 16px 22px 12px; font-size: 13px; }
.list-heading span { color: var(--muted); }
.candidate-list { overflow: auto; max-height: 720px; padding: 0 12px 18px; }
.candidate-item { width: 100%; text-align: left; border: 1px solid transparent; border-bottom-color: var(--line); background: transparent; padding: 17px 12px; display: grid; gap: 8px; }
.candidate-item:hover { background: #f7fbfc; }
.candidate-item.active { border-color: #81dcea; border-radius: 12px; background: var(--cyan-soft); }
.candidate-item .meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .5px; }
.candidate-item strong { font-size: 14px; line-height: 1.45; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #b7c6cc; }
.status-dot.APPROVED { background: var(--cyan); }
.status-dot.NEEDS_CHANGES { background: #f0bd30; }
.status-dot.REJECTED { background: var(--orange); }
.review-panel { padding: 36px 42px 48px; min-width: 0; }
.empty-state { min-height: 620px; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--muted); }
.empty-state span { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 20px; background: var(--cyan); color: var(--white); font-weight: 900; font-size: 30px; margin-bottom: 18px; }
.empty-state strong { color: var(--ink); }
.empty-state p { max-width: 380px; font-size: 14px; }
.detail-head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.detail-head h2 { margin: 7px 0 0; max-width: 760px; font-size: clamp(27px, 3vw, 42px); line-height: 1.18; letter-spacing: -2px; }
.detail-id { color: var(--cyan-dark); font-size: 12px; font-weight: 900; letter-spacing: 1.5px; }
.pill { align-self: flex-start; padding: 8px 12px; border: 1px solid var(--line); border-radius: 20px; color: var(--muted); font-size: 11px; font-weight: 900; white-space: nowrap; }
.context { margin: 24px 0; padding: 18px 20px; background: #f6fafb; border-left: 4px solid var(--cyan); color: #3d5660; line-height: 1.65; }
.choices { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 28px; }
.choice { min-height: 92px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; display: flex; align-items: center; gap: 14px; font-size: 17px; font-weight: 900; }
.choice span { width: 34px; height: 34px; display: grid; place-items: center; border: 2px solid var(--cyan); border-radius: 50%; color: var(--cyan-dark); }
.choice.b span { border-color: var(--orange); color: var(--orange); }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-card { padding: 20px; border: 1px solid var(--line); border-radius: 14px; }
.info-card h3 { margin: 0 0 14px; font-size: 13px; }
.kv { display: grid; grid-template-columns: 120px 1fr; gap: 9px; font-size: 12px; line-height: 1.5; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.sources { margin-top: 16px; }
.source-link { display: block; margin-top: 8px; padding: 11px 12px; border-radius: 9px; background: #f5f9fa; color: var(--cyan-dark); font-size: 12px; text-decoration: none; overflow-wrap: anywhere; }
.source-link:hover { text-decoration: underline; }
.review-form { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--line); }
.review-form h3 { margin: 0; font-size: 22px; }
.review-form > p { color: var(--muted); font-size: 13px; }
.check-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
.check-item { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1px solid var(--line); border-radius: 11px; font-size: 13px; font-weight: 800; }
.check-item input { width: 18px; height: 18px; accent-color: var(--cyan-dark); }
.note-label { display: grid; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 800; }
.note-label textarea { width: 100%; min-height: 100px; resize: vertical; border: 1px solid var(--line); border-radius: 12px; padding: 14px; color: var(--ink); }
.actions { display: flex; gap: 10px; margin-top: 16px; }
.actions button, .primary-button { min-height: 44px; border-radius: 22px; padding: 0 20px; font-weight: 900; border: 1px solid var(--line); background: var(--white); }
.actions .approve, .primary-button { border-color: var(--cyan); background: var(--cyan); color: var(--ink); }
.actions .changes { background: var(--yellow-soft); }
.actions .reject { border-color: #ffc9b9; background: var(--orange-soft); color: #b53610; }
dialog { width: min(520px, calc(100% - 28px)); border: 0; border-radius: 20px; padding: 0; box-shadow: 0 24px 80px rgba(10,27,34,.25); }
dialog::backdrop { background: rgba(5,21,28,.62); }
.dialog-card { padding: 30px; display: grid; gap: 16px; position: relative; }
.dialog-card h2 { margin: 0; font-size: 30px; letter-spacing: -1.2px; }
.dialog-card > p:not(.eyebrow) { margin: -4px 0 4px; color: var(--muted); line-height: 1.5; }
.dialog-close { position: absolute; top: 18px; right: 18px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #eef4f6; font-size: 20px; }
.primary-button { margin-top: 8px; min-height: 50px; }
.toast { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 20px); z-index: 50; max-width: min(600px, calc(100% - 30px)); padding: 14px 20px; border-radius: 12px; background: var(--ink); color: var(--white); font-size: 13px; font-weight: 800; opacity: 0; pointer-events: none; transition: .2s ease; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.error { background: #9c3215; }
@media (max-width: 900px) {
  .topbar { padding: 0 18px; }
  .topbar-copy { display: none; }
  .reviewer-field span { display: none; }
  .reviewer-field input { width: 155px; }
  main { padding: 18px 14px 40px; }
  .hero { min-height: 280px; padding: 28px; align-items: flex-start; flex-direction: column; }
  .export-button { width: 100%; }
  .metrics { grid-template-columns: 1fr 1fr; }
  .metrics article:first-child { grid-column: 1 / -1; }
  .workspace { grid-template-columns: 1fr; }
  .candidate-panel { border-right: 0; border-bottom: 1px solid var(--line); }
  .candidate-list { max-height: 420px; }
  .review-panel { padding: 28px 20px 38px; }
  .detail-grid, .choices, .check-grid { grid-template-columns: 1fr; }
}
`;

export const editorialReviewJs = String.raw`(() => {
  const elements = {
    reviewer: document.querySelector('#reviewer'),
    search: document.querySelector('#search'),
    scope: document.querySelector('#scope'),
    status: document.querySelector('#status'),
    category: document.querySelector('#category'),
    risk: document.querySelector('#risk'),
    list: document.querySelector('#candidate-list'),
    panel: document.querySelector('#review-panel'),
    visible: document.querySelector('#visible-count'),
    toast: document.querySelector('#toast'),
    dialog: document.querySelector('#export-dialog'),
    exportForm: document.querySelector('#export-form'),
  };
  let state = null;
  let selectedId = null;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '#';
    } catch { return '#'; }
  };
  const label = (value) => ({
    ACTIVE: 'ACTIVE', RESERVE: 'RESERVE', LONG_TERM: 'LONG-TERM',
    PENDING: '검토 대기', APPROVED: '승인', NEEDS_CHANGES: '수정 필요', REJECTED: '반려',
  })[value] || value;
  const showToast = (message, error = false) => {
    elements.toast.textContent = message;
    elements.toast.className = 'toast show' + (error ? ' error' : '');
    window.setTimeout(() => { elements.toast.className = 'toast'; }, 3200);
  };
  const request = async (url, options) => {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || '요청을 처리하지 못했습니다.');
    return body;
  };

  function renderMetrics() {
    document.querySelector('#metric-total').textContent = state.catalog.total;
    document.querySelector('#metric-pending').textContent = state.counts.PENDING;
    document.querySelector('#metric-approved').textContent = state.counts.APPROVED;
    document.querySelector('#metric-changes').textContent = state.counts.NEEDS_CHANGES;
    document.querySelector('#metric-rejected').textContent = state.counts.REJECTED;
  }

  function filteredCandidates() {
    const query = elements.search.value.trim().toLocaleLowerCase('ko');
    return state.candidates.filter((candidate) => {
      const candidateStatus = candidate.decision?.status || 'PENDING';
      return (elements.scope.value === 'ALL' || candidate.inventoryScope === elements.scope.value)
        && (elements.status.value === 'ALL' || candidateStatus === elements.status.value)
        && (elements.category.value === 'ALL' || candidate.category === elements.category.value)
        && (elements.risk.value === 'ALL' || candidate.riskLevel === elements.risk.value)
        && (!query || (candidate.candidateId + ' ' + candidate.question + ' ' + candidate.context).toLocaleLowerCase('ko').includes(query));
    });
  }

  function renderList() {
    const candidates = filteredCandidates();
    elements.visible.textContent = candidates.length + ' / ' + state.catalog.total;
    elements.list.innerHTML = candidates.map((candidate) => {
      const status = candidate.decision?.status || 'PENDING';
      return '<button class="candidate-item ' + (selectedId === candidate.candidateId ? 'active' : '') + '" data-id="' + escapeHtml(candidate.candidateId) + '">' +
        '<span class="meta"><i class="status-dot ' + status + '"></i>' + escapeHtml(candidate.candidateId) + ' · ' + label(candidate.inventoryScope) + ' · ' + escapeHtml(candidate.category) + '</span>' +
        '<strong>' + escapeHtml(candidate.question) + '</strong></button>';
    }).join('') || '<div class="empty-state"><strong>조건에 맞는 후보가 없습니다.</strong></div>';
    elements.list.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', () => { selectedId = button.dataset.id; renderList(); renderDetail(); });
    });
  }

  function renderDetail() {
    const candidate = state.candidates.find((item) => item.candidateId === selectedId);
    if (!candidate) {
      elements.panel.innerHTML = '<div class="empty-state"><span>W</span><strong>검토할 후보를 선택해 주세요.</strong><p>왼쪽 목록에서 질문을 고르면 전체 맥락과 출처를 확인할 수 있어요.</p></div>';
      return;
    }
    const decision = candidate.decision || { status: 'PENDING', note: '', checks: {} };
    const sources = candidate.sources.length ? candidate.sources.map((source) =>
      '<a class="source-link" href="' + safeUrl(source.url) + '" target="_blank" rel="noreferrer">' +
      '<strong>' + escapeHtml(source.kind) + '</strong> · ' + escapeHtml(source.title || source.id) + ' ↗</a>'
    ).join('') : '<p>연결된 출처 없음 — 주관형 Evergreen 후보</p>';
    const check = (name, title) => '<label class="check-item"><input type="checkbox" name="' + name + '" ' + (decision.checks?.[name] ? 'checked' : '') + ' />' + title + '</label>';
    elements.panel.innerHTML =
      '<div class="detail-head"><div><span class="detail-id">' + escapeHtml(candidate.candidateId) + ' · ' + label(candidate.inventoryScope) + '</span><h2>' + escapeHtml(candidate.question) + '</h2></div><span class="pill">' + escapeHtml(candidate.riskLevel) + ' · ' + escapeHtml(candidate.category) + '</span></div>' +
      '<p class="context">' + escapeHtml(candidate.context) + '</p>' +
      '<div class="choices"><div class="choice"><span>A</span>' + escapeHtml(candidate.choices[0].label) + '</div><div class="choice b"><span>B</span>' + escapeHtml(candidate.choices[1].label) + '</div></div>' +
      '<div class="detail-grid"><article class="info-card"><h3>후보 정보</h3><dl class="kv"><dt>편집 영역</dt><dd>' + escapeHtml(candidate.editorialArea) + '</dd><dt>관심사</dt><dd>' + escapeHtml(candidate.interestCardCodes.join(', ')) + '</dd><dt>발견 경로</dt><dd>' + escapeHtml(candidate.sourceProfile.discoveryLead) + '</dd><dt>출처 조건</dt><dd>' + escapeHtml(candidate.sourceProfile.sourceRequirement) + '</dd><dt>자동 검증</dt><dd>' + escapeHtml(candidate.automatedReview.status) + '</dd></dl></article>' +
      '<article class="info-card sources"><h3>출처와 발견 신호</h3>' + sources + '</article></div>' +
      '<form class="review-form" id="decision-form"><h3>사람 편집 검수</h3><p>승인은 네 항목을 모두 직접 확인한 뒤에만 저장됩니다. 현재 상태: <strong>' + label(decision.status) + '</strong></p>' +
      '<div class="check-grid">' + check('binaryFit', '질문이 명확한 A/B 선택인가') + check('choiceParity', 'A/B 선택지가 대등한가') + check('duplicateReview', '기존 질문과 의미가 겹치지 않는가') + check('sourceReview', '출처와 주제 연결이 적절한가') + '</div>' +
      '<label class="note-label">검토 메모<textarea id="decision-note" maxlength="2000" placeholder="수정이 필요한 이유나 승인 근거를 남겨 주세요.">' + escapeHtml(decision.note) + '</textarea></label>' +
      '<div class="actions"><button class="approve" type="button" data-status="APPROVED">승인</button><button class="changes" type="button" data-status="NEEDS_CHANGES">수정 필요</button><button class="reject" type="button" data-status="REJECTED">반려</button></div></form>';
    elements.panel.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => saveDecision(candidate, button.dataset.status)));
  }

  async function saveDecision(candidate, status) {
    const form = document.querySelector('#decision-form');
    const reviewedBy = elements.reviewer.value.trim();
    if (!reviewedBy) return showToast('검토자 이름을 입력해 주세요.', true);
    const checks = {};
    ['binaryFit', 'choiceParity', 'duplicateReview', 'sourceReview'].forEach((name) => { checks[name] = form.elements[name].checked; });
    try {
      await request('/api/decisions/' + encodeURIComponent(candidate.candidateId), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, note: document.querySelector('#decision-note').value, reviewedBy, checks }),
      });
      await loadState(candidate.candidateId);
      showToast(candidate.candidateId + ' · ' + label(status) + ' 결정이 저장됐습니다.');
    } catch (error) { showToast(error.message, true); }
  }

  async function loadState(keepSelected) {
    state = await request('/api/state');
    const categories = [...new Set(state.candidates.map((candidate) => candidate.category))].sort();
    const currentCategory = elements.category.value;
    elements.category.innerHTML = '<option value="ALL">전체 범주</option>' + categories.map((category) => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('');
    if (categories.includes(currentCategory)) elements.category.value = currentCategory;
    selectedId = keepSelected || selectedId;
    renderMetrics(); renderList(); if (selectedId) renderDetail();
  }

  function applyFilters() {
    const visible = filteredCandidates();
    if (!visible.some((candidate) => candidate.candidateId === selectedId)) {
      selectedId = visible[0]?.candidateId || null;
    }
    renderList();
    renderDetail();
  }

  ['search', 'scope', 'status', 'category', 'risk'].forEach((name) => elements[name].addEventListener('input', applyFilters));
  document.querySelector('#open-export').addEventListener('click', () => {
    document.querySelector('#export-scope').value = elements.scope.value === 'ALL' ? 'ACTIVE' : elements.scope.value;
    const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(10, 0, 0, 0);
    document.querySelector('#export-start').value = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0') + 'T10:00';
    elements.dialog.showModal();
  });
  elements.exportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const reviewedBy = elements.reviewer.value.trim();
    if (!reviewedBy) return showToast('검토자 이름을 입력해 주세요.', true);
    const payload = {
      scope: document.querySelector('#export-scope').value,
      startAt: new Date(document.querySelector('#export-start').value).toISOString(),
      dailyTarget: Number(document.querySelector('#export-daily').value), reviewedBy, overwrite: false,
    };
    try {
      let result;
      try { result = await request('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
      catch (error) {
        if (!error.message.includes('already exists') || !window.confirm('기존 초안을 새 승인 결과로 덮어쓸까요?')) throw error;
        payload.overwrite = true;
        result = await request('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      }
      elements.dialog.close();
      showToast(result.count + '개 후보를 ' + result.packs + '개 Pack 계획으로 내보냈습니다.');
    } catch (error) { showToast(error.message, true); }
  });

  loadState().catch((error) => showToast(error.message, true));
})();`;
