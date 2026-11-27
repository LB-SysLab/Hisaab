// Run with: node --test tests/core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../js/core.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const SAMPLE = read("sample-data.json");
const EXPECTED = JSON.parse(read("sample-expected.json"));
const TODAY = Core.todayFrom("?today=" + EXPECTED.today);
const load = (text) => Core.parseShop(text || SAMPLE, { name: "", upi: "" }, EXPECTED.today);

test("sample file loads 8 customers and the shop name", () => {
  const d = load();
  assert.equal(d.customers.length, 8);
  assert.match(d.shop.name, /Lakshmi Provision Store/);
});

test("total outstanding matches sample-expected", () => {
  assert.equal(Core.totalOutstanding(load().customers, TODAY), EXPECTED.total_outstanding);
});

test("every balance matches sample-expected", () => {
  const d = load();
  for (const [phone, bal] of Object.entries(EXPECTED.balances)) {
    const c = d.customers.find((x) => x.phone === phone);
    assert.ok(c, "missing " + phone);
    assert.equal(Core.summarise(c, TODAY).bal, bal, phone);
  }
  const withBalance = d.customers.filter((c) => Core.summarise(c, TODAY).bal > 0).length;
  assert.equal(withBalance, EXPECTED.customers_with_balance);
});

test("top defaulter is the biggest balance", () => {
  const d = load();
  const top = d.customers.slice().sort((a, b) => Core.summarise(b, TODAY).bal - Core.summarise(a, TODAY).bal)[0];
  assert.equal(top.phone, EXPECTED.top_defaulter_phone);
});

test("Ravi's entries are newest first: 25 Oct payment above 23 Oct credit", () => {
  const ravi = load().customers.find((c) => c.phone === "9000000101");
  const [a, b] = Core.sortedEntries(ravi);
  assert.deepEqual([a.date, a.type, a.amount], ["2026-10-25", "payment", 1500]);
  assert.deepEqual([b.date, b.type, b.amount], ["2026-10-23", "credit", 180]);
});

test("a customer with no entries still loads with balance 0", () => {
  const data = JSON.parse(SAMPLE);
  data.customers.push({ name: "No Entries", phone: "9000000199" });
  const d = load(JSON.stringify(data));
  const c = d.customers.find((x) => x.phone === "9000000199");
  assert.equal(Core.summarise(c, TODAY).bal, 0);
  assert.equal(Core.totalOutstanding(d.customers, TODAY), EXPECTED.total_outstanding);
});

test("entries nested inside each customer also load", () => {
  const d = load(JSON.stringify({ customers: [{ name: "A", phone: "+91 91111 11111", entries: [{ type: "credit", amount: "1,000", date: "05/11/2026" }, { type: "payment", amount: 400, date: "2026-11-06" }] }] }));
  assert.equal(d.customers[0].phone, "9111111111");
  assert.equal(Core.summarise(d.customers[0], TODAY).bal, 600);
  assert.equal(d.customers[0].entries[0].date, "2026-11-05");
});

test("broken data is refused", () => {
  assert.throws(() => load("not json"));
  assert.throws(() => load("{}"));
});

test("overdue list is sorted by days since last payment", () => {
  const list = Core.overdueList(load().customers, TODAY);
  assert.ok(list.length > 0);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].s.days >= list[i].s.days);
  assert.ok(list.every((r) => r.s.days >= Core.OVERDUE_DAYS && r.s.bal > 0));
});

test("?today= sets the date, otherwise today", () => {
  assert.equal(Core.isoOf(Core.todayFrom("?today=2026-11-15")), "2026-11-15");
  assert.equal(Core.isoOf(Core.todayFrom("")), Core.isoOf(new Date()));
});

test("phone must be exactly 10 digits", () => {
  assert.ok(Core.isValidPhone("9000000101"));
  assert.ok(Core.isValidPhone("90000 00101"));
  assert.ok(!Core.isValidPhone("900000010"));
  assert.ok(!Core.isValidPhone("90000abc01"));
  assert.ok(!Core.isValidPhone("90000001011"));
});

test("CSV has every entry and the right total", () => {
  const d = load();
  const csv = Core.buildCsv(d.customers, TODAY).split("\r\n");
  const entryCount = d.customers.reduce((n, c) => n + c.entries.length, 0);
  assert.equal(csv.length, 1 + entryCount + 1);
  assert.equal(csv[csv.length - 1], "TOTAL OUTSTANDING,,,,,," + EXPECTED.total_outstanding);
});

test("amount is read from payment screenshot text, even when ₹ is misread", () => {
  const cases = [
    ["₹1,500\nPaid to Lakshmi Provision Store", 1500],
    ["¥1,500\nPaid to Lakshmi Provision Store\nUPI transaction ID 612345678901\n", 1500],
    ["%850\nfrom 9000000101", 850],
    ["Payment successful\nRs. 500.00\n25 Oct 2026", 500],
    ["Paid\n€ 2,340\nTo SHOP", 2340],
    ["Sent 1,25,000", 125000],
    ["UPI ref 612345678901", null],
    ["R450\n\nPaid to LAKSHMI STORE\n\n27 Nov 2026, 6:42 pm\n\nUPI transaction ID 6201445588\n", 450],
    ["#1,250\n", 1250],
    ["UPI Ref No R1234567890", null]
  ];
  for (const [text, want] of cases) assert.equal(Core.pickAmount(text), want, JSON.stringify(text));
});

test("typing in English letters becomes Telugu or Hindi", () => {
  assert.equal(Core.translitText("biyyam, pappu", "te"), "బియ్యం, పప్పు");
  assert.equal(Core.translitText("chaawal aur daal", "hi"), "चावल और दाल");
  assert.equal(Core.translitText("Ramesh Kumaar", "hi"), "रमेश कुमार");
  assert.equal(Core.translitText("250 paalu", "te"), "250 పాలు");
  assert.equal(Core.translitText("biyy", "te", true), "biyy", "the word still being typed is left alone");
});

test("names show in Telugu or Hindi letters; English and saved names stay the same", () => {
  const want = {
    "Ravi Kumar": ["రవి కుమార్", "रवि कुमार"], "Sunita Devi": ["సునీత దేవి", "सुनीता देवी"], "Mohd Irfan": ["మొహమ్మద్ ఇర్ఫాన్", "मोहम्मद इरफ़ान"],
    "Anjali Reddy": ["అంజలి రెడ్డి", "अंजलि रेड्डी"], "Prakash Rao": ["ప్రకాష్ రావు", "प्रकाश राव"], "Fatima Begum": ["ఫాతిమా బేగం", "फ़ातिमा बेगम"],
    "Venkat Naidu": ["వెంకట్ నాయుడు", "वेंकट नायडू"], "Kavitha S": ["కవిత ఎస్", "कविता एस"]
  };
  for (const c of load().customers) {
    assert.deepEqual([Core.displayName(c.name, "te"), Core.displayName(c.name, "hi")], want[c.name], c.name);
    assert.equal(Core.displayName(c.name, "en"), c.name);
  }
  assert.equal(Core.displayName("సీత లక్ష్మి", "hi"), "సీత లక్ష్మి", "names already in a script are left alone");
});

test("shop name and notes show in Telugu or Hindi; English and saved text stay the same", () => {
  const want = {
    "groceries": ["సరుకులు", "किराना सामान"], "paid on UPI": ["యూపీఐ ద్వారా చెల్లించారు", "यूपीआई से भुगतान किया"],
    "Lakshmi Provision Store (fictional)": ["లక్ష్మి ప్రొవిజన్ స్టోర్ (కల్పితం)", "लक्ष्मी प्रोविज़न स्टोर (काल्पनिक)"],
    "rice, dal and milk": ["బియ్యం, పప్పు మరియు పాలు", "चावल, दाल और दूध"], "paid by cash": ["నగదుగా చెల్లించారు", "नकद भुगतान किया"]
  };
  for (const k in want) {
    assert.deepEqual([Core.displayText(k, "te"), Core.displayText(k, "hi")], want[k], k);
    assert.equal(Core.displayText(k, "en"), k);
  }
  assert.equal(Core.displayText("బియ్యం", "te"), "బియ్యం", "text already in a script is left alone");
  assert.equal(Core.displayText("", "te"), "");
});

test("names and notes typed in Telugu or Hindi show in English letters in English mode", () => {
  assert.equal(Core.toEnglish("రవి కుమార్", "name"), "Ravi Kumar");
  assert.equal(Core.toEnglish("अजय वर्मा", "name"), "Ajay Verma");
  assert.equal(Core.toEnglish("భస్కర్ రెద్ది", "name", { "భస్కర్": "Bhaskar", "రెద్ది": "Reddy" }), "Bhaskar Reddy", "the English letters typed win");
  assert.equal(Core.toEnglish("బియ్యం", "text"), "rice");
  assert.equal(Core.toEnglish("चीनी 2 किलो", "text"), "sugar 2 kilo");
  assert.equal(Core.shownIn("రవి కుమార్", "", "en", "name"), "Ravi Kumar");
  assert.equal(Core.shownIn("రవి కుమార్", "", "hi", "name"), "रवि कुमार", "Telugu name shows in Hindi letters in Hindi mode");
  assert.equal(Core.shownIn("రవి కుమార్", "", "te", "name"), "రవి కుమార్", "own language keeps the saved spelling");
  assert.equal(Core.shownIn("Ravi Kumar", undefined, "en", "name"), "Ravi Kumar", "English names never change");
});

test("field checks: phone, name, amount and UPI ID", () => {
  assert.ok(!Core.isValidPhone("+91 98765 43210"), "no country code");
  assert.ok(!Core.isValidPhone("0000000000"), "cannot start with 0");
  assert.ok(!Core.isValidPhone("09876543210"));
  assert.ok(!Core.isValidPhone("0123456789"));
  assert.ok(!Core.isValidPhone("1234567890"), "must start with 6-9");
  assert.ok(!Core.isValidPhone("5876543210"));
  assert.ok(Core.isValidPhone("6000000000") && Core.isValidPhone("7000000000") && Core.isValidPhone("8000000000"));
  assert.ok(Core.isValidPhone("98765-43210"));
  assert.ok(!Core.isValidPhone("98765432101"));
  assert.ok(Core.hasLetter("Ravi Kumar") && Core.hasLetter("రవి") && Core.hasLetter("रवि"));
  assert.ok(!Core.hasLetter("12345") && !Core.hasLetter("@@##"));
  assert.equal(Core.amountProblem("250"), "");
  assert.equal(Core.amountProblem("150.50"), "");
  assert.equal(Core.amountProblem("1000000"), "");
  assert.equal(Core.amountProblem("1000000.01"), "max");
  assert.equal(Core.amountProblem("12.345"), "format");
  assert.equal(Core.amountProblem("0"), "zero");
  assert.equal(Core.amountProblem("-5"), "zero");
  assert.equal(Core.amountProblem(""), "zero");
  assert.ok(Core.isValidUpi("shopname@okaxis") && Core.isValidUpi("ravi.kumar-1@ybl"));
  assert.ok(!Core.isValidUpi("hello") && !Core.isValidUpi("@okaxis") && !Core.isValidUpi("a b@okaxis"));
});

test("delete customer only when balance is 0 and 60 days have passed", () => {
  const today = Core.parseISO("2026-11-27");
  assert.equal(Core.CLOSE_DAYS, 60);
  const closed = { entries: [{ type: "credit", amount: 500, date: "2026-08-01" }, { type: "payment", amount: 500, date: "2026-09-20" }] };
  assert.equal(Core.deleteCheck(closed, today).ok, true); // 68 days since last entry
  const recent = { entries: [{ type: "credit", amount: 500, date: "2026-10-01" }, { type: "payment", amount: 500, date: "2026-10-20" }] };
  const r = Core.deleteCheck(recent, today);
  assert.equal(r.ok, false); assert.equal(r.why, "wait"); assert.equal(r.until, "2026-12-19"); assert.equal(r.left, 22);
  const owes = Core.deleteCheck({ entries: [{ type: "credit", amount: 120, date: "2026-01-01" }] }, today);
  assert.equal(owes.ok, false); assert.equal(owes.why, "balance"); assert.equal(owes.bal, 120);
  assert.equal(Core.deleteCheck({ entries: [{ type: "payment", amount: 50, date: "2026-01-01" }] }, today).why, "balance"); // advance
  assert.equal(Core.deleteCheck({ added: "2026-10-27", entries: [] }, today).why, "wait"); // 31 days: not yet
  assert.equal(Core.deleteCheck({ added: "2026-09-29", entries: [] }, today).why, "wait"); // 59 days: not yet
  assert.equal(Core.deleteCheck({ added: "2026-09-28", entries: [] }, today).ok, true); // 60 days
  assert.equal(Core.deleteCheck({ entries: [] }, today).ok, true); // nothing recorded
});
