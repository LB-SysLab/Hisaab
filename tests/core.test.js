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
    ["UPI ref 612345678901", null]
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
