/* COSMOA · AI 도구함 — 목록 · 검색 · 권한 · 편집 · 저장 */
(function () {
  "use strict";

  // ---------- 상수 ----------
  var STORE_KEY = "cosmoa.data.v2"; // 기본 데이터 구조가 바뀌면 숫자를 올리세요 (브라우저 저장본 초기화)
  var ROLE_KEY = "cosmoa.role.v1";
  var PRICES = ["무료", "무료+유료", "유료", "확인 필요"];
  var PRICE_CLASS = { "무료": "free", "무료+유료": "freemium", "유료": "paid", "확인 필요": "unknown" };
  var ROLE_LABEL = { viewer: "보기 전용", member: "조원", admin: "관리자" };

  // ---------- 상태 ----------
  var state = {
    services: [],        // { id, name, fields[], intro, price, url, pros, cons, use, howto, priceDetail }
    notes: {},           // id -> [{ by, text, at }]
    role: { role: "viewer", name: "" },
    filter: { field: "", price: "", triedOnly: false, q: "" },
    drawer: { id: null, mode: "closed", returnFocus: null }, // mode: closed | view | edit | new
    armedDelete: null,   // { key, timer }
    typing: false,
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 유틸 ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function uid() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || uid(); }
  function groupOf(field) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].fields.indexOf(field) >= 0) return GROUPS[i];
    return null;
  }
  function groupOfService(s) { return groupOf(s.fields[0]) || GROUPS[0]; }
  function hexA(hex, a) {
    var h = hex.replace("#", "");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function initial(name) {
    var m = String(name).trim().match(/[A-Za-z0-9가-힣]/);
    return m ? m[0].toUpperCase() : "?";
  }
  function notesOf(id) { return state.notes[id] || []; }
  function canEdit() { return state.role.role === "member" || state.role.role === "admin"; }
  function isAdmin() { return state.role.role === "admin"; }
  function nl(s) { return esc(s); } // white-space: pre-line 로 줄바꿈 처리
  function validUrl(u) { return !u || /^https?:\/\/\S+$/i.test(u); }

  // ---------- 데이터 로드 · 저장 ----------
  function fromRaw() {
    var services = [], notes = {};
    RAW.forEach(function (r) {
      var id = slug(r[0]);
      services.push({
        id: id, name: r[0], fields: String(r[1]).split("|").map(function (f) { return f.trim(); }).filter(Boolean),
        intro: r[2] || "", price: PRICES.indexOf(r[3]) >= 0 ? r[3] : "확인 필요", url: r[4] || "",
        pros: r[5] || "", cons: r[6] || "", use: r[7] || "", howto: r[8] || "", priceDetail: r[9] || "", logo: r[10] || ""
      });
      var n = NOTES[r[0]];
      if (n && n.length) notes[id] = n.map(function (x) { return { by: x.by, text: x.text, at: 0 }; });
    });
    return { services: services, notes: notes };
  }
  function load() {
    var base = fromRaw();
    state.services = base.services;
    state.notes = base.notes;
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.services) { state.services = saved.services; state.notes = saved.notes || {}; }
    } catch (e) { /* 저장된 값이 깨졌으면 기본 데이터 사용 */ }
    try {
      var role = JSON.parse(localStorage.getItem(ROLE_KEY) || "null");
      if (role && ROLE_LABEL[role.role]) state.role = role;
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ services: state.services, notes: state.notes })); }
    catch (e) { toast("이 브라우저에는 저장할 수 없어요"); }
  }
  function saveRole() {
    try { localStorage.setItem(ROLE_KEY, JSON.stringify(state.role)); } catch (e) { /* ignore */ }
  }

  // ---------- 토스트 ----------
  var toastTimer = null;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 200);
    }, 2200);
  }

  // ---------- 필터링 ----------
  function matches(s) {
    var f = state.filter;
    if (f.field && s.fields.indexOf(f.field) < 0) return false;
    if (f.price && s.price !== f.price) return false;
    if (f.triedOnly && notesOf(s.id).length === 0) return false;
    if (f.q) {
      var hay = [s.name, s.intro, s.fields.join(" "), s.pros, s.cons, s.use, s.howto, groupOfService(s).name]
        .concat(notesOf(s.id).map(function (n) { return n.text; }))
        .join("\n").toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }
  function visibleServices() {
    return state.services.filter(matches).sort(function (a, b) {
      var na = notesOf(a.id).length > 0 ? 1 : 0, nb = notesOf(b.id).length > 0 ? 1 : 0;
      if (na !== nb) return nb - na;
      return a.name.localeCompare(b.name, "ko");
    });
  }
  function countField(field) {
    return state.services.filter(function (s) { return s.fields.indexOf(field) >= 0; }).length;
  }

  // ---------- 렌더: 사이드바 ----------
  function renderNav() {
    var total = state.services.length;
    var html = '<button type="button" class="nav-item" data-field="" aria-pressed="' + (state.filter.field === "") + '">' +
      '<span class="nav-dot" style="background:var(--blue)"></span><span class="nav-label">전체</span><span class="nav-count">' + total + '</span></button>';
    GROUPS.forEach(function (g) {
      html += '<div class="nav-group">' + esc(g.name) + '</div>';
      g.fields.forEach(function (f) {
        var c = countField(f);
        html += '<button type="button" class="nav-item' + (c === 0 ? " empty-field" : "") + '" data-field="' + esc(f) + '" aria-pressed="' + (state.filter.field === f) + '">' +
          '<span class="nav-dot" style="background:' + g.color + '"></span><span class="nav-label">' + esc(f) + '</span><span class="nav-count">' + c + '</span></button>';
      });
    });
    $("nav").innerHTML = html;
  }

  function roleDesc(r) {
    if (r === "admin") return "서비스 추가·수정·삭제와 모든 소감 정리를 할 수 있어요.";
    if (r === "member") return "서비스를 추가·수정하고 내 소감을 남길 수 있어요.";
    return "목록 보기와 검색만 할 수 있어요. 편집하려면 권한 코드가 필요해요.";
  }
  function renderRole() {
    var r = state.role.role, label = ROLE_LABEL[r] + (state.role.name ? " · " + state.role.name : "");
    $("roleCard").innerHTML =
      '<div class="role-name"><span class="role-dot ' + r + '"></span>' + esc(label) + '</div>' +
      '<div class="role-desc">' + roleDesc(r) + '</div>' +
      (r === "viewer"
        ? '<button type="button" class="btn primary" data-act="get-role">편집 권한 받기</button>'
        : '<button type="button" class="btn line" data-act="drop-role">보기 전용으로 전환</button>');
    $("roleChip").innerHTML = '<span class="role-dot ' + r + '"></span>' + esc(label);
    $("addBtn").hidden = !canEdit();
  }

  // ---------- 렌더: 통계 · 목록 ----------
  function renderStats() {
    var tried = state.services.filter(function (s) { return notesOf(s.id).length > 0; }).length;
    var noteCount = Object.keys(state.notes).reduce(function (n, k) { return n + state.notes[k].length; }, 0);
    $("stats").innerHTML =
      '<div class="stat"><span class="stat-label">정리한 서비스</span><span class="stat-num">' + state.services.length + '</span></div>' +
      '<div class="stat"><span class="stat-label">직접 써본 서비스</span><span class="stat-num blue">' + tried + '</span></div>' +
      '<div class="stat"><span class="stat-label">모인 소감</span><span class="stat-num">' + noteCount + '</span></div>';
  }

  function logoSrc(logo) {
    if (!logo) return "";
    return /^(https?:)?\/\/|^data:|\//.test(logo) ? logo : "img/logos/" + logo;
  }
  function iconHtml(s, big) {
    var g = groupOfService(s), src = logoSrc(s.logo);
    return '<span class="icon' + (src ? " has-logo" : "") + '" style="background:' + hexA(g.color, 0.14) + ';color:' + g.color + '" aria-hidden="true">' +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.parentNode.classList.remove(\'has-logo\');this.remove()">' : "") +
      '<span class="icon-letter">' + esc(initial(s.name)) + '</span></span>';
  }
  function badgeHtml(price) {
    return '<span class="badge ' + PRICE_CLASS[price] + '">' + esc(price) + '</span>';
  }

  function renderList() {
    var list = visibleServices();
    $("listTitle").textContent = state.filter.field || "전체";
    $("listCount").textContent = list.length + "개";

    if (state.services.length === 0) {
      $("list").innerHTML = '<div class="empty"><p>아직 등록된 서비스가 없어요.</p>' +
        (canEdit() ? '<button type="button" class="btn primary" data-act="add">첫 서비스 추가하기</button>' : "") + "</div>";
      return;
    }
    if (list.length === 0) {
      $("list").innerHTML = '<div class="empty"><p>조건에 맞는 서비스가 없어요.<br>검색어를 바꾸거나 필터를 풀어 보세요.</p>' +
        '<button type="button" class="btn soft" data-act="reset-filter">필터 초기화</button></div>';
      return;
    }
    $("list").innerHTML = list.map(function (s) {
      var n = notesOf(s.id).length;
      return '<button type="button" class="row" data-id="' + esc(s.id) + '">' +
        iconHtml(s) +
        '<span class="row-body">' +
          '<span class="row-top"><span class="row-name">' + esc(s.name) + '</span>' +
            (n ? '<span class="tag tried">써봄 ' + n + '</span>' : "") +
            (!s.intro ? '<span class="tag wip">정리 중</span>' : "") +
          '</span>' +
          (s.intro ? '<span class="row-desc">' + esc(s.intro) + '</span>' : "") +
          '<span class="row-fields">' + s.fields.map(esc).join(" · ") + '</span>' +
        '</span>' +
        '<span class="row-right">' + badgeHtml(s.price) + '</span>' +
      '</button>';
    }).join("");
  }

  function renderAll() {
    renderNav(); renderRole(); renderStats(); renderList();
  }

  // ---------- 드로어 ----------
  function findService(id) {
    for (var i = 0; i < state.services.length; i++) if (state.services[i].id === id) return state.services[i];
    return null;
  }

  function openDrawer(mode, id, trigger) {
    state.drawer.mode = mode;
    state.drawer.id = id || null;
    state.drawer.returnFocus = trigger || document.activeElement;
    state.typing = false;
    renderDrawer();
    var d = $("drawer"), sc = $("drawerScrim");
    d.hidden = false; sc.hidden = false;
    d.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { d.classList.add("open"); sc.classList.add("open"); });
    setTimeout(function () {
      var first = d.querySelector("[data-autofocus]") || d.querySelector("button, input, textarea, a");
      if (first) first.focus();
    }, 60);
  }
  function closeDrawer() {
    if (state.drawer.mode === "closed") return;
    var d = $("drawer"), sc = $("drawerScrim");
    d.classList.remove("open"); sc.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    disarmDelete();
    var back = state.drawer.returnFocus;
    state.drawer = { id: null, mode: "closed", returnFocus: null };
    setTimeout(function () {
      d.hidden = true; sc.hidden = true;
      if (back && document.body.contains(back)) back.focus();
    }, 250);
  }

  function renderDrawer() {
    var m = state.drawer.mode;
    if (m === "view") renderDetail(findService(state.drawer.id));
    else if (m === "edit") renderForm(findService(state.drawer.id));
    else if (m === "new") renderForm(null);
  }

  // ---- 상세 내용 서식 ----
  // 줄 단위 텍스트를 목록으로. "1." "1)" 로 시작하면 번호 목록, 그 외 여러 줄이면 점 목록, 한 줄이면 문단.
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      var label = u.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (label.length > 42) label = label.slice(0, 40) + "…";
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
  }
  function stripMarker(line) {
    return line.replace(/^(\d+[.)]\s*|[-•·*]\s+|→\s*)/, "").trim();
  }
  function textBlock(text) {
    var lines = String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return "";
    if (lines.length === 1) return '<p>' + linkify(esc(stripMarker(lines[0]))) + '</p>';
    var numbered = lines.filter(function (l) { return /^\d+[.)]/.test(l); }).length >= Math.ceil(lines.length / 2);
    var tag = numbered ? "ol" : "ul";
    return '<' + tag + '>' + lines.map(function (l) { return '<li>' + linkify(esc(stripMarker(l))) + '</li>'; }).join("") + '</' + tag + '>';
  }
  function section(title, body, cls, ico) {
    if (!body) return "";
    return '<section class="sec ' + (cls || "") + '"><div class="sec-title">' +
      (ico ? '<span class="sec-ico ' + ico[0] + '" aria-hidden="true">' + ico[1] + '</span>' : "") +
      esc(title) + '</div>' + body + '</section>';
  }
  // 요금 상세: "플랜: 금액" 줄은 표처럼, 주소·확인일·비고는 아래 작은 글씨로
  function priceBlock(s) {
    var lines = String(s.priceDetail || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var rows = [], meta = [], note = [];
    lines.forEach(function (l) {
      if (/^https?:\/\//.test(l) || /^확인일/.test(l)) { meta.push(l); return; }
      var m = l.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
      if (m && /[\d$€₩원달러무료문의]/.test(m[2])) rows.push([m[1].trim(), m[2].trim()]);
      else note.push(l);
    });
    var html = '<div class="price-head">' + badgeHtml(s.price) + (s.price === "확인 필요" ? '<span class="muted">요금은 공식 사이트에서 확인해 주세요</span>' : "") + '</div>';
    if (rows.length) html += '<div class="price-rows">' + rows.map(function (r) {
      return '<div class="price-row"><span class="plan">' + esc(r[0]) + '</span><span class="amount">' + esc(r[1]) + '</span></div>';
    }).join("") + '</div>';
    if (note.length) html += '<p>' + note.map(function (l) { return linkify(esc(stripMarker(l))); }).join("<br>") + '</p>';
    if (meta.length) html += '<div class="price-meta">' + meta.map(function (l) { return '<span>' + linkify(esc(l)) + '</span>'; }).join("") + '</div>';
    return html;
  }

  function renderDetail(s) {
    if (!s) { closeDrawer(); return; }
    var g = groupOfService(s), notes = notesOf(s.id), me = state.role.name;
    var mine = canEdit() && me ? notes.filter(function (n) { return n.by === me; })[0] : null;

    var html = '<div class="drawer-actions">';
    if (canEdit()) html += '<button type="button" class="btn soft sm" data-act="edit">수정</button>';
    if (isAdmin()) html += '<button type="button" class="btn danger sm" data-act="delete-service">삭제</button>';
    html += '<span class="spacer"></span><button type="button" class="btn ghost" data-act="close" aria-label="닫기">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>';

    // 머리: 아이콘 · 이름 · 요금 배지 · 그룹 · 분야 칩
    html += '<div class="detail-head">' + iconHtml(s, true) +
      '<div class="detail-head-body">' +
        '<div class="detail-title-row"><h2 class="drawer-title" id="drawerTitle">' + esc(s.name) + '</h2>' + badgeHtml(s.price) + '</div>' +
        '<div class="drawer-group">' + esc(g.name) + '</div>' +
        '<div class="chips">' + s.fields.map(function (f) { return '<span class="chip">' + esc(f) + '</span>'; }).join("") + '</div>' +
      '</div></div>';
    html += s.intro ? '<p class="drawer-intro">' + esc(s.intro) + '</p>' : '<p class="drawer-intro empty">한 줄 소개가 아직 없어요.</p>';

    // 본문 섹션
    html += '<div class="sections">';
    html += section("추천 용도", textBlock(s.use), "", ["info", "★"]);
    html += section("사용 방법", textBlock(s.howto), "", ["info", "?"]);
    html += '</div>';
    if (s.pros || s.cons) {
      html += '<div class="sections two">' +
        section("장점", textBlock(s.pros) || '<p class="muted">아직 없어요</p>', "good", ["good", "+"]) +
        section("아쉬운 점", textBlock(s.cons) || '<p class="muted">아직 없어요</p>', "bad", ["bad", "−"]) +
        '</div>';
    }
    html += '<div class="sections">' + section("요금", priceBlock(s), "", ["info", "₩"]) + '</div>';

    // 소감
    html += '<section class="sec plain"><div class="sec-title">직접 써본 소감 <span class="count">' + notes.length + '개</span></div>';
    if (notes.length) {
      html += '<div class="notes">' + notes.map(function (n, i) {
        var isMine = canEdit() && me && n.by === me;
        var canRemove = isMine || isAdmin();
        return '<div class="note' + (isMine ? " mine" : "") + '"><div class="note-head">' +
          '<span class="note-avatar" aria-hidden="true">' + esc(initial(n.by)) + '</span>' +
          '<span class="note-by">' + esc(n.by) + (isMine ? " (나)" : "") + '</span>' +
          (canRemove ? '<button type="button" class="btn danger sm" data-act="delete-note" data-index="' + i + '">지우기</button>' : "") +
          '</div><div class="note-text">' + nl(n.text) + '</div></div>';
      }).join("") + '</div>';
    } else {
      html += '<p class="muted" style="font-size:14px">아직 소감이 없어요. 첫 소감을 남겨 보세요.</p>';
    }
    if (canEdit()) {
      html += '<form class="note-form" data-form="note">' +
        '<textarea name="text" placeholder="써보니 어땠나요? 어떤 일에 썼는지, 좋았던 점과 아쉬운 점을 적어 주세요.">' + esc(mine ? mine.text : "") + '</textarea>' +
        '<button type="submit" class="btn primary">' + (mine ? "소감 고치기" : "소감 남기기") + '</button></form>';
    } else {
      html += '<div class="note-locked"><span>소감을 남기려면 편집 권한이 필요해요</span><button type="button" class="btn primary sm" data-act="get-role">권한 받기</button></div>';
    }
    html += '</section>';

    if (s.url) html += '<div class="drawer-foot"><a class="open-site" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + ' 사이트 열기</a></div>';
    $("drawerInner").innerHTML = html;
  }

  function renderForm(s) {
    var isNew = !s;
    var v = s || { name: "", fields: [], intro: "", price: "확인 필요", url: "", pros: "", cons: "", use: "", howto: "", priceDetail: "", logo: "" };
    if (!isNew && state.filter.field && isNew) v.fields = [state.filter.field];
    if (isNew && state.filter.field) v.fields = [state.filter.field];

    var html = '<form class="form" data-form="service" novalidate>' +
      '<div class="drawer-actions"><h2 class="form-title" id="drawerTitle">' + (isNew ? "서비스 추가" : "서비스 수정") + '</h2><span class="spacer"></span>' +
      '<button type="button" class="btn ghost" data-act="cancel-form" aria-label="닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>';

    html += '<div class="field"><label for="f-name">이름 <span class="req">*</span></label><input id="f-name" type="text" name="name" value="' + esc(v.name) + '" data-autofocus placeholder="예: Perplexity"></div>';

    html += '<div class="field"><label>분야 <span class="req">*</span><span class="opt">여러 개 선택 가능</span></label>';
    GROUPS.forEach(function (g) {
      html += '<div class="field-group"><div class="field-group-name"><span class="nav-dot" style="background:' + g.color + '"></span>' + esc(g.name) + '</div><div class="toggle-chips">' +
        g.fields.map(function (f) {
          return '<button type="button" class="toggle-chip" data-field-toggle="' + esc(f) + '" aria-pressed="' + (v.fields.indexOf(f) >= 0) + '">' + esc(f) + '</button>';
        }).join("") + '</div></div>';
    });
    html += '</div>';

    html += '<div class="field"><label for="f-intro">한 줄 소개</label><input id="f-intro" type="text" name="intro" value="' + esc(v.intro) + '" placeholder="무엇을 해 주는지 한 줄로"></div>';

    html += '<div class="field"><label>요금</label><div class="segment" data-price-seg>' +
      PRICES.map(function (p) { return '<button type="button" data-price-pick="' + esc(p) + '" aria-pressed="' + (v.price === p) + '">' + esc(p) + '</button>'; }).join("") +
      '</div></div>';
    html += '<div class="field"><label for="f-priceDetail">요금 상세 <span class="opt">선택</span></label><textarea id="f-priceDetail" name="priceDetail" placeholder="플랜별 가격, 확인한 날짜 등">' + esc(v.priceDetail) + '</textarea></div>';
    html += '<div class="field"><label for="f-url">주소</label><input id="f-url" type="url" name="url" value="' + esc(v.url) + '" placeholder="https://"></div>';
    html += '<div class="field"><label for="f-logo">로고 이미지 <span class="opt">선택 · img/logos/ 파일 이름 또는 이미지 주소</span></label><input id="f-logo" type="text" name="logo" value="' + esc(v.logo || "") + '" placeholder="예: figma.png 또는 https://…/logo.png"></div>';
    html += '<div class="field"><label for="f-howto">사용 방법 <span class="opt">선택</span></label><textarea id="f-howto" name="howto" placeholder="처음 쓰는 사람이 따라 할 순서">' + esc(v.howto) + '</textarea></div>';
    html += '<div class="field"><label for="f-pros">장점</label><textarea id="f-pros" name="pros">' + esc(v.pros) + '</textarea></div>';
    html += '<div class="field"><label for="f-cons">아쉬운 점</label><textarea id="f-cons" name="cons">' + esc(v.cons) + '</textarea></div>';
    html += '<div class="field"><label for="f-use">추천 용도</label><textarea id="f-use" name="use" placeholder="이런 일 할 때 쓰면 좋아요">' + esc(v.use) + '</textarea></div>';

    html += '<div class="form-error" data-error hidden></div>';
    html += '<div class="form-foot"><button type="button" class="btn line" data-act="cancel-form">취소</button><button type="submit" class="btn primary">' + (isNew ? "추가하기" : "저장하기") + '</button></div>';
    html += '</form>';
    $("drawerInner").innerHTML = html;
  }

  function readForm(form) {
    var fields = [];
    form.querySelectorAll("[data-field-toggle][aria-pressed='true']").forEach(function (b) { fields.push(b.getAttribute("data-field-toggle")); });
    var priceBtn = form.querySelector("[data-price-pick][aria-pressed='true']");
    var g = function (n) { return (form.elements[n] ? form.elements[n].value : "").trim(); };
    return {
      name: g("name"), fields: fields, intro: g("intro"), price: priceBtn ? priceBtn.getAttribute("data-price-pick") : "확인 필요",
      url: g("url"), pros: g("pros"), cons: g("cons"), use: g("use"), howto: g("howto"), priceDetail: g("priceDetail"), logo: g("logo")
    };
  }
  function showFormError(form, msg) {
    var el = form.querySelector("[data-error]");
    el.textContent = msg; el.hidden = !msg;
    if (msg) el.scrollIntoView({ block: "nearest" });
  }
  function submitService(form) {
    if (!canEdit()) { toast("편집 권한이 필요해요"); return; }
    var v = readForm(form), isNew = state.drawer.mode === "new", id = state.drawer.id;
    if (!v.name) return showFormError(form, "이름을 적어 주세요.");
    if (!v.fields.length) return showFormError(form, "분야를 하나 이상 골라 주세요.");
    if (!validUrl(v.url)) return showFormError(form, "주소는 https://로 시작해야 해요.");
    var dup = state.services.filter(function (s) { return s.name.toLowerCase() === v.name.toLowerCase() && s.id !== id; })[0];
    if (dup) return showFormError(form, "같은 이름의 서비스가 이미 있어요. 상세 패널에서 수정해 주세요.");

    if (isNew) {
      id = uid();
      v.id = id;
      state.services.push(v);
      save(); renderAll();
      toast("추가했어요");
    } else {
      var s = findService(id);
      Object.keys(v).forEach(function (k) { s[k] = v[k]; });
      save(); renderAll();
      toast("저장했어요");
    }
    state.drawer.mode = "view"; state.drawer.id = id;
    renderDrawer();
  }

  function submitNote(form) {
    if (!canEdit()) { toast("편집 권한이 필요해요"); return; }
    var text = form.elements.text.value.trim();
    if (!text) { toast("소감을 적어 주세요"); return; }
    var id = state.drawer.id, me = state.role.name || "조원";
    var list = state.notes[id] || (state.notes[id] = []);
    var mine = list.filter(function (n) { return n.by === me; })[0];
    if (mine) { mine.text = text; mine.at = Date.now(); toast("소감을 고쳤어요"); }
    else { list.push({ by: me, text: text, at: Date.now() }); toast("소감을 남겼어요"); }
    state.typing = false;
    save(); renderAll(); renderDrawer();
  }

  // ---------- 두 번 눌러 삭제 ----------
  function disarmDelete() {
    if (!state.armedDelete) return;
    clearTimeout(state.armedDelete.timer);
    var b = state.armedDelete.btn;
    if (b && document.body.contains(b)) { b.classList.remove("armed"); b.textContent = state.armedDelete.label; }
    state.armedDelete = null;
  }
  function armOrFire(btn, key, fire) {
    if (state.armedDelete && state.armedDelete.key === key) { disarmDelete(); fire(); return; }
    disarmDelete();
    var label = btn.textContent;
    btn.classList.add("armed"); btn.textContent = "한 번 더 누르면 삭제";
    state.armedDelete = { key: key, btn: btn, label: label, timer: setTimeout(disarmDelete, 3000) };
  }
  function deleteService(id) {
    if (!isAdmin()) return;
    state.services = state.services.filter(function (s) { return s.id !== id; });
    delete state.notes[id];
    save(); closeDrawer(); renderAll();
    toast("삭제했어요");
  }
  function deleteNote(id, index) {
    var list = state.notes[id] || [], n = list[index];
    if (!n) return;
    var me = state.role.name;
    if (!(isAdmin() || (canEdit() && me && n.by === me))) return;
    list.splice(index, 1);
    if (!list.length) delete state.notes[id];
    save(); renderAll(); renderDrawer();
    toast("소감을 지웠어요");
  }

  // ---------- 모달 ----------
  function openModal(html) {
    $("modal").innerHTML = html;
    $("modalWrap").hidden = false;
    setTimeout(function () {
      var first = $("modal").querySelector("[data-autofocus]") || $("modal").querySelector("input, button");
      if (first) first.focus();
    }, 30);
  }
  function closeModal() { $("modalWrap").hidden = true; }
  function permTable() {
    var r = state.role.role;
    var rows = [
      ["목록 보기 · 검색 · 필터", 1, 1, 1],
      ["서비스 추가 · 수정", 0, 1, 1],
      ["내 소감 쓰기 · 고치기 · 지우기", 0, 1, 1],
      ["서비스 삭제", 0, 0, 1],
      ["다른 사람 소감 삭제", 0, 0, 1],
    ];
    return '<table class="perm-table"><thead><tr><th>할 수 있는 일</th>' +
      '<th class="' + (r === "viewer" ? "on" : "") + '">보기 전용</th><th class="' + (r === "member" ? "on" : "") + '">조원</th><th class="' + (r === "admin" ? "on" : "") + '">관리자</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td>' + x[0] + '</td>' + [1, 2, 3].map(function (i) { return '<td>' + (x[i] ? '<span class="ok">●</span>' : "") + '</td>'; }).join("") + '</tr>';
      }).join("") + '</tbody></table>';
  }
  function openRoleInfo() {
    var r = state.role.role;
    openModal('<h2 class="modal-title" id="modalTitle">권한 안내</h2>' +
      '<div class="role-now"><span class="role-dot ' + r + '"></span>' + esc(ROLE_LABEL[r]) + (state.role.name ? '<span class="sub">· ' + esc(state.role.name) + '</span>' : "") + '</div>' +
      permTable() +
      '<div class="modal-foot">' +
      (r === "viewer"
        ? '<button type="button" class="btn line" data-act="close-modal">닫기</button><button type="button" class="btn primary" data-act="get-role">편집 권한 받기</button>'
        : '<button type="button" class="btn line" data-act="drop-role">보기 전용으로 전환</button><button type="button" class="btn primary" data-act="close-modal">확인</button>') +
      '</div>');
  }
  function openGetRole() {
    openModal('<form data-form="role" novalidate>' +
      '<h2 class="modal-title" id="modalTitle">편집 권한 받기</h2>' +
      '<p class="modal-desc" style="margin-top:6px">이름은 소감 작성자로 표시돼요. 권한 코드는 조장에게 받으세요.</p>' +
      '<div class="field" style="margin-top:16px"><label for="r-name">이름</label><input id="r-name" type="text" name="name" value="' + esc(state.role.name) + '" placeholder="예: 민지" data-autofocus autocomplete="off"></div>' +
      '<div class="field" style="margin-top:12px"><label for="r-code">권한 코드</label><input id="r-code" type="password" name="code" placeholder="조장에게 받은 코드" autocomplete="off"></div>' +
      '<div class="form-error" data-error hidden style="margin-top:10px"></div>' +
      '<div style="margin-top:16px">' + permTable() + '</div>' +
      '<div class="modal-foot" style="margin-top:16px"><button type="button" class="btn line" data-act="close-modal">취소</button><button type="submit" class="btn primary">확인</button></div>' +
      '</form>');
  }
  function submitRole(form) {
    var name = form.elements.name.value.trim(), code = form.elements.code.value.trim();
    var err = form.querySelector("[data-error]");
    if (!name) { err.textContent = "이름을 적어 주세요."; err.hidden = false; return; }
    var role = code === CONFIG.ADMIN_CODE ? "admin" : code === CONFIG.MEMBER_CODE ? "member" : null;
    if (!role) { err.textContent = "코드가 맞지 않아요. 조장에게 다시 확인해 주세요."; err.hidden = false; return; }
    state.role = { role: role, name: name };
    saveRole(); closeModal(); renderAll();
    if (state.drawer.mode === "view") renderDrawer();
    toast(ROLE_LABEL[role] + " 권한으로 바꿨어요");
  }
  function dropRole() {
    state.role = { role: "viewer", name: state.role.name };
    saveRole(); closeModal(); renderAll();
    if (state.drawer.mode === "edit" || state.drawer.mode === "new") { state.drawer.mode = state.drawer.id ? "view" : "closed"; }
    if (state.drawer.mode === "view") renderDrawer(); else if (state.drawer.mode === "closed") closeDrawer();
    toast("보기 전용으로 바꿨어요");
  }

  // ---------- 필터 UI ----------
  function setField(f) {
    state.filter.field = f;
    renderNav(); renderList();
    var active = $("nav").querySelector("[aria-pressed='true']");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function setPrice(p) {
    state.filter.price = p;
    $("priceSeg").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-price") === p)); });
    renderList();
  }
  function resetFilter() {
    state.filter = { field: "", price: "", triedOnly: false, q: "" };
    $("searchInput").value = "";
    $("triedOnly").checked = false;
    setPrice("");
    setField("");
  }

  // ---------- 이벤트 ----------
  function handleAction(act, el, ev) {
    switch (act) {
      case "get-role": closeModal(); openGetRole(); break;
      case "drop-role": dropRole(); break;
      case "close-modal": closeModal(); break;
      case "add": openDrawer("new", null, el); break;
      case "reset-filter": resetFilter(); break;
      case "close": closeDrawer(); break;
      case "edit": if (canEdit()) { state.drawer.mode = "edit"; disarmDelete(); renderDrawer(); } break;
      case "cancel-form":
        if (state.drawer.mode === "edit") { state.drawer.mode = "view"; renderDrawer(); }
        else closeDrawer();
        break;
      case "delete-service":
        armOrFire(el, "service:" + state.drawer.id, function () { deleteService(state.drawer.id); });
        break;
      case "delete-note":
        (function () {
          var idx = Number(el.getAttribute("data-index")), id = state.drawer.id;
          armOrFire(el, "note:" + id + ":" + idx, function () { deleteNote(id, idx); });
        })();
        break;
    }
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target.closest("[data-act], [data-field], .row, [data-field-toggle], [data-price-pick], #roleChip, #addBtn, #logoLink, #modalScrim, #drawerScrim") : null;
    if (!t) { return; }
    if (t.id === "modalScrim") { closeModal(); return; }
    if (t.id === "drawerScrim") { closeDrawer(); return; }
    if (t.id === "logoLink") { ev.preventDefault(); resetFilter(); window.scrollTo({ top: 0 }); return; }
    if (t.id === "roleChip") { openRoleInfo(); return; }
    if (t.id === "addBtn") { openDrawer("new", null, t); return; }
    if (t.hasAttribute("data-act")) { handleAction(t.getAttribute("data-act"), t, ev); return; }
    if (t.hasAttribute("data-field") && t.closest("#nav")) { setField(t.getAttribute("data-field")); return; }
    if (t.classList.contains("row")) { openDrawer("view", t.getAttribute("data-id"), t); return; }
    if (t.hasAttribute("data-field-toggle")) { t.setAttribute("aria-pressed", String(t.getAttribute("aria-pressed") !== "true")); return; }
    if (t.hasAttribute("data-price-pick")) {
      t.parentNode.querySelectorAll("[data-price-pick]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); });
      return;
    }
  });

  document.addEventListener("submit", function (ev) {
    var f = ev.target;
    if (!f.hasAttribute("data-form")) return;
    ev.preventDefault();
    var kind = f.getAttribute("data-form");
    if (kind === "service") submitService(f);
    else if (kind === "note") submitNote(f);
    else if (kind === "role") submitRole(f);
  });

  document.addEventListener("input", function (ev) {
    if (ev.target.closest && ev.target.closest("#drawer")) state.typing = true;
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      if (!$("modalWrap").hidden) { closeModal(); return; }
      if (state.armedDelete) { disarmDelete(); return; }
      if (state.drawer.mode !== "closed") closeDrawer();
    }
    if (ev.key === "/" && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      ev.preventDefault(); $("searchInput").focus();
    }
  });

  var searchTimer = null;
  $("searchInput").addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value.trim();
    searchTimer = setTimeout(function () { state.filter.q = v; renderList(); }, 120);
  });
  $("priceSeg").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-price]");
    if (b) setPrice(b.getAttribute("data-price"));
  });
  $("triedOnly").addEventListener("change", function () { state.filter.triedOnly = this.checked; renderList(); });

  // 다른 탭에서 바뀐 내용 반영 (입력 중이면 드로어는 그대로 둠)
  window.addEventListener("storage", function (ev) {
    if (ev.key !== STORE_KEY) return;
    load(); renderAll();
    if (state.drawer.mode === "view" && !state.typing) renderDrawer();
  });

  // ---------- 시작 ----------
  load();
  renderAll();
})();
