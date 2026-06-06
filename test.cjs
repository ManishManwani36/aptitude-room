/* Playwright UI/UX + functionality verification for The Aptitude Room.
   Uses system Chrome (channel:'chrome'). Drives the real app, screenshots, probes. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = 'file://' + path.join(__dirname, 'index.html');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, cond, extra) => { results.push({ name, pass: !!cond, extra: extra || '' }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  let n = 0;
  const shot = async (label, full) => { const f = path.join(SHOTS, String(++n).padStart(2, '0') + '-' + label + '.png'); await page.screenshot({ path: f, fullPage: !!full }); return f; };

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app .sec-card');
  await page.waitForTimeout(700); // let fonts + card animation settle

  // ---------- HOME ----------
  await shot('home-light', true);
  check('home: 4 section cards', await page.locator('.sec-card').count() === 4);
  check('home: hero shows 80', (await page.locator('.hstat .n').first().innerText()).trim() === '80');
  const counts = await page.locator('.sec-card .meta b').allInnerTexts();
  check('home: each section shows 20 questions', counts.filter(t => t.trim() === '20').length >= 4, counts.join(','));

  // ---------- STUDY: NUMERICAL ----------
  await page.locator('.sec-card', { hasText: 'Numerical' }).getByRole('button', { name: 'Study' }).click();
  await page.waitForSelector('.qbody');
  const hasViz = await page.locator('.viz svg.chart, .viz table.dtable').count();
  check('numerical: chart/table renders', hasViz > 0);
  await shot('study-numerical-q1');
  // answer correctly
  const numAI = await page.evaluate(() => BANK.numerical[0].answerIndex);
  await page.locator('.opt').nth(numAI).click();
  await page.waitForSelector('.opt.correct');
  check('numerical: correct option highlighted on right pick', await page.locator('.opt.correct').count() === 1);
  check('numerical: reveal panel shows', await page.locator('.reveal.show').isVisible());
  check('numerical: reasoning text present', (await page.locator('.reveal.show .reasoning').innerText()).length > 40);
  await shot('study-numerical-reveal');

  // wrong-answer styling on Q2
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.waitForSelector('.qbody');
  const numAI2 = await page.evaluate(() => BANK.numerical[1].answerIndex);
  const wrong = (numAI2 + 1) % (await page.locator('.opt').count());
  await page.locator('.opt').nth(wrong).click();
  await page.waitForSelector('.opt.wrong');
  check('numerical: wrong pick shows both wrong+correct', (await page.locator('.opt.wrong').count() === 1) && (await page.locator('.opt.correct').count() === 1));
  await shot('study-numerical-wrong');

  // ---------- STUDY: INDUCTIVE (capture each layout via OMR jumps) ----------
  await page.evaluate(() => startStudy('inductive'));
  await page.waitForSelector('.frames .frame');
  check('inductive series: frames render', await page.locator('.frames .frame').count() >= 4);
  check('inductive series: options carry SVG figures', await page.locator('.opt .figbox svg').count() >= 4);
  await shot('study-inductive-series');
  // jump to a matrix (q9 = index 8)
  await page.locator('.omr button').nth(8).click();
  await page.waitForSelector('.matrix .mcell');
  check('inductive matrix: 3x3 grid renders', await page.locator('.matrix .mcell').count() === 9);
  check('inductive matrix: has a "?" cell', await page.locator('.matrix .mcell.q').count() === 1);
  await shot('study-inductive-matrix');
  // odd-one-out (q14 = index 13)
  await page.locator('.omr button').nth(13).click();
  await page.waitForSelector('.opt .figbox svg');
  check('inductive odd-one-out: 5 figure options', await page.locator('.opt.fig-opt').count() === 5);
  await shot('study-inductive-oddoneout');
  // analogy (q18 = index 17)
  await page.locator('.omr button').nth(17).click();
  await page.waitForSelector('.analogy');
  check('inductive analogy: A:B::C:? layout', await page.locator('.analogy .frame').count() >= 4);
  await shot('study-inductive-analogy');
  // verify an inductive answer reveals correctly
  const indAI = await page.evaluate(() => BANK.inductive[17].answerIndex);
  await page.locator('.opt').nth(indAI).click();
  await page.waitForSelector('.opt.correct');
  check('inductive: correct figure option highlights', await page.locator('.opt.correct').count() === 1);

  // ---------- STUDY: VERBAL ----------
  await page.evaluate(() => startStudy('verbal'));
  await page.waitForSelector('.passage');
  check('verbal: passage renders', (await page.locator('.passage').innerText()).length > 100);
  const vopts = await page.locator('.opt').allInnerTexts();
  check('verbal: True/False/Cannot Say options', vopts.some(t => /True/.test(t)) && vopts.some(t => /Cannot Say/.test(t)), vopts.map(t=>t.replace(/\s+/g,' ').trim()).join(' | ').slice(0,80));
  await shot('study-verbal');
  const verAI = await page.evaluate(() => BANK.verbal[0].answerIndex);
  await page.locator('.opt').nth(verAI).click();
  await page.waitForSelector('.reveal.show');
  await shot('study-verbal-reveal');

  // ---------- STUDY: DEDUCTIVE ----------
  await page.evaluate(() => startStudy('deductive'));
  await page.waitForSelector('.qbody');
  await shot('study-deductive');
  check('deductive: stem present', (await page.locator('.stem').first().innerText()).length > 10);

  // ---------- DARK MODE ----------
  await page.evaluate(() => go('home'));
  await page.waitForSelector('.sec-card');
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(300);
  check('theme: toggles to dark', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
  await shot('home-dark', true);
  await page.locator('#themeBtn').click(); // back to light
  await page.waitForTimeout(200);

  // ---------- QUIZ (single section: deductive) ----------
  await page.evaluate(() => startQuiz('deductive'));
  await page.waitForSelector('#timer');
  const t1 = await page.locator('#timer').innerText();
  check('quiz: timer present (MM:SS)', /^\d\d:\d\d$/.test(t1.trim()), t1);
  await page.waitForTimeout(1600);
  const t2 = await page.locator('#timer').innerText();
  check('quiz: timer counts down', t1 !== t2, t1 + ' -> ' + t2);
  check('quiz: no solution shown during test', await page.locator('.reveal').count() === 0);
  await shot('quiz-question');
  // flag current, then answer all 20 by clicking
  await page.getByRole('button', { name: /Flag for review/ }).click();
  check('quiz: flag toggles', await page.locator('.omr button.flag').count() >= 1);
  for (let i = 0; i < 20; i++) {
    await page.locator('.opt').first().click();
    const next = page.getByRole('button', { name: 'Next →' });
    if (await next.count()) await next.click(); else break;
    await page.waitForTimeout(40);
  }
  const filled = await page.evaluate(() => Object.keys(quiz.answers).length);
  check('quiz: answers recorded as you go', filled >= 19, 'filled=' + filled);
  await page.getByRole('button', { name: /Submit test/ }).click();
  await page.waitForSelector('.result-hero');
  check('quiz: results score renders', (await page.locator('.result-hero .score').innerText()).includes('/'));
  check('quiz: per-section breakdown card', await page.locator('.rcard').count() >= 1);
  await shot('quiz-results', true);
  // review
  await page.getByRole('button', { name: /Review answers/ }).click();
  await page.waitForSelector('.qbody');
  check('quiz: review shows solutions', await page.locator('.reveal.show').count() >= 1);
  await shot('quiz-review');

  // ---------- FULL MOCK results chart ----------
  await page.evaluate(() => { startQuiz('all'); quiz.questions.forEach((q,i)=>{ quiz.answers[q.id]= (i%3===0)? q.answerIndex : (q.answerIndex+1)%q.options.length; }); submitQuiz(false); });
  await page.waitForSelector('.result-hero');
  check('full mock: accuracy-by-section chart renders', await page.locator('svg.chart').count() >= 1);
  check('full mock: 4 section cards in results', await page.locator('.rcard').count() === 4);
  await shot('mock-results', true);

  // ---------- ANSWER KEY ----------
  await page.evaluate(() => go('key'));
  await page.waitForSelector('.key-item');
  check('answer key: lists items', await page.locator('.key-item').count() >= 20);
  check('answer key: shows answers + reasoning', (await page.locator('.key-item .kans').count()) >= 20 && (await page.locator('.key-item .kreason').count()) >= 20);
  await shot('answer-key', false);
  // filter
  await page.locator('.key-controls .seg button', { hasText: 'Inductive' }).click();
  await page.waitForTimeout(150);
  check('answer key: filter narrows to one section', await page.locator('.key-sec-title').count() === 1);
  // print media
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => setKeyFilter('all'));
  await page.waitForTimeout(150);
  await shot('answer-key-print', true);
  await page.emulateMedia({ media: 'screen' });

  // ---------- PROBE: persistence across reload ----------
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => startStudy('numerical'));
  await page.waitForSelector('.opt:not([disabled])');
  await page.locator('.opt').nth(0).click();
  await page.waitForTimeout(150);
  const beforeReload = await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('aptitude-room-v1') || '{}').answers) || {}).length);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('aptitude-room-v1') || '{}').answers) || {}).length);
  check('PROBE persistence: answer survives reload', afterReload >= 1 && afterReload === beforeReload, 'before=' + beforeReload + ' after=' + afterReload);
  // answered question should be locked/revealed after reload (documents study-mode lock behavior)
  await page.evaluate(() => startStudy('numerical'));
  await page.waitForSelector('.qbody');
  check('PROBE persistence: answered Q locked/revealed after reload', await page.locator('.opt[disabled]').count() >= 1);

  // ---------- PROBE: boundary (Prev disabled on first q) ----------
  await page.evaluate(() => startStudy('verbal'));
  await page.waitForSelector('.pager');
  const prevDisabled = await page.locator('.pager button', { hasText: 'Prev' }).first().isDisabled();
  check('PROBE boundary: Prev disabled on question 1', prevDisabled);

  // ---------- PROBE: reveal without selecting ----------
  await page.getByRole('button', { name: /Reveal solution/ }).click();
  await page.waitForSelector('.reveal.show');
  check('PROBE: reveal works without selecting an answer', (await page.locator('.reveal.show .verdict').innerText()).length > 0);

  // ---------- PROBE: mobile responsive ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => go('home'));
  await page.waitForSelector('.sec-card');
  await page.waitForTimeout(300);
  await shot('mobile-home', true);
  await page.evaluate(() => startStudy('numerical'));
  await page.waitForSelector('.qbody');
  await shot('mobile-numerical');
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  check('PROBE mobile: no horizontal overflow', noHScroll, 'scrollW vs innerW');

  // ---------- console / page errors ----------
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' || '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0,3).join(' || '));

  await browser.close();

  const passed = results.filter(r => r.pass).length;
  console.log('\n========================================');
  console.log(passed + '/' + results.length + ' checks passed');
  const fails = results.filter(r => !r.pass);
  if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f.name + (f.extra ? '  [' + f.extra + ']' : ''))); }
  if (consoleErrors.length) { console.log('\nCONSOLE ERRORS:'); consoleErrors.slice(0,8).forEach(e => console.log('  ! ' + e)); }
  console.log('\nScreenshots in ' + SHOTS);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(2); });
