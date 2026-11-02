// Takes the screenshots for the manual and the feature page from the simulator.
// Start the simulator first (dev-tools/simulator.py, needs `npm run build:esp` in client/), then:
//   npm install && node shots.mjs [out-dir] [port]
// The shots show modelled values, not measurements.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '../../site/img';
const PORT = process.argv[3] || '8765';
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dut = (name) => fetch(`${BASE}/sim/dut/${name}`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };

async function open(viewport, scheme) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(`${BASE}/?host=localhost:${PORT}`, { waitUntil: 'networkidle2' });
    return page;
}

// clicks the element of the selector whose text is exactly `text`
async function click(page, selector, text) {
    const ok = await page.evaluate((sel, t) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().replace(/\s+/g, ' ') === t);
        if (el) el.click();
        return !!el;
    }, selector, text);
    if (!ok) throw new Error(`no ${selector} with text "${text}"`);
}
const tab = (page, name) => click(page, 'button.tab-btn', name);
const band = (page, name) => click(page, 'button.band', name);

// makes exactly these bands the selected ones in the Multi view
async function setMulti(page, names) {
    await page.evaluate((want) => {
        for (const b of document.querySelectorAll('.multi button.band')) {
            if (b.classList.contains('active') !== want.includes(b.textContent.trim())) b.click();
        }
    }, names);
}

// sets Start/Stop of the Smith and Freq views through the keypad
async function setRange(page, start, stop) {
    for (const [i, value] of [[0, start], [1, stop]]) {
        await page.evaluate((n) => document.querySelectorAll('.freq-inputs .field')[n].click(), i);
        await sleep(300);
        for (const c of value) await click(page, '.key-btn', c);
        await click(page, '.key-btn', 'M');
        await sleep(400);
    }
}

async function connect(page) {
    await page.evaluate(() => [...document.querySelectorAll('header button')].find((b) => /connect$/.test(b.textContent.trim()))?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('header button')].some((b) => /Pause|Resume/.test(b.textContent)), { timeout: 20000 });
    await sleep(1500);
}

async function shot(page, name) {
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(name);
}

// calibrates all bands with the simulated standards
async function calibrate(page) {
    await tab(page, 'HAM');
    for (const [name, standard] of [['Open', 'open'], ['Short', 'short'], ['Load', 'load']]) {
        await dut(standard);
        await sleep(800);
        await click(page, 'button.band', `Measure ${name}`);
        await page.waitForFunction((n) => [...document.querySelectorAll('button.band')].some((b) => b.textContent.includes(`Measure ${n}`) && !b.disabled), { timeout: 90000 }, name);
        await sleep(1000);
    }
    await page.waitForFunction(() => /14 of 14/.test(document.body.textContent), { timeout: 30000 });
    await dut('antenna');
    await sleep(1500);
}

async function scrollTo(page, text) {
    await page.evaluate((t) => {
        const el = [...document.querySelectorAll('.cal .label, .extras .label, .label')].find((e) => e.textContent.includes(t));
        if (el) el.scrollIntoView({ block: 'start' });
    }, text);
    await sleep(500);
}

// ---------------------------------------------------------------- phone, dark
let page = await open(PHONE, 'dark');
await connect(page);
await calibrate(page);

await tab(page, 'Single');
await sleep(500);
await page.evaluate(() => document.querySelector('button.freq').click());
await sleep(300);
for (const c of '7.1') await click(page, '.key-btn', c);
await click(page, '.key-btn', 'M');
await shot(page, 'phone-single');

await tab(page, 'HAM');
await band(page, '20 m');
await shot(page, 'phone-ham');
await scrollTo(page, 'Also show');
await shot(page, 'phone-ham-extras');
await scrollTo(page, 'Calibration');
await shot(page, 'phone-calibration');

await tab(page, 'Multi');
await setMulti(page, ['40 m', '20 m', '15 m', '10 m', '2 m']);
await sleep(9000);
await shot(page, 'phone-multi');

await tab(page, 'Cable');
await dut('cable-open');
await shot(page, 'phone-cable');

await tab(page, 'TDR');
await dut('cable-fault');
await shot(page, 'phone-tdr');

await dut('antenna');
await tab(page, 'Smith');
await setRange(page, '3', '30');
await shot(page, 'phone-smith');
await tab(page, 'Freq');
await shot(page, 'phone-freq');

await tab(page, 'HAM');
await page.evaluate(() => document.querySelector('header button.btn-icon').click());
await shot(page, 'phone-menu');
await page.close();

// ---------------------------------------------------------------- phone, light
page = await open(PHONE, 'light');
await connect(page);
await tab(page, 'HAM');
await band(page, '40 m');
await shot(page, 'phone-ham-light');
await tab(page, 'Multi');
await setMulti(page, ['40 m', '20 m', '15 m', '10 m', '2 m']);
await sleep(9000);
await shot(page, 'phone-multi-light');
await page.close();

// ---------------------------------------------------------------- desktop
for (const scheme of ['dark', 'light']) {
    page = await open(DESKTOP, scheme);
    await connect(page);
    await tab(page, 'HAM');
    await band(page, '20 m');
    await shot(page, `desktop-ham-${scheme}`);
    if (scheme === 'dark') {
        await tab(page, 'Multi');
        await setMulti(page, ['80 m', '40 m', '20 m', '15 m', '10 m', '6 m']);
        await sleep(12000);
        await shot(page, 'desktop-multi-dark');
        await tab(page, 'Smith');
        await shot(page, 'desktop-smith-dark');
    }
    await page.close();
}

await browser.close();
