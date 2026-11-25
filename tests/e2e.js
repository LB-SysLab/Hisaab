const {chromium}=require('playwright');const fs=require('fs');
// Browser check of the live site, as the tester does it. Needs Playwright.
// Run with: node tests/e2e.js https://your-site.vercel.app/
const U=process.argv[2]||'http://localhost:8765/';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:375,height:812}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(x?'  ['+x+']':''));
const data=fs.readFileSync(__dirname+'/fixtures/sample-data.json','utf8');const exp=JSON.parse(fs.readFileSync(__dirname+'/fixtures/sample-expected.json','utf8'));
await p.goto(U+'?today=2026-11-15');await p.evaluate(()=>localStorage.clear());await p.reload();
await p.fill('#import-box',data);await p.click('#import-go');await p.waitForTimeout(300);
const tot=await p.textContent('#total-outstanding');ok('total '+exp.total_outstanding,tot.replace(/\D/g,'')===String(exp.total_outstanding),tot);
ok('8 customers',(await p.$$('[data-customer]')).length===8);
for(const [ph,bal] of Object.entries(exp.balances)){const t=await p.textContent(`[data-customer="${ph}"] [data-balance]`);ok('bal '+ph,t.replace(/[^\d-]/g,'')===String(bal),t);}
const first=await p.getAttribute('#list [data-customer]','data-customer');ok('top defaulter first',first===exp.top_defaulter_phone,first);
const h=decodeURIComponent(await p.getAttribute('a[data-remind="9000000101"]','href'));ok('remind',h.startsWith('https://wa.me/919000000101?text=')&&h.includes('Ravi Kumar')&&h.includes('670')&&h.includes('upi://pay?pa=')&&h.includes('am=670'),h.slice(0,120));
await p.click('#f-late');const late=await p.$$eval('#list [data-customer]',l=>l.map(x=>x.dataset.customer+':'+x.querySelector('.tag').textContent));console.log('overdue list:',late.join(' | '));await p.click('#f-all');
await p.click('[data-customer="9000000101"] a.nm');await p.waitForTimeout(200);
const ents=await p.$$eval('#entries .entry',l=>l.map(e=>e.dataset.date+':'+e.dataset.type+':'+e.querySelector('.amt').dataset.amount));console.log(ents.join(' | '));
ok('ravi order',ents[0]==='2026-10-25:payment:1500'&&ents[1]==='2026-10-23:credit:180');
ok('shop name',(await p.textContent('#shop-name')).includes('Lakshmi'));
const d2=JSON.parse(data);d2.customers.push({name:'Empty Person',phone:'9000000199'});await p.click('#back-btn');await p.fill('#import-box',JSON.stringify(d2));await p.click('#import-go');
ok('no-entry customer loads',(await p.$$('[data-customer]')).length===9 && (await p.textContent('[data-customer="9000000199"] [data-balance]')).includes('0'));
ok('no sideways',(await p.evaluate(()=>document.documentElement.scrollWidth))<=375);
await p.reload();ok('persists after reload',(await p.$$('[data-customer]')).length===9);

async function addCust(n,ph){await p.click('#add-cust-btn');await p.fill('#cust-name',n);await p.fill('#cust-phone',ph);await p.click('#cust-save');}
await addCust('Bad','900000010');ok('9-digit phone refused',await p.isVisible('#cust-err'));await p.click('#sheet-cust [data-close]');
await addCust('Bad','90000abc01');ok('letters in phone refused',await p.isVisible('#cust-err'));await p.click('#sheet-cust [data-close]');
await addCust('Test Person','9000000188');ok('new customer on home list',!!(await p.$('[data-customer="9000000188"]')));
await p.click('[data-customer="9000000188"] a.nm');await p.click('#add-credit');await p.fill('#entry-amount','250');await p.click('#entry-save');
ok('credit 250 gives balance 250',(await p.textContent('#c-balance')).includes('250'));
await p.click('#add-payment');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
await p.setInputFiles('#shot-input',{name:'pay.png',mimeType:'image/png',buffer:png});await p.waitForTimeout(500);await p.fill('#entry-amount','100');await p.click('#entry-save');await p.waitForTimeout(300);
ok('payment shows picture',!!(await p.$('img[data-shot]')));await p.reload();ok('picture still there after reload',!!(await p.$('img[data-shot]')));
await p.click('[data-edit]');await p.fill('#entry-amount','50');await p.click('#entry-save');ok('edit recalculates',(await p.textContent('#c-balance')).includes('200'));
await p.click('[data-del]');await p.click('[data-del]');ok('delete recalculates',(await p.textContent('#c-balance')).includes('250'));
console.log('errors',errs);await b.close()})();
