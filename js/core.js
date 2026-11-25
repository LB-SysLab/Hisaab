/*
 * Hisaab core: the money rules, import, CSV, screenshot-amount reading and
 * phonetic typing. No page or browser code here, so it runs in Node tests too.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HisaabCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Dates ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  // Today's date, honouring ?today=YYYY-MM-DD in the address
  function todayFrom(search) {
    var m = /[?&]today=(\d{4}-\d{2}-\d{2})/.exec(search || "");
    var d = (m && parseISO(m[1])) || new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function daysBetween(iso, today) { var d = parseISO(iso); return d ? Math.round((today - d) / 86400000) : 0; }

  /* ---------- Money: balances are always worked out from entries ---------- */
  var OVERDUE_DAYS = 30;
  function round2(n) { return Math.round(Number(n) * 100) / 100; }
  function summarise(c, today) {
    var bal = 0, lastPay = null, firstCredit = null;
    (c.entries || []).forEach(function (e) {
      var amt = Number(e.amount) || 0;
      if (e.type === "payment") { bal -= amt; if (!lastPay || e.date > lastPay) lastPay = e.date; }
      else { bal += amt; if (!firstCredit || e.date < firstCredit) firstCredit = e.date; }
    });
    bal = round2(bal);
    var since = lastPay || firstCredit;
    var days = since ? Math.max(0, daysBetween(since, today)) : 0;
    return { bal: bal, lastPay: lastPay, days: days, late: bal > 0 && days >= OVERDUE_DAYS };
  }
  function totalOutstanding(customers, today) {
    return round2(customers.reduce(function (a, c) { return a + summarise(c, today).bal; }, 0));
  }
  // Newest first; entries on the same day keep the order they were added (later one on top)
  function sortedEntries(c) {
    return (c.entries || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.seq || 0) - (a.seq || 0);
    });
  }
  // Overdue list: owes money and no payment for 30+ days, longest wait first
  function overdueList(customers, today) {
    return customers.map(function (c) { return { c: c, s: summarise(c, today) }; })
      .filter(function (r) { return r.s.late; })
      .sort(function (a, b) { return b.s.days - a.s.days; });
  }

  /* ---------- Customer checks ---------- */
  function cleanPhone(v) { return String(v == null ? "" : v).trim().replace(/[\s-]/g, ""); }
  function isValidPhone(v) { return /^\d{10}$/.test(cleanPhone(v)); }

  /* ---------- Ids ---------- */
  var seq = 0;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nextSeq() { return ++seq; }
  function noteSeq(n) { if (n > seq) seq = n; }

  /* ---------- Import: accepts the sample format and close variations ---------- */
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) if (o && o[keys[i]] != null && o[keys[i]] !== "") return o[keys[i]]; return undefined; }
  function normDate(v, todayISO) {
    if (v == null || v === "") return todayISO;
    if (typeof v === "number") { var dn = new Date(v > 1e12 ? v : v * 1000); return isNaN(dn) ? todayISO : isoOf(dn); }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s))) return m[3] + "-" + pad(+m[2]) + "-" + pad(+m[1]);
    var d = new Date(s); return isNaN(d) ? todayISO : isoOf(d);
  }
  function normType(e, amount) {
    var raw = String(pick(e, ["type", "kind", "entry_type", "entryType", "txn_type", "direction"]) || "").toLowerCase();
    if (raw) return /pay|paid|receiv|got|jama|deposit|^in$|return/.test(raw) ? "payment" : "credit";
    if (e.payment != null || e.paid != null) return "payment";
    return amount < 0 ? "payment" : "credit";
  }
  function normEntry(e, todayISO) {
    if (!e || typeof e !== "object") return null;
    var a = pick(e, ["amount", "amt", "value", "rupees", "sum", "payment", "credit", "paid"]);
    var n = typeof a === "number" ? a : parseFloat(String(a == null ? "" : a).replace(/[^\d.-]/g, ""));
    if (!isFinite(n)) return null;
    var out = {
      id: uid(), seq: nextSeq(), type: normType(e, n), amount: Math.abs(n),
      date: normDate(pick(e, ["date", "on", "day", "created_at", "createdAt", "timestamp", "time"]), todayISO),
      note: String(pick(e, ["note", "notes", "description", "desc", "remark", "remarks", "item", "items", "memo"]) || "")
    };
    var shot = pick(e, ["shot", "screenshot", "image", "photo"]);
    if (typeof shot === "string" && /^(data:image|https?:)/.test(shot)) out.shot = shot;
    return out;
  }
  function normPhone(v) { var d = String(v == null ? "" : v).replace(/\D/g, ""); if (d.length > 10 && /^(91|0)/.test(d)) d = d.slice(-10); return d; }
  function findIn(arr, phone) { for (var i = 0; i < arr.length; i++) if (arr[i].phone === phone) return arr[i]; return null; }

  // text: the pasted JSON. prevShop: the shop details to keep when the file has none.
  function parseShop(text, prevShop, todayISO) {
    var root = JSON.parse(text);
    prevShop = prevShop || { name: "", upi: "" };
    if (root && !Array.isArray(root) && typeof root === "object" && root.data && typeof root.data === "object") root = root.data;
    var custs = Array.isArray(root) ? root : pick(root, ["customers", "parties", "accounts", "people", "clients", "khata"]);
    if (custs && !Array.isArray(custs) && typeof custs === "object") custs = Object.keys(custs).map(function (k) { var v = custs[k]; if (v && typeof v === "object" && v.phone == null) v.phone = k; return v; });
    if (!Array.isArray(custs)) throw new Error("no customers");

    var shopRaw = Array.isArray(root) ? null : pick(root, ["shop", "store", "business", "shop_name", "shopName"]);
    var shop = { name: prevShop.name, upi: prevShop.upi };
    if (typeof shopRaw === "string") shop.name = shopRaw;
    else if (shopRaw && typeof shopRaw === "object") {
      shop.name = pick(shopRaw, ["name", "shop_name", "title"]) || shop.name;
      var u = pick(shopRaw, ["upi", "upi_id", "upiId", "vpa"]); if (u) shop.upi = String(u);
    }
    if (!Array.isArray(root)) { var u2 = pick(root, ["upi", "upi_id", "upiId", "vpa"]); if (u2) shop.upi = String(u2); }

    var byKey = {}, customers = [];
    custs.forEach(function (c, i) {
      if (!c || typeof c !== "object") return;
      var phone = normPhone(pick(c, ["phone", "mobile", "phone_number", "phoneNumber", "number", "contact", "whatsapp"]));
      var name = String(pick(c, ["name", "customer_name", "customerName", "full_name", "fullName"]) || phone || "Customer " + (i + 1));
      if (!phone) phone = String(i + 1).padStart(10, "0");
      var cust = findIn(customers, phone);
      if (!cust) { cust = { name: name, phone: phone, entries: [] }; customers.push(cust); }
      var list = pick(c, ["entries", "transactions", "ledger", "txns", "history", "records"]);
      if (Array.isArray(list)) list.forEach(function (e) { var en = normEntry(e, todayISO); if (en) cust.entries.push(en); });
      [c.id, c.customer_id, c.customerId, c.phone, phone, name].forEach(function (k) { if (k != null && k !== "") byKey[String(k)] = cust; });
    });
    var top = Array.isArray(root) ? null : pick(root, ["entries", "transactions", "ledger", "txns", "records"]);
    if (Array.isArray(top)) top.forEach(function (e) {
      if (!e || typeof e !== "object") return;
      var ref = pick(e, ["phone", "customer_phone", "customerPhone", "mobile", "customer_id", "customerId", "customer", "name", "customer_name"]);
      var cust = ref != null && typeof ref !== "object" ? (byKey[String(ref)] || byKey[normPhone(ref)]) : null;
      if (!cust && ref && typeof ref === "object") cust = byKey[normPhone(ref.phone)] || byKey[String(ref.id)];
      var en = normEntry(e, todayISO);
      if (cust && en) cust.entries.push(en);
    });
    return { shop: shop, customers: customers };
  }

  /* ---------- CSV export: one line per entry, oldest first, plus the total ---------- */
  function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function buildCsv(customers, today) {
    var lines = [["Customer", "Phone", "Date", "Type", "Amount", "Note", "Customer balance"].join(",")];
    customers.forEach(function (c) {
      var s = summarise(c, today), list = sortedEntries(c).reverse();
      if (!list.length) lines.push([c.name, c.phone, "", "", "", "", s.bal].map(csvCell).join(","));
      list.forEach(function (e) { lines.push([c.name, c.phone, e.date, e.type, e.amount, e.note || "", s.bal].map(csvCell).join(",")); });
    });
    lines.push(["TOTAL OUTSTANDING", "", "", "", "", "", totalOutstanding(customers, today)].map(csvCell).join(","));
    return lines.join("\r\n");
  }

  /* ---------- Reading the amount from a payment screenshot's text ---------- */
  // OCR often misreads the rupee sign as ¥, %, €, £, $, ?, F or z
  var RUPEE_LOOKALIKE = "[₹¥%€£$?Fz]";
  var NUM = "(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d{1,7}(?:\\.\\d{1,2})?)";
  function pickAmount(text) {
    var t = String(text || "").replace(/[Oo](?=\d)/g, "0").replace(/(\d)[Oo]/g, "$10");
    var pats = [
      new RegExp("(?:₹|Rs\\.?|INR|र)\\s*" + NUM + "(?![\\d,])", "i"),
      new RegExp("(?:^|\\s)" + RUPEE_LOOKALIKE + "\\s?" + NUM + "(?![\\d,])", "m"),
      new RegExp("(?:paid|amount|sent|received|debited|credited)[^\\d\\n]{0,20}" + NUM + "(?![\\d,])", "i"),
      new RegExp("^\\s*[^\\w\\s]?\\s*" + NUM + "\\s*$", "m")
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = pats[i].exec(t);
      if (m) { var v = parseFloat(m[1].replace(/,/g, "")); if (v > 0 && v < 10000000) return v; }
    }
    return null;
  }

  /* ---------- Phonetic typing: English letters -> Telugu / Hindi script (offline) ---------- */
  var SCRIPTS = {
    te: {
      vow: { a: ["అ", ""], aa: ["ఆ", "ా"], i: ["ఇ", "ి"], ii: ["ఈ", "ీ"], u: ["ఉ", "ు"], uu: ["ఊ", "ూ"], e: ["ఎ", "ె"], ee_: ["ఏ", "ే"], ai: ["ఐ", "ై"], o: ["ఒ", "ొ"], oo_: ["ఓ", "ో"], au: ["ఔ", "ౌ"] },
      con: { k: "క", kh: "ఖ", g: "గ", gh: "ఘ", c: "క", ch: "చ", chh: "ఛ", j: "జ", jh: "ఝ", t: "ట", th: "త", T: "ట", Th: "ఠ", d: "ద", dh: "ధ", D: "డ", Dh: "ఢ", n: "న", N: "ణ", p: "ప", ph: "ఫ", f: "ఫ", b: "బ", bh: "భ", m: "మ", y: "య", r: "ర", l: "ల", L: "ళ", v: "వ", w: "వ", sh: "శ", Sh: "ష", s: "స", h: "హ", z: "జ", q: "క", ksh: "క్ష", x: "క్స" },
      virama: "్", anusvara: "ం", finalVirama: true
    },
    hi: {
      vow: { a: ["अ", ""], aa: ["आ", "ा"], i: ["इ", "ि"], ii: ["ई", "ी"], u: ["उ", "ु"], uu: ["ऊ", "ू"], e: ["ए", "े"], ee_: ["ए", "े"], ai: ["ऐ", "ै"], o: ["ओ", "ो"], oo_: ["ओ", "ो"], au: ["औ", "ौ"] },
      con: { k: "क", kh: "ख", g: "ग", gh: "घ", c: "क", ch: "च", chh: "छ", j: "ज", jh: "झ", t: "त", th: "थ", T: "ट", Th: "ठ", d: "द", dh: "ध", D: "ड", Dh: "ढ", n: "न", N: "ण", p: "प", ph: "फ", f: "फ़", b: "ब", bh: "भ", m: "म", y: "य", r: "र", l: "ल", L: "ळ", v: "व", w: "व", sh: "श", Sh: "ष", s: "स", h: "ह", z: "ज़", q: "क़", ksh: "क्ष", x: "क्स" },
      virama: "्", anusvara: "ं", finalVirama: false
    }
  };
  var VOW_KEYS = [["aa", "aa"], ["ai", "ai"], ["au", "au"], ["ou", "au"], ["ee", "ii"], ["ii", "ii"], ["oo", "uu"], ["uu", "uu"], ["A", "aa"], ["I", "ii"], ["U", "uu"], ["E", "ee_"], ["O", "oo_"], ["a", "a"], ["i", "i"], ["u", "u"], ["e", "e"], ["o", "o"]];
  var CON_KEYS = ["ksh", "chh", "Sh", "Th", "Dh", "kh", "gh", "ch", "jh", "th", "dh", "ph", "bh", "sh", "T", "D", "N", "L", "k", "g", "c", "j", "t", "d", "n", "p", "f", "b", "m", "y", "r", "l", "v", "w", "s", "h", "z", "q", "x"];
  function keyOf(k) { return Array.isArray(k) ? k[0] : k; }
  function hasCapKey(word, i, keys) {
    for (var k = 0; k < keys.length; k++) { var key = keyOf(keys[k]); if (/[A-Z]/.test(key) && word.substr(i, key.length) === key) return true; }
    return false;
  }
  function matchAt(word, i, keys) {
    for (var k = 0; k < keys.length; k++) {
      var key = keyOf(keys[k]);
      if (word.substr(i, key.length) === key) return keys[k];
      if (/[A-Z]/.test(key)) continue;
      if (word.substr(i, key.length).toLowerCase() === key && !hasCapKey(word, i, keys)) return keys[k];
    }
    return null;
  }
  function translitWord(word, code) {
    var S = SCRIPTS[code]; if (!S) return word;
    // A capital first letter is usually the phone's auto-capital, not a sound choice
    word = word.charAt(0).toLowerCase() + word.slice(1);
    word = word.replace(/([^aeiouAEIOU])y$/, "$1i");
    var out = "", i = 0, prevCon = false;
    while (i < word.length) {
      var v = matchAt(word, i, VOW_KEYS);
      if (v) {
        var pair = S.vow[v[1]];
        out += prevCon ? pair[1] : pair[0];
        prevCon = false; i += v[0].length; continue;
      }
      var c = matchAt(word, i, CON_KEYS);
      if (c) {
        var next = i + c.length;
        var nextIsCon = next < word.length && !matchAt(word, next, VOW_KEYS) && matchAt(word, next, CON_KEYS);
        if (prevCon) out += S.virama;
        // n or m before another consonant becomes the round nasal sign (venkat -> వెంకట్)
        if ((c === "n" || c === "m") && nextIsCon) {
          var nc = matchAt(word, next, CON_KEYS);
          if (nc !== c && ["y", "r", "v", "w", "h"].indexOf(nc) < 0) { out += S.anusvara; prevCon = false; i = next; continue; }
        }
        out += S.con[c]; prevCon = true; i = next; continue;
      }
      if (prevCon && S.finalVirama) out += S.virama;
      out += word.charAt(i); prevCon = false; i++;
    }
    if (prevCon && S.finalVirama) {
      // Telugu words ending in "m" usually end in the round nasal sign (biyyam -> బియ్యం)
      if (code === "te" && /[aeiou]m$/i.test(word) && out.slice(-1) === S.con.m) out = out.slice(0, -1) + S.anusvara;
      else out += S.virama;
    }
    return out;
  }
  // skipLast: leave the word still being typed alone
  function translitText(text, code, skipLast) {
    var parts = String(text).split(/([A-Za-z]+)/);
    var lastWord = -1;
    if (skipLast) for (var j = parts.length - 1; j >= 0; j--) { if (/^[A-Za-z]+$/.test(parts[j])) { if (j === parts.length - 1 || parts[j + 1] === "") lastWord = j; break; } }
    return parts.map(function (p, k) { return /^[A-Za-z]+$/.test(p) && k !== lastWord ? translitWord(p, code) : p; }).join("");
  }

  return {
    pad: pad, isoOf: isoOf, parseISO: parseISO, todayFrom: todayFrom, daysBetween: daysBetween,
    OVERDUE_DAYS: OVERDUE_DAYS, summarise: summarise, totalOutstanding: totalOutstanding, sortedEntries: sortedEntries, overdueList: overdueList,
    cleanPhone: cleanPhone, isValidPhone: isValidPhone,
    uid: uid, nextSeq: nextSeq, noteSeq: noteSeq,
    parseShop: parseShop, buildCsv: buildCsv, pickAmount: pickAmount, translitText: translitText
  };
});
