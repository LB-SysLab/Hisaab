/* Hisaab app: screens, forms and storage. Money rules are in core.js. */
(function () {
  "use strict";
  var KEY = "hisaab-data-v1";
  var LANG_KEY = "hisaab-lang";
  var UPI_PLACEHOLDER = "sampleshop@demo";

  var T = HISAAB_WORDS, LOCALE = HISAAB_LOCALE;

  /* ---------- Example shop: the brief's sample file (fictional names and numbers) ---------- */
  function exampleData() {
    if (!state) state = { shop: { name: "", upi: UPI_PLACEHOLDER }, customers: [] };
    var d = parseShop(HISAAB_SAMPLE);
    return { shop: d.shop, customers: d.customers, example: true };
  }

  /* ---------- Helpers ---------- */
  var seqCounter = 0;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ""; }); }
  function fmt(n) { var v = Math.round(Number(n) * 100) / 100; return v.toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function plain(n) { var v = Math.round(Number(n) * 100) / 100; return String(v); }
  // The customer name as shown in the chosen language (saved name stays as typed)
  function shownName(c) { return Core.shownIn(c.name, c.nameEn, lang, "name"); }
  // Shop name and notes as shown in the chosen language (saved text stays as typed)
  function shownText(e) { return Core.shownIn(e.note, e.noteEn, lang, "text"); }
  function shownShop() { return Core.shownIn(state.shop.name || "", state.shop.nameEn, lang, "shop"); }
  // English letters kept beside text typed in Telugu or Hindi, so English mode can show it in English
  function englishOf(el, kind) { return Core.scriptOf(el.value) ? Core.toEnglish(el.value.trim().replace(/\s+/g, " "), kind, tlTyped[el.id]) : ""; }
  function initials(n) { return String(n || "?").trim().split(/\s+/).map(function (p) { return p[0] || ""; }).join("").slice(0, 2).toUpperCase() || "?"; }
  function prettyPhone(p) { p = String(p || ""); return p.length === 10 ? p.slice(0, 5) + " " + p.slice(5) : p; }
  var Core = HisaabCore;
  var pad = Core.pad, isoOf = Core.isoOf, parseISO = Core.parseISO;
  // Today's date, honouring ?today=YYYY-MM-DD
  var TODAY = Core.todayFrom(location.search);
  var TODAY_ISO = isoOf(TODAY);
  function daysSince(iso) { return Core.daysBetween(iso, TODAY); }
  function prettyDate(iso) {
    var d = parseISO(iso); if (!d) return iso || "";
    try { return d.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return iso; }
  }

  /* ---------- Storage ---------- */
  var state;
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.customers)) return prepare(d); } } catch (e) {}
    return prepare(exampleData());
  }
  function prepare(d) {
    d.shop = d.shop || { name: "", upi: "" };
    if (!d.shop.upi || d.shop.upi === "FILL-IN@upi") d.shop.upi = UPI_PLACEHOLDER;
    d.customers.forEach(function (c) {
      c.entries = Array.isArray(c.entries) ? c.entries : [];
      c.entries.forEach(function (e) { if (!e.id) e.id = uid(); if (e.seq == null) e.seq = ++seqCounter; else seqCounter = Math.max(seqCounter, e.seq); });
    });
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { toast(T[lang].storageFull); return false; }
  }

  var lang = "en";
  try { var savedLang = localStorage.getItem(LANG_KEY); if (T[savedLang]) lang = savedLang; } catch (e) {}
  state = load();
  var filter = "all", query = "";

  /* ---------- Money logic: balances are always worked out from entries ---------- */
  function summarise(c) { return Core.summarise(c, TODAY); }
  function sortedEntries(c) { return Core.sortedEntries(c); }
  function findCust(phone) { for (var i = 0; i < state.customers.length; i++) if (state.customers[i].phone === phone) return state.customers[i]; return null; }
  function upiOk() { return state.shop.upi && state.shop.upi !== UPI_PLACEHOLDER; }

  function waLink(c, s) {
    var t = T[lang];
    var upi = state.shop.upi || UPI_PLACEHOLDER;
    var link = "upi://pay?pa=" + upi + "&pn=" + encodeURIComponent(state.shop.name || "Shop") + "&am=" + plain(s.bal) + "&cu=INR";
    var msg = fill(t.msg, { name: shownName(c), shop: shownShop() || t.app, amt: plain(s.bal), upi: fill(t.msgUpi, { link: link }) });
    return "https://wa.me/91" + c.phone + "?text=" + encodeURIComponent(msg);
  }
  var waIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3Z"/></svg>';

  function statusTag(s) {
    var t = T[lang];
    if (s.bal < 0) return '<span class="tag ok">' + t.advance + "</span>";
    if (s.bal === 0) return '<span class="tag ok">' + t.clear + "</span>";
    var txt;
    if (!s.lastPay) txt = s.days > 0 ? fill(t.neverDays, { d: s.days }) : t.never;
    else if (s.days === 0) txt = t.paidToday;
    else if (s.days === 1) txt = t.paidYesterday;
    else txt = fill(t.lastPaid, { d: s.days });
    return '<span class="tag' + (s.late ? " late" : "") + '">' + txt + "</span>";
  }
  function balClass(b) { return b < 0 ? " adv" : b === 0 ? " zero" : ""; }

  /* ---------- Routing ---------- */
  function currentPhone() { var m = /^#c-(\d+)$/.exec(location.hash || ""); return m ? m[1] : null; }

  /* ---------- Render ---------- */
  function applyWords() {
    var t = T[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-t]").forEach(function (el) { var k = el.getAttribute("data-t"); if (t[k] != null) el.textContent = t[k]; });
    document.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.lang === lang)); });
    document.getElementById("search").placeholder = t.search;
    document.getElementById("search").setAttribute("aria-label", t.search);
    document.querySelector(".langs").setAttribute("aria-label", t.langLbl);
    document.getElementById("entry-note").placeholder = t.notePh;
    document.getElementById("cust-phone").placeholder = "9000000101";
    document.getElementById("set-upi").placeholder = "shopname@okaxis";
    if (typeof tlRefreshAll === "function") tlRefreshAll();
    document.getElementById("back-btn").setAttribute("aria-label", t.back);
    document.getElementById("settings-btn").setAttribute("aria-label", t.settings);
    document.getElementById("add-credit").innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' + esc(t.gave);
    document.getElementById("add-payment").innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>' + esc(t.got);
  }

  function render() {
    applyWords();
    document.getElementById("shop-name").textContent = shownShop();
    document.title = T[lang].app;
    var phone = currentPhone();
    var c = phone ? findCust(phone) : null;
    if (phone && !c) { history.replaceState(null, "", location.pathname + location.search); phone = null; }
    var onCust = !!c;
    document.getElementById("view-home").hidden = onCust;
    document.getElementById("top-home").hidden = onCust;
    document.getElementById("view-cust").hidden = !onCust;
    document.getElementById("top-cust").hidden = !onCust;
    document.getElementById("back-btn").hidden = !onCust;
    document.getElementById("brand-home").hidden = onCust;
    document.getElementById("add-cust-btn").hidden = onCust;
    if (onCust) renderCustomer(c); else renderHome();
  }

  function renderHome() {
    var t = T[lang];
    document.getElementById("view-cust").querySelector("#entries").innerHTML = "";
    var rows = state.customers.map(function (c) { return { c: c, s: summarise(c) }; });
    var total = rows.reduce(function (a, r) { return a + r.s.bal; }, 0);
    total = Math.round(total * 100) / 100;
    var owing = rows.filter(function (r) { return r.s.bal > 0; });
    var late = rows.filter(function (r) { return r.s.late; });
    document.getElementById("total-outstanding").innerHTML = '<span class="rs">' + esc(t.rs) + '</span>' + fmt(total);
    document.getElementById("total-sub").innerHTML = fill(esc(t.sub), { n: owing.length, late: "<b>" + late.length + "</b>" });
    [["all", rows.length], ["owe", owing.length], ["late", late.length]].forEach(function (p) {
      var b = document.getElementById("f-" + p[0]);
      b.innerHTML = esc(t[p[0]]) + '<span class="n">' + p[1] + "</span>";
      b.setAttribute("aria-pressed", String(filter === p[0]));
    });
    document.getElementById("example-banner").hidden = !state.example;
    document.getElementById("upi-banner").hidden = !!state.example || upiOk() || !state.customers.length;

    var q = query.trim().toLowerCase(), qd = q.replace(/\D/g, "");
    var shown = rows.filter(function (r) {
      if (filter === "owe" && r.s.bal <= 0) return false;
      if (filter === "late" && !r.s.late) return false;
      if (!q) return true;
      return String(r.c.name).toLowerCase().indexOf(q) > -1 || shownName(r.c).toLowerCase().indexOf(q) > -1 || Core.shownIn(r.c.name, r.c.nameEn, "en", "name").toLowerCase().indexOf(q) > -1 || (qd && String(r.c.phone).indexOf(qd) > -1);
    });
    if (filter === "late") shown.sort(function (a, b) { return b.s.days - a.s.days; });
    else shown.sort(function (a, b) { return b.s.bal - a.s.bal || String(a.c.name).localeCompare(String(b.c.name)); });
    document.getElementById("sort-label").textContent = filter === "late" ? t.sortLate : t.sortBal;

    var list = document.getElementById("list");
    if (!state.customers.length) { list.innerHTML = '<li class="empty">' + esc(t.emptyShop) + "</li>"; return; }
    if (!shown.length) { list.innerHTML = '<li class="empty">' + esc(t.none) + "</li>"; return; }
    list.innerHTML = shown.map(function (r) {
      var c = r.c, s = r.s, ph = esc(c.phone);
      var remind = s.bal > 0
        ? '<a class="remind" data-remind="' + ph + '" href="' + esc(waLink(c, s)) + '" target="_blank" rel="noopener">' + waIcon + esc(t.remind) + "</a>"
        : '<a class="remind" data-remind="' + ph + '" aria-disabled="true" tabindex="-1">' + waIcon + esc(t.remind) + "</a>";
      return '<li class="card" data-customer="' + ph + '">' +
        '<div class="av t' + ((Number(String(c.phone).slice(-1)) || 0) % 5 + 1) + '" aria-hidden="true">' + esc(initials(shownName(c))) + "</div>" +
        '<div class="who"><a class="nm" href="#c-' + ph + '">' + esc(shownName(c)) + '</a><div class="ph">' + esc(prettyPhone(c.phone)) + "</div></div>" +
        '<div class="bal' + balClass(s.bal) + '" data-balance="' + s.bal + '">' + esc(t.rs) + ' ' + fmt(s.bal) + "</div>" +
        '<div class="meta">' + statusTag(s) + remind + "</div></li>";
    }).join("");
  }

  function renderCustomer(c) {
    var t = T[lang], s = summarise(c);
    document.getElementById("list").innerHTML = "";
    document.getElementById("c-name").textContent = shownName(c);
    document.getElementById("c-phone").textContent = "+91 " + prettyPhone(c.phone);
    document.getElementById("c-balance").innerHTML = '<span class="rs">' + esc(t.rs) + '</span>' + fmt(s.bal);
    document.getElementById("c-bal-lbl").textContent = s.bal < 0 ? t.advance : t.balanceLbl;
    document.getElementById("c-last").textContent = s.lastPay ? fill(t.lastPaidLong, { date: prettyDate(s.lastPay) }) : t.noPayLong;
    var r = document.getElementById("c-remind");
    r.innerHTML = waIcon + esc(t.remind);
    if (s.bal > 0) { r.href = waLink(c, s); r.removeAttribute("aria-disabled"); r.removeAttribute("tabindex"); }
    else { r.removeAttribute("href"); r.setAttribute("aria-disabled", "true"); r.setAttribute("tabindex", "-1"); }
    var ul = document.getElementById("entries");
    var list = sortedEntries(c);
    if (!list.length) { ul.innerHTML = '<li class="empty">' + esc(t.noEntries) + "</li>"; return; }
    ul.innerHTML = list.map(function (e) {
      var k = e.type === "payment" ? "payment" : "credit";
      return '<li class="entry" data-entry="' + esc(e.id) + '" data-type="' + k + '" data-date="' + esc(e.date) + '">' +
        '<div><div class="when">' + esc(prettyDate(e.date)) + '</div><div class="what"><span class="kind ' + k + '">' + esc(k === "payment" ? t.paymentShort : t.creditShort) + "</span></div>" +
        (e.note ? '<div class="note">' + esc(shownText(e)) + "</div>" : "") + "</div>" +
        '<div class="amt ' + k + '" data-amount="' + esc(e.amount) + '">' + (k === "payment" ? "− " : "+ ") + esc(t.rs) + " " + fmt(e.amount) + "</div>" +
        '<div class="row2">' + (e.shot ? '<img class="thumb" data-shot src="' + esc(e.shot) + '" alt="' + esc(t.shot) + '">' : "<span></span>") +
        '<div class="entry-acts"><button type="button" class="mini" data-edit="' + esc(e.id) + '">' + esc(t.edit) + '</button>' +
        '<button type="button" class="mini danger" data-del="' + esc(e.id) + '">' + esc(t.del) + "</button></div></div></li>";
    }).join("");
  }

  /* ---------- Phonetic typing (rules live in core.js) ---------- */
  var translitText = Core.translitText;
  var TL_KEY = "hisaab-typing";
  var tlOn = true;
  try { if (localStorage.getItem(TL_KEY) === "off") tlOn = false; } catch (e) {}
  function tlActive() { return tlOn && (lang === "te" || lang === "hi"); }
  var tlTyped = {}; // field id -> { word in script: English letters typed }
  function tlConvert(el, skipLast) {
    if (!tlActive()) return;
    var v = el.value, nv = translitText(v, lang, skipLast);
    var m = tlTyped[el.id] = tlTyped[el.id] || {};
    (v.match(/[A-Za-z]+/g) || []).forEach(function (w) { m[translitText(w, lang)] = w; });
    if (nv !== v) { el.value = nv; try { el.setSelectionRange(nv.length, nv.length); } catch (e) {} }
  }
  function tlPreview(el) {
    var box = document.getElementById(el.id + "-tl"); if (!box) return;
    var prev = box.querySelector(".tl-prev");
    box.hidden = !(lang === "te" || lang === "hi");
    if (!tlActive()) { prev.textContent = ""; return; }
    var conv = translitText(el.value, lang);
    prev.textContent = /[A-Za-z]/.test(el.value) ? "→ " + conv : "";
  }
  function tlRefreshAll() {
    var t = T[lang];
    document.querySelectorAll("[data-translit]").forEach(function (el) {
      var box = document.getElementById(el.id + "-tl"); if (!box) return;
      var btn = box.querySelector(".tl-toggle");
      btn.textContent = tlOn ? t.tlOn : t.tlOff;
      btn.setAttribute("aria-pressed", String(tlOn));
      box.querySelector(".tl-hint").textContent = t.tlHint;
      box.querySelector(".tl-hint").hidden = !tlOn;
      tlPreview(el);
    });
  }
  document.querySelectorAll("[data-translit]").forEach(function (el) {
    var box = document.createElement("div");
    box.className = "tl"; box.id = el.id + "-tl";
    box.innerHTML = '<div class="tl-row"><span class="tl-prev" aria-live="polite"></span><button type="button" class="tl-toggle"></button></div><span class="tl-hint hint"></span>';
    el.insertAdjacentElement("afterend", box);
    box.querySelector(".tl-toggle").addEventListener("click", function () {
      tlOn = !tlOn; try { localStorage.setItem(TL_KEY, tlOn ? "on" : "off"); } catch (e) {}
      tlRefreshAll(); el.focus();
    });
    el.addEventListener("input", function (e) {
      if (/[\s,.;:\/-]$/.test(el.value)) tlConvert(el, false); else tlConvert(el, true);
      tlPreview(el);
    });
    el.addEventListener("blur", function () { tlConvert(el, false); tlPreview(el); });
  });

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  /* ---------- Field errors: red message right under the wrong box ---------- */
  function fieldErr(errId, input, msg) {
    var err = document.getElementById(errId), form = err.closest("form");
    clearErr(errId);
    var field = input.closest(".field");
    field.appendChild(err);
    err.textContent = msg; err.hidden = false;
    input.classList.add("bad"); input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", errId);
    try { input.focus(); } catch (e) {}
  }
  function clearErr(errId) {
    var err = document.getElementById(errId), form = err.closest("form");
    err.hidden = true; err.textContent = "";
    form.querySelectorAll(".bad").forEach(function (el) { el.classList.remove("bad"); el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); });
  }
  // Typing in a box that was marked wrong clears the mark
  ["cust-err", "entry-err", "set-err"].forEach(function (id) {
    var form = document.getElementById(id).closest("form");
    form.addEventListener("input", function (e) { if (e.target.classList && e.target.classList.contains("bad") && e.target.id !== "cust-phone") clearErr(id); });
  });
  // The phone box takes digits only and stops at 10. Anything else is removed as it is typed, with a message.
  // More than 10 digits usually means +91 or 0 was typed in front: Save stays refused until the owner fixes the box.
  // As soon as the box holds an acceptable number again, the red message goes away.
  var phoneTooLong = false;
  document.getElementById("cust-phone").addEventListener("input", function () {
    var el = this, v = el.value, digits = v.replace(/\D/g, ""), clean = digits.slice(0, 10), t = T[lang];
    if (clean !== v) el.value = clean;
    // Too long only while extra digits are arriving; the next fix by the owner clears it
    phoneTooLong = digits.length > 10;
    if (phoneTooLong) fieldErr("cust-err", el, t.errPhoneLong);
    else if (/\D/.test(v)) fieldErr("cust-err", el, t.errPhoneTyped);
    else if (/^[0-5]/.test(clean)) fieldErr("cust-err", el, t.errPhoneZero);
    else if (el.classList.contains("bad")) clearErr("cust-err"); // the number is fine now (or still being typed): the red message goes
  });

  /* ---------- Sheets ---------- */
  function openSheet(id) { tlTyped = {}; document.getElementById(id).hidden = false; tlRefreshAll(); var f = document.querySelector("#" + id + " input:not([type=radio]):not([type=file])"); if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 60); }
  function closeSheets() { document.querySelectorAll(".sheet-wrap").forEach(function (w) { w.hidden = true; }); ["cust-err", "entry-err", "set-err"].forEach(clearErr); }
  document.querySelectorAll(".sheet-wrap").forEach(function (w) {
    w.addEventListener("click", function (e) { if (e.target === w || e.target.hasAttribute("data-close")) closeSheets(); });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeSheets(); document.getElementById("viewer").hidden = true; } });

  /* Add customer */
  /* Delete customer: only a closed khata (balance 0, and 60+ days since the last entry). Two taps to confirm. */
  var delArmed = false;
  function resetDelCust() {
    var t = T[lang], b = document.getElementById("del-cust"), m = document.getElementById("del-cust-msg");
    delArmed = false; b.classList.remove("armed"); b.textContent = t.delCust;
    document.getElementById("del-cust-hint").textContent = fill(t.delCustHint, { rs: t.rs, n: Core.CLOSE_DAYS });
    m.hidden = true; m.textContent = "";
  }
  document.getElementById("del-cust").addEventListener("click", function () {
    var t = T[lang], b = this, m = document.getElementById("del-cust-msg");
    var c = findCust(editingCust); if (!c) return;
    var chk = Core.deleteCheck(c, TODAY);
    if (!chk.ok) {
      m.textContent = chk.why === "balance"
        ? fill(t.delCustBal, { rs: t.rs, amt: fmt(chk.bal) })
        : fill(chk.left === 1 ? t.delCustWait1 : t.delCustWait, { date: prettyDate(chk.until), days: chk.left, n: Core.CLOSE_DAYS });
      m.hidden = false; return;
    }
    if (!delArmed) {
      delArmed = true; b.classList.add("armed"); b.textContent = fill(t.delCustConfirm, { name: shownName(c) });
      setTimeout(function () { if (delArmed) resetDelCust(); }, 4000);
      return;
    }
    var name = shownName(c);
    state.customers = state.customers.filter(function (x) { return x !== c; });
    editingCust = null; delArmed = false;
    save(); closeSheets(); location.hash = "";
    render(); toast(fill(t.custDeleted, { name: name }));
  });
  var custNameShown = ""; // the name as shown when the edit box opened
  var editingCust = null; // phone of the customer being edited, or null when adding
  function setCustTitle(key) { var h = document.getElementById("cust-title"); h.setAttribute("data-t", key); h.textContent = T[lang][key]; }
  document.getElementById("add-cust-btn").addEventListener("click", function () {
    document.getElementById("cust-form").reset();
    clearErr("cust-err"); phoneTooLong = false; editingCust = null;
    setCustTitle("addCustomerTitle");
    document.getElementById("del-cust-wrap").hidden = true;
    openSheet("sheet-cust");
  });
  /* Edit customer: fix a wrong name or mobile number. Entries stay with the customer. */
  document.getElementById("edit-cust").addEventListener("click", function () {
    var c = findCust(currentPhone()); if (!c) return;
    document.getElementById("cust-form").reset();
    clearErr("cust-err"); phoneTooLong = false; editingCust = c.phone;
    setCustTitle("editCustomerTitle");
    resetDelCust();
    document.getElementById("del-cust-wrap").hidden = false;
    openSheet("sheet-cust");
    // Show the name as it reads in the chosen language; it is only changed if the owner edits it
    custNameShown = shownName(c);
    document.getElementById("cust-name").value = custNameShown;
    document.getElementById("cust-phone").value = c.phone;
  });
  document.getElementById("cust-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = T[lang];
    tlConvert(document.getElementById("cust-name"), false);
    var name = document.getElementById("cust-name").value.trim().replace(/\s+/g, " ");
    var rawPhone = document.getElementById("cust-phone").value.trim();
    var phone = Core.cleanPhone(rawPhone);
    var nameEl = document.getElementById("cust-name"), phoneEl = document.getElementById("cust-phone");
    if (!name) return fieldErr("cust-err", nameEl, t.errName);
    if (!Core.hasLetter(name)) return fieldErr("cust-err", nameEl, t.errNameLetter);
    if (phoneTooLong) return fieldErr("cust-err", phoneEl, t.errPhoneLong);
    if (/^[0-5]/.test(phone)) return fieldErr("cust-err", phoneEl, t.errPhoneZero);
    if (!Core.isValidPhone(phone)) return fieldErr("cust-err", phoneEl, t.errPhone);
    var same = findCust(phone);
    if (same && same.phone !== editingCust) return fieldErr("cust-err", phoneEl, fill(t.errDupName, { name: shownName(same) }));
    clearErr("cust-err");
    if (editingCust) {
      var ec = findCust(editingCust); if (!ec) { closeSheets(); return; }
      if (name !== custNameShown.trim().replace(/\s+/g, " ") && name !== ec.name) {
        ec.name = name;
        var en = englishOf(nameEl, "name"); if (en) ec.nameEn = en; else delete ec.nameEn;
      }
      var moved = phone !== ec.phone;
      ec.phone = phone; editingCust = null;
      save(); closeSheets();
      if (moved) location.hash = "#c-" + phone; else render();
      toast(fill(t.updatedCustomer, { name: shownName(ec) }));
      return;
    }
    var cust = { name: name, phone: phone, added: TODAY_ISO, entries: [] };
    var nameEn = englishOf(document.getElementById("cust-name"), "name"); if (nameEn) cust.nameEn = nameEn;
    state.customers.push(cust);
    save(); closeSheets(); filter = "all"; query = ""; document.getElementById("search").value = "";
    render(); toast(fill(t.addedCustomer, { name: shownName(cust) }));
  });

  /* Entry form */
  var editing = null;    // { phone, id } or null
  var pendingShot = null; // data URL or null (undefined means unchanged on edit)
  function setType(type) {
    document.getElementById("type-" + type).checked = true;
    document.getElementById("lab-credit").className = type === "credit" ? "on-credit" : "";
    document.getElementById("lab-payment").className = type === "payment" ? "on-payment" : "";
    document.getElementById("shot-field").hidden = type !== "payment";
  }
  function showShot(src) {
    var img = document.getElementById("shot-prev");
    if (src) { img.src = src; img.hidden = false; document.getElementById("shot-remove").hidden = false; }
    else { img.removeAttribute("src"); img.hidden = true; document.getElementById("shot-remove").hidden = true; }
  }
  function openEntry(type, entry) {
    var t = T[lang], c = findCust(currentPhone());
    if (!c) return;
    var f = document.getElementById("entry-form"); f.reset();
    clearErr("entry-err");
    document.getElementById("entry-date").max = TODAY_ISO;
    document.getElementById("ocr").hidden = true;
    editing = entry ? { phone: c.phone, id: entry.id } : null;
    pendingShot = entry ? entry.shot || null : null;
    document.getElementById("entry-title").textContent = entry ? t.entryEdit : fill(t.entryNew, { name: shownName(c) });
    setType(entry ? (entry.type === "payment" ? "payment" : "credit") : type);
    document.getElementById("entry-amount").value = entry ? entry.amount : "";
    document.getElementById("entry-date").value = entry ? entry.date : TODAY_ISO;
    document.getElementById("entry-note").value = entry ? entry.note || "" : "";
    showShot(pendingShot);
    openSheet("sheet-entry");
  }
  document.getElementById("add-credit").addEventListener("click", function () { openEntry("credit"); });
  document.getElementById("add-payment").addEventListener("click", function () { openEntry("payment"); });
  document.getElementById("type-credit").addEventListener("change", function () { setType("credit"); });
  document.getElementById("type-payment").addEventListener("change", function () { setType("payment"); });
  document.getElementById("shot-remove").addEventListener("click", function () { pendingShot = null; document.getElementById("shot-input").value = ""; showShot(null); document.getElementById("ocr").hidden = true; });

  // Shrink the picture so it fits in phone storage
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(reader.result); };
        img.onload = function () {
          var max = 720, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
          var cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
          try { resolve(cv.toDataURL("image/jpeg", 0.72)); } catch (e) { resolve(reader.result); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Read the amount from the screenshot (OCR with Tesseract.js, loaded only when needed)
  var tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) tessPromise = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(new Error("no tesseract")); };
      s.onerror = function () { tessPromise = null; rej(new Error("load failed")); };
      document.head.appendChild(s);
    });
    return tessPromise;
  }
  var pickAmount = Core.pickAmount;
  // Second try for pictures where the first reading finds no amount. Payment apps show the amount in very
  // big letters, which the normal reading often skips. "Sparse text" mode looks for words anywhere on the picture.
  var sparseWorker = null;
  function readSparse(Tess, dataUrl) {
    if (!sparseWorker) sparseWorker = Tess.createWorker("eng").then(function (w) {
      return w.setParameters({ tessedit_pageseg_mode: "11" }).then(function () { return w; });
    }).catch(function (e) { sparseWorker = null; throw e; });
    return sparseWorker.then(function (w) { return w.recognize(dataUrl); });
  }
  function textOf(out) { return out && out.data && out.data.text; }
  function readAmount(dataUrl) {
    var t = T[lang], box = document.getElementById("ocr");
    box.hidden = false; box.textContent = t.reading;
    var token = dataUrl;
    loadTesseract().then(function (Tess) {
      return Tess.recognize(dataUrl, "eng").then(function (out) {
        var v = pickAmount(textOf(out));
        if (v != null || pendingShot !== token) return v;
        return readSparse(Tess, dataUrl).then(function (o2) { return pickAmount(textOf(o2)); });
      });
    })
      .then(function (v) {
        if (pendingShot !== token) return;
        if (v == null) { box.textContent = t.readFail; return; }
        var amt = document.getElementById("entry-amount");
        if (!amt.value) { amt.value = v; box.textContent = fill(t.readOk, { amt: fmt(v) }); }
        else if (Number(amt.value) !== v) {
          box.innerHTML = esc(fill(t.readOk, { amt: fmt(v) })) + ' <button type="button" class="mini" id="use-amt">' + esc(fill(t.useAmt, { amt: fmt(v) })) + "</button>";
          document.getElementById("use-amt").onclick = function () { amt.value = v; box.textContent = fill(t.readOk, { amt: fmt(v) }); };
        } else box.textContent = fill(t.readOk, { amt: fmt(v) });
      })
      .catch(function () { if (pendingShot === token) box.textContent = t.readFail; });
  }
  document.getElementById("shot-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    shrink(file).then(function (url) { pendingShot = url; showShot(url); readAmount(url); });
  });

  var shrinking = null;
  document.getElementById("entry-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = T[lang];
    var c = findCust(currentPhone()); if (!c) return;
    var type = document.getElementById("type-payment").checked ? "payment" : "credit";
    var amtEl = document.getElementById("entry-amount"), dateEl = document.getElementById("entry-date");
    var amount = parseFloat(String(amtEl.value).replace(/,/g, ""));
    var date = document.getElementById("entry-date").value;
    tlConvert(document.getElementById("entry-note"), false);
    var note = document.getElementById("entry-note").value.trim();
    var noteEn = englishOf(document.getElementById("entry-note"), "text");
    var prob = Core.amountProblem(amtEl.value);
    if (prob === "zero") return fieldErr("entry-err", amtEl, t.errAmount);
    if (prob === "format") return fieldErr("entry-err", amtEl, t.errAmountDec);
    if (prob === "max") return fieldErr("entry-err", amtEl, t.errAmountMax);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fieldErr("entry-err", dateEl, t.errDate);
    if (date > TODAY_ISO) return fieldErr("entry-err", dateEl, t.errDateFuture);
    clearErr("entry-err");
    var finish = function (shot) {
      var data = { type: type, amount: Math.round(amount * 100) / 100, date: date, note: note };
      if (noteEn) data.noteEn = noteEn;
      if (type === "payment" && shot) data.shot = shot;
      if (editing) {
        var en = c.entries.filter(function (x) { return x.id === editing.id; })[0];
        if (en) { en.type = data.type; en.amount = data.amount; en.date = data.date; en.note = data.note; if (data.noteEn) en.noteEn = data.noteEn; else delete en.noteEn; if (data.shot) en.shot = data.shot; else delete en.shot; }
      } else {
        data.id = uid(); data.seq = ++seqCounter; c.entries.push(data);
      }
      if (save()) { closeSheets(); render(); toast(t.saved); }
    };
    // If a picture was picked but not processed yet, wait for it
    var fileEl = document.getElementById("shot-input");
    var file = fileEl.files && fileEl.files[0];
    if (type === "payment" && file && !pendingShot) shrink(file).then(finish); else finish(pendingShot);
  });

  /* Entry edit / delete, picture viewer */
  var armed = null;
  document.getElementById("entries").addEventListener("click", function (e) {
    var c = findCust(currentPhone()); if (!c) return;
    var t = T[lang];
    var ed = e.target.closest("[data-edit]"), dl = e.target.closest("[data-del]"), im = e.target.closest("img[data-shot]");
    if (ed) { var en = c.entries.filter(function (x) { return x.id === ed.dataset.edit; })[0]; if (en) openEntry(en.type, en); }
    else if (dl) {
      if (armed === dl) {
        c.entries = c.entries.filter(function (x) { return x.id !== dl.dataset.del; });
        armed = null; save(); render(); toast(t.deleted);
      } else {
        if (armed) { armed.classList.remove("armed"); armed.textContent = t.del; }
        armed = dl; dl.classList.add("armed"); dl.textContent = t.confirmDelete;
        setTimeout(function () { if (armed === dl) { dl.classList.remove("armed"); dl.textContent = T[lang].del; armed = null; } }, 4000);
      }
    }
    else if (im) { document.getElementById("viewer-img").src = im.src; document.getElementById("viewer").hidden = false; }
  });
  document.getElementById("viewer").addEventListener("click", function () { this.hidden = true; });

  /* ---------- Import (format rules live in core.js) ---------- */
  function parseShop(text) { return Core.parseShop(text, state ? state.shop : null, TODAY_ISO); }
  function doImport(text) {
    var t = T[lang], err = document.getElementById("import-err");
    try {
      var d = parseShop(text);
      state = prepare({ shop: d.shop, customers: d.customers, example: false });
      save(); err.hidden = true; filter = "all"; query = ""; document.getElementById("search").value = "";
      if (currentPhone()) history.replaceState(null, "", location.pathname + location.search);
      render(); toast(fill(t.imported, { n: d.customers.length }));
      window.scrollTo(0, 0);
    } catch (e) { err.textContent = t.importErr; err.hidden = false; }
  }
  document.getElementById("import-go").addEventListener("click", function () { doImport(document.getElementById("import-box").value); });
  document.getElementById("import-file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var r = new FileReader(); r.onload = function () { document.getElementById("import-box").value = r.result; doImport(r.result); }; r.readAsText(f);
    e.target.value = "";
  });

  /* ---------- CSV export ---------- */
  document.getElementById("export-csv").addEventListener("click", function () {
    var blob = new Blob(["\ufeff" + Core.buildCsv(state.customers, TODAY)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "hisaab-" + TODAY_ISO + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast(T[lang].exported);
  });

  /* ---------- Settings ---------- */
  function openSettings() {
    document.getElementById("set-shop").value = state.shop.name || "";
    document.getElementById("set-upi").value = upiOk() ? state.shop.upi : "";
    var b = document.getElementById("clear-all"); b.classList.remove("armed"); b.textContent = T[lang].clearAll;
    clearErr("set-err");
    openSheet("sheet-settings");
  }
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("upi-fix").addEventListener("click", openSettings);
  document.getElementById("settings-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var upiEl = document.getElementById("set-upi");
    if (upiEl.value.trim() && !Core.isValidUpi(upiEl.value)) return fieldErr("set-err", upiEl, T[lang].errUpi);
    clearErr("set-err");
    tlConvert(document.getElementById("set-shop"), false);
    state.shop.name = document.getElementById("set-shop").value.trim();
    var shopEn = englishOf(document.getElementById("set-shop"), "shop"); if (shopEn) state.shop.nameEn = shopEn; else delete state.shop.nameEn;
    var u = document.getElementById("set-upi").value.trim();
    state.shop.upi = u || UPI_PLACEHOLDER;
    save(); closeSheets(); render(); toast(T[lang].settingsSaved);
  });
  var clearArmed = false;
  document.getElementById("clear-all").addEventListener("click", function () {
    var b = this, t = T[lang];
    if (!clearArmed) { clearArmed = true; b.classList.add("armed"); b.textContent = t.confirmClear; setTimeout(function () { clearArmed = false; b.classList.remove("armed"); b.textContent = T[lang].clearAll; }, 4000); return; }
    clearArmed = false;
    state = prepare({ shop: { name: state.shop.name, upi: state.shop.upi }, customers: [], example: false });
    save(); closeSheets(); history.replaceState(null, "", location.pathname + location.search); render(); toast(t.cleared);
  });
  document.getElementById("start-fresh").addEventListener("click", function () {
    state = prepare({ shop: { name: "", upi: UPI_PLACEHOLDER }, customers: [], example: false });
    save(); render(); openSettings();
  });

  /* ---------- Navigation and language ---------- */
  document.getElementById("back-btn").addEventListener("click", function () {
    history.replaceState(null, "", location.pathname + location.search); render(); window.scrollTo(0, 0);
  });
  window.addEventListener("hashchange", function () { closeSheets(); render(); window.scrollTo(0, 0); });
  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { lang = b.dataset.lang; try { localStorage.setItem(LANG_KEY, lang); } catch (e) {} render(); });
  });
  document.querySelectorAll("[data-f]").forEach(function (b) { b.addEventListener("click", function () { filter = b.dataset.f; render(); }); });
  document.getElementById("search").addEventListener("input", function (e) { query = e.target.value; renderHome(); });

  /* ---------- Installable app ---------- */
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; document.getElementById("install-btn").hidden = false; });
  document.getElementById("install-btn").addEventListener("click", function () { if (installEvt) { installEvt.prompt(); installEvt = null; this.hidden = true; } });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () { try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {} });
  }

  render();
})();
