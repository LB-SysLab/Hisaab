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
  // Spaces and dashes are ignored. No country code: the number is the 10 digits only
  function cleanPhone(v) { return String(v == null ? "" : v).trim().replace(/[\s-]/g, ""); }
  // A name needs at least one letter (any language): "12345" or "@@##" is refused
  function hasLetter(v) { return /\p{L}/u.test(String(v || "")); }
  var MAX_AMOUNT = 1000000; // Rs 10,00,000 for one entry
  // "" ok | "zero" | "max" | "format"
  function amountProblem(raw) {
    var t = String(raw == null ? "" : raw).trim().replace(/,/g, "");
    var n = parseFloat(t);
    if (!(n > 0)) return "zero";
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return "format";
    if (n > MAX_AMOUNT) return "max";
    return "";
  }
  // name@bank, for example shopname@okaxis
  function isValidUpi(v) { return /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.]{1,63}$/.test(String(v || "").trim()); }
  // Exactly 10 digits, starting with 6, 7, 8 or 9 (Indian mobile numbers)
  function isValidPhone(v) { return /^[6-9]\d{9}$/.test(cleanPhone(v)); }

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
  var RUPEE_LOOKALIKE = "[₹¥%€£$?FzR#]"; // how the reader often sees the ₹ sign
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
  // name: true for people's names, which are usually spelled casually
  // (Devi, Ramesh, Sunita): e/o are long, a final "sh" is ష in Telugu, a final "a" is long and "th" is त in Hindi
  function translitWord(word, code, name) {
    var S = SCRIPTS[code]; if (!S) return word;
    if (name) {
      if (code === "hi") word = word.replace(/([^aeiouAEIOU])a$/, "$1aa");
      if (code === "hi") word = word.replace(/th/g, "t");
      if (code === "te") word = word.replace(/sh$/, "Sh");
    }
    // A capital first letter is usually the phone's auto-capital, not a sound choice
    word = word.charAt(0).toLowerCase() + word.slice(1);
    word = word.replace(/([^aeiouAEIOU])y$/, "$1i");
    var out = "", i = 0, prevCon = false;
    while (i < word.length) {
      var v = matchAt(word, i, VOW_KEYS);
      if (v) {
        var vk = v[1];
        if (name && code === "te" && (v[0] === "e" || v[0] === "o")) vk = v[0] === "e" ? "ee_" : "oo_";
        var pair = S.vow[vk];
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


  /* ---------- Names shown in Telugu / Hindi (display only; the saved name never changes) ---------- */
  // Common name parts written the usual way; anything else uses the sound rules above
  var NAME_WORDS = { kumar: ["కుమార్", "कुमार"], devi: ["దేవి", "देवी"], ravi: ["రవి", "रवि"], sunita: ["సునీత", "सुनीता"], sunitha: ["సునీత", "सुनीता"], mohd: ["మొహమ్మద్", "मोहम्मद"], mohammed: ["మొహమ్మద్", "मोहम्मद"], mohammad: ["మొహమ్మద్", "मोहम्मद"], muhammad: ["మొహమ్మద్", "मोहम्मद"], irfan: ["ఇర్ఫాన్", "इरफ़ान"], anjali: ["అంజలి", "अंजलि"], reddy: ["రెడ్డి", "रेड्डी"], prakash: ["ప్రకాష్", "प्रकाश"], rao: ["రావు", "राव"], fatima: ["ఫాతిమా", "फ़ातिमा"], begum: ["బేగం", "बेगम"], venkat: ["వెంకట్", "वेंकट"], venkatesh: ["వెంకటేష్", "वेंकटेश"], naidu: ["నాయుడు", "नायडू"], kavitha: ["కవిత", "कविता"], kavita: ["కవిత", "कविता"], lakshmi: ["లక్ష్మి", "लक्ष्मी"], laxmi: ["లక్ష్మి", "लक्ष्मी"], ramesh: ["రమేష్", "रमेश"], suresh: ["సురేష్", "सुरेश"], mahesh: ["మహేష్", "महेश"], rajesh: ["రాజేష్", "राजेश"], raju: ["రాజు", "राजू"], ram: ["రామ్", "राम"], krishna: ["కృష్ణ", "कृष्ण"], srinivas: ["శ్రీనివాస్", "श्रीनिवास"], sri: ["శ్రీ", "श्री"], sai: ["సాయి", "साई"], priya: ["ప్రియ", "प्रिया"], anita: ["అనిత", "अनीता"], anitha: ["అనిత", "अनीता"], geeta: ["గీత", "गीता"], geetha: ["గీత", "गीता"], gita: ["గీత", "गीता"], sita: ["సీత", "सीता"], seeta: ["సీత", "सीता"], seetha: ["సీత", "सीता"], radha: ["రాధ", "राधा"], padma: ["పద్మ", "पद्मा"], shankar: ["శంకర్", "शंकर"], ganesh: ["గణేష్", "गणेश"], gopal: ["గోపాల్", "गोपाल"], mohan: ["మోహన్", "मोहन"], murali: ["మురళి", "मुरली"], naresh: ["నరేష్", "नरेश"], ramu: ["రాము", "रामू"], sharma: ["శర్మ", "शर्मा"], singh: ["సింగ్", "सिंह"], khan: ["ఖాన్", "ख़ान"], ali: ["అలీ", "अली"], ahmed: ["అహ్మద్", "अहमद"], patel: ["పటేల్", "पटेल"], gupta: ["గుప్తా", "गुप्ता"], verma: ["వర్మ", "वर्मा"], yadav: ["యాదవ్", "यादव"], shaik: ["షేక్", "शेख़"], shaikh: ["షేక్", "शेख़"], babu: ["బాబు", "बाबू"], anil: ["అనిల్", "अनिल"], sunil: ["సునీల్", "सुनील"], vijay: ["విజయ్", "विजय"], ajay: ["అజయ్", "अजय"], deepa: ["దీప", "दीपा"], rekha: ["రేఖ", "रेखा"], usha: ["ఉష", "उषा"], latha: ["లత", "लता"], lata: ["లత", "लता"], swathi: ["స్వాతి", "स्वाति"], divya: ["దివ్య", "दिव्या"], pooja: ["పూజ", "पूजा"], neha: ["నేహ", "नेहा"], arjun: ["అర్జున్", "अर्जुन"], kiran: ["కిరణ్", "किरण"], satish: ["సతీష్", "सतीश"], naveen: ["నవీన్", "नवीन"], praveen: ["ప్రవీణ్", "प्रवीण"], harish: ["హరీష్", "हरीश"], lalitha: ["లలిత", "ललिता"], saritha: ["సరిత", "सरिता"], madhu: ["మధు", "मधु"], hari: ["హరి", "हरि"], chandra: ["చంద్ర", "चंद्र"], rani: ["రాణి", "रानी"], rahul: ["రాహుల్", "राहुल"], amit: ["అమిత్", "अमित"], raj: ["రాజ్", "राज"] };
  // Single letters (initials like "Kavitha S") are read out the way people say them
  var LETTERS = { a: ["ఏ", "ए"], b: ["బి", "बी"], c: ["సి", "सी"], d: ["డి", "डी"], e: ["ఈ", "ई"], f: ["ఎఫ్", "एफ़"], g: ["జి", "जी"], h: ["హెచ్", "एच"], i: ["ఐ", "आई"], j: ["జె", "जे"], k: ["కె", "के"], l: ["ఎల్", "एल"], m: ["ఎం", "एम"], n: ["ఎన్", "एन"], o: ["ఓ", "ओ"], p: ["పి", "पी"], q: ["క్యూ", "क्यू"], r: ["ఆర్", "आर"], s: ["ఎస్", "एस"], t: ["టి", "टी"], u: ["యు", "यू"], v: ["వి", "वी"], w: ["డబ్ల్యు", "डब्ल्यू"], x: ["ఎక్స్", "एक्स"], y: ["వై", "वाई"], z: ["జెడ్", "ज़ेड"] };
  function displayName(name, code) {
    if (code !== "te" && code !== "hi") return String(name);
    var col = code === "te" ? 0 : 1;
    return String(name).replace(/[A-Za-z]+/g, function (w) {
      var key = w.toLowerCase();
      if (NAME_WORDS.hasOwnProperty(key)) return NAME_WORDS[key][col];
      if (key.length === 1 && LETTERS[key]) return LETTERS[key][col];
      return translitWord(w, code, true);
    });
  }


  /* ---------- Shop name and notes shown in Telugu / Hindi (display only; saved text never changes) ---------- */
  // Everyday note and shop-board words. Notes are translated; shop-board words are written as people say them.
  var TEXT_WORDS = { "groceries": ["సరుకులు", "किराना सामान"], "grocery": ["సరుకులు", "किराना"], "items": ["సరుకులు", "सामान"], "goods": ["సరుకులు", "सामान"], "paid": ["చెల్లించారు", "भुगतान किया"], "payment": ["చెల్లింపు", "भुगतान"], "cash": ["నగదు", "नकद"], "advance": ["అడ్వాన్స్", "एडवांस"], "balance": ["బాకీ", "बकाया"], "pending": ["బాకీ", "बाकी"], "old": ["పాత", "पुराना"], "part": ["కొంత", "आंशिक"], "partial": ["కొంత", "आंशिक"], "monthly": ["నెలవారీ", "महीने का"], "month": ["నెల", "महीना"], "and": ["మరియు", "और"], "for": ["కోసం", "के लिए"], "upi": ["యూపీఐ", "यूपीआई"], "gpay": ["జీపే", "जीपे"], "phonepe": ["ఫోన్‌పే", "फ़ोनपे"], "paytm": ["పేటీఎం", "पेटीएम"], "rice": ["బియ్యం", "चावल"], "dal": ["పప్పు", "दाल"], "milk": ["పాలు", "दूध"], "oil": ["నూనె", "तेल"], "sugar": ["చక్కెర", "चीनी"], "salt": ["ఉప్పు", "नमक"], "tea": ["టీ", "चाय"], "coffee": ["కాఫీ", "कॉफ़ी"], "eggs": ["గుడ్లు", "अंडे"], "egg": ["గుడ్డు", "अंडा"], "bread": ["బ్రెడ్", "ब्रेड"], "vegetables": ["కూరగాయలు", "सब्ज़ियाँ"], "soap": ["సబ్బు", "साबुन"], "biscuits": ["బిస్కెట్లు", "बिस्कुट"], "atta": ["గోధుమ పిండి", "आटा"], "flour": ["పిండి", "आटा"], "wheat": ["గోధుమలు", "गेहूँ"], "onions": ["ఉల్లిపాయలు", "प्याज़"], "onion": ["ఉల్లిపాయ", "प्याज़"], "potatoes": ["బంగాళదుంపలు", "आलू"], "ghee": ["నెయ్యి", "घी"], "curd": ["పెరుగు", "दही"], "snacks": ["చిరుతిళ్ళు", "नमकीन"], "water": ["నీళ్ళు", "पानी"], "chocolate": ["చాక్లెట్", "चॉकलेट"], "detergent": ["డిటర్జెంట్", "डिटर्जेंट"], "shampoo": ["షాంపూ", "शैम्पू"], "toothpaste": ["టూత్‌పేస్ట్", "टूथपेस्ट"], "gas": ["గ్యాస్", "गैस"], "recharge": ["రీఛార్జ్", "रिचार्ज"], "store": ["స్టోర్", "स्टोर"], "stores": ["స్టోర్స్", "स्टोर्स"], "provision": ["ప్రొవిజన్", "प्रोविज़न"], "provisions": ["ప్రొవిజన్స్", "प्रोविज़न्स"], "general": ["జనరల్", "जनरल"], "kirana": ["కిరాణా", "किराना"], "shop": ["షాప్", "शॉप"], "traders": ["ట్రేడర్స్", "ट्रेडर्स"], "mart": ["మార్ట్", "मार्ट"], "super": ["సూపర్", "सुपर"], "market": ["మార్కెట్", "मार्केट"], "supermarket": ["సూపర్‌మార్కెట్", "सुपरमार्केट"], "enterprises": ["ఎంటర్‌ప్రైజెస్", "एंटरप्राइज़ेज़"], "agency": ["ఏజెన్సీ", "एजेंसी"], "agencies": ["ఏజెన్సీస్", "एजेंसीज़"], "centre": ["సెంటర్", "सेंटर"], "center": ["సెంటర్", "सेंटर"], "medical": ["మెడికల్", "मेडिकल"], "fancy": ["ఫ్యాన్సీ", "फैंसी"], "bakery": ["బేకరీ", "बेकरी"], "sweets": ["స్వీట్స్", "स्वीट्स"], "dairy": ["డెయిరీ", "डेयरी"], "new": ["న్యూ", "न्यू"], "fictional": ["కల్పితం", "काल्पनिक"], "sample": ["నమూనా", "नमूना"], "demo": ["డెమో", "डेमो"] };
  // Whole notes or word pairs that read better as one phrase
  var TEXT_PHRASES = { "paid by cash": ["నగదుగా చెల్లించారు", "नकद भुगतान किया"], "paid in cash": ["నగదుగా చెల్లించారు", "नकद भुगतान किया"], "paid on upi": ["యూపీఐ ద్వారా చెల్లించారు", "यूपीआई से भुगतान किया"], "google pay": ["గూగుల్ పే", "गूगल पे"], "phone pe": ["ఫోన్‌పే", "फ़ोनपे"] };
  function displayText(text, code) {
    if (code !== "te" && code !== "hi") return String(text == null ? "" : text);
    var col = code === "te" ? 0 : 1, s = String(text == null ? "" : text);
    var whole = s.trim().toLowerCase().replace(/\s+/g, " ");
    if (TEXT_PHRASES.hasOwnProperty(whole)) return TEXT_PHRASES[whole][col];
    // "paid by cash", "paid via GPay" ...: how it was paid comes first, then "paid"
    var how = /^paid\s+(?:on|by|via|in|through|using|with)\s+(.+)$/i.exec(s.trim());
    if (how) return displayText(how[1], code) + (code === "te" ? " ద్వారా చెల్లించారు" : " से भुगतान किया");
    Object.keys(TEXT_PHRASES).forEach(function (k) {
      if (k.indexOf(" ") > -1) s = s.replace(new RegExp("\\b" + k.replace(/ /g, "\\s+") + "\\b", "gi"), TEXT_PHRASES[k][col]);
    });
    return s.replace(/[A-Za-z]+/g, function (w) {
      var key = w.toLowerCase();
      if (TEXT_WORDS.hasOwnProperty(key)) return TEXT_WORDS[key][col];
      if (NAME_WORDS.hasOwnProperty(key)) return NAME_WORDS[key][col];
      // Short capitals like "ABC" are read letter by letter
      if (w.length <= 4 && w === w.toUpperCase()) return w.toLowerCase().split("").map(function (ch) { return LETTERS[ch][col]; }).join("");
      if (key.length === 1 && LETTERS[key]) return LETTERS[key][col];
      return translitWord(w, code, true);
    });
  }


  /* ---------- Telugu / Hindi letters back to English letters (for English mode) ---------- */
  // Built from Unicode order: Telugu and Devanagari share the same layout, offset 0x0C00 and 0x0900
  var BACK_CONS = { 0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "n", 0x1A: "ch", 0x1B: "chh", 0x1C: "j", 0x1D: "jh", 0x1E: "n",
    0x1F: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n", 0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x2A: "p", 0x2B: "ph",
    0x2C: "b", 0x2D: "bh", 0x2E: "m", 0x2F: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x35: "v", 0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h",
    0x58: "q", 0x59: "kh", 0x5A: "g", 0x5B: "z", 0x5C: "r", 0x5D: "rh", 0x5E: "f", 0x5F: "y" };
  var BACK_VOW = { 0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ee", 0x09: "u", 0x0A: "oo", 0x0B: "ru", 0x0E: "e", 0x0F: "e", 0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au" };
  var BACK_SIGN = { 0x3E: "aa", 0x3F: "i", 0x40: "ee", 0x41: "u", 0x42: "oo", 0x43: "ru", 0x45: "o", 0x46: "e", 0x47: "e", 0x48: "ai", 0x49: "o", 0x4A: "o", 0x4B: "o", 0x4C: "au" };
  var NUKTA = { 0x15: 0x58, 0x16: 0x59, 0x17: 0x5A, 0x1C: 0x5B, 0x21: 0x5C, 0x22: 0x5D, 0x2B: 0x5E, 0x2F: 0x5F };
  function scriptOf(text) {
    var s = String(text || "");
    if (/[ఀ-౿]/.test(s)) return "te";
    if (/[ऀ-ॿ]/.test(s)) return "hi";
    return "";
  }
  // One word by sound: రవి -> ravi, कुमार -> kumar, బియ్యం -> biyyam
  function toLatinWord(word) {
    var code = scriptOf(word); if (!code) return word;
    var base = code === "te" ? 0x0C00 : 0x0900, out = "", pend = false, chars = Array.from(word);
    for (var i = 0; i < chars.length; i++) {
      var o = chars[i].codePointAt(0) - base;
      if (o < 0 || o > 0x7F) { if (pend) { out += "a"; pend = false; } out += chars[i]; continue; }
      if (BACK_CONS[o] != null) {
        if (pend) out += "a";
        var nx = chars[i + 1] ? chars[i + 1].codePointAt(0) - base : -1;
        if (nx === 0x3C && NUKTA[o]) { o = NUKTA[o]; i++; }
        out += BACK_CONS[o]; pend = true;
      } else if (BACK_SIGN[o] != null) { out += BACK_SIGN[o]; pend = false; }
      else if (o === 0x4D) pend = false;                       // virama: no vowel
      else if (BACK_VOW[o] != null) { if (pend) out += "a"; out += BACK_VOW[o]; pend = false; }
      else if (o === 0x02 || o === 0x01) {                      // anusvara / chandrabindu
        if (pend) { out += "a"; pend = false; }
        var n2 = chars[i + 1] ? chars[i + 1].codePointAt(0) - base : -1;
        out += (n2 >= 0x2A && n2 <= 0x2E) || n2 === 0x39 || n2 < 0 ? "m" : "n";
      }
      else if (o === 0x03) { if (pend) { out += "a"; pend = false; } out += "h"; }
      else if (o === 0x3C) {}                                     // stray nukta
      else { if (pend) { out += "a"; pend = false; } }
    }
    if (pend && code === "te") out += "a";                       // Telugu keeps the last "a"; Hindi drops it (राम -> ram)
    // Easier to read: long vowels at the very end are written short (దేవి/देवी -> devi), "aa" -> "a"
    out = out.replace(/ee$/, "i").replace(/oo$/, "u").replace(/aa/g, "a");
    if (code === "hi" && out.length <= 2 && pend) out += "a";
    return out;
  }
  // Script word -> English key, from the name and note lists (first one wins)
  var BACK_NAME = {}, BACK_TEXT = {};
  (function () {
    var k;
    for (k in NAME_WORDS) for (var c = 0; c < 2; c++) if (!BACK_NAME[NAME_WORDS[k][c]]) BACK_NAME[NAME_WORDS[k][c]] = k;
    for (k in TEXT_PHRASES) for (c = 0; c < 2; c++) if (!BACK_TEXT[TEXT_PHRASES[k][c]]) BACK_TEXT[TEXT_PHRASES[k][c]] = k;
    for (k in TEXT_WORDS) for (c = 0; c < 2; c++) if (!BACK_TEXT[TEXT_WORDS[k][c]]) BACK_TEXT[TEXT_WORDS[k][c]] = k;
  })();
  function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
  // Text written in Telugu or Hindi letters, in English letters.
  // kind "name": people's names (capitalised). kind "text": notes (known words are translated). kind "shop": like text, capitalised.
  // typed: { scriptWord: "the English letters the person typed" } from phonetic typing, used first for names.
  function toEnglish(text, kind, typed) {
    var s = String(text == null ? "" : text);
    if (!scriptOf(s)) return s;
    typed = typed || {};
    if (kind === "text" && BACK_TEXT.hasOwnProperty(s.trim())) return BACK_TEXT[s.trim()];
    var WORD = /[ऀ-ॿఀ-౿‌‍]+/g;
    return s.replace(WORD, function (w) {
      var out;
      if (kind === "name") out = typed[w] || (BACK_NAME[w] != null ? BACK_NAME[w] : toLatinWord(w));
      else out = BACK_TEXT[w] != null ? BACK_TEXT[w] : typed[w] || BACK_NAME[w] || toLatinWord(w);
      return kind === "text" ? out : cap(String(out).toLowerCase());
    });
  }
  // What to show for a saved name / note / shop name in the chosen language.
  // saved: as typed. en: the English letters kept beside it (may be empty).
  function shownIn(saved, en, code, kind) {
    var s = String(saved == null ? "" : saved), sc = scriptOf(s);
    if (code !== "te" && code !== "hi") return sc ? (en || toEnglish(s, kind)) : s;
    if (sc === code) return s;                                    // already in this language: keep the person's own spelling
    var base = sc ? (en || toEnglish(s, kind)) : s;
    return kind === "name" ? displayName(base, code) : displayText(base, code);
  }

  return {
    pad: pad, isoOf: isoOf, parseISO: parseISO, todayFrom: todayFrom, daysBetween: daysBetween,
    OVERDUE_DAYS: OVERDUE_DAYS, summarise: summarise, totalOutstanding: totalOutstanding, sortedEntries: sortedEntries, overdueList: overdueList,
    cleanPhone: cleanPhone, isValidPhone: isValidPhone, hasLetter: hasLetter, amountProblem: amountProblem, isValidUpi: isValidUpi, MAX_AMOUNT: MAX_AMOUNT,
    uid: uid, nextSeq: nextSeq, noteSeq: noteSeq,
    parseShop: parseShop, buildCsv: buildCsv, pickAmount: pickAmount, translitText: translitText, displayName: displayName, displayText: displayText, scriptOf: scriptOf, toEnglish: toEnglish, shownIn: shownIn
  };
});
