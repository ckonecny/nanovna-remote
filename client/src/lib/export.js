// Saving measurements: Touchstone files and PNG pictures of the SVG charts in the HAM and Multi views.

const pad = (n) => String(n).padStart(2, '0');

export const dateStamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const timeStamp = (d = new Date()) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// "20 m" on 2026-11-02 -> "20m-20261102.s1p"; the time is added for the second save of a day when withTime is set
export const bandFileName = (band, ext, { withTime = false, now = new Date() } = {}) =>
    `${band.replace(/\s+/g, '')}-${dateStamp(now)}${withTime ? '-' + timeStamp(now) : ''}.${ext}`;

// points: [{ freq, real, imag }]
export const touchstone = (points) => '# Hz S RI R 50\n' + points.map(p => `${p.freq}\t${p.real}\t${p.imag}\n`).join('');

export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export const saveTouchstone = (points, name) => download(new Blob([touchstone(points)], { type: 'application/octet-stream' }), name);

// The charts are styled by CSS classes and variables of the page, which a standalone image does not have: copy the computed
// values onto the clone of every element.
const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'opacity'];
function inlineStyles(src, dst) {
    const cs = getComputedStyle(src);
    for (const p of STYLE_PROPS) dst.style.setProperty(p, cs.getPropertyValue(p));
    for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
}

function svgImage(svg) {
    const clone = svg.cloneNode(true);
    inlineStyles(svg, clone);
    const box = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', box.width);
    clone.setAttribute('height', box.height);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve({ img, w: box.width, h: box.height }); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('chart could not be rendered')); };
        img.src = url;
    });
}

// items: [{ title, svg }] drawn one below the other on the page's background colour. Returns a PNG blob.
export async function chartsToPng(items, { scale = 2 } = {}) {
    const styles = getComputedStyle(document.body);
    const bg = styles.backgroundColor, fg = styles.color;
    const imgs = await Promise.all(items.map(i => svgImage(i.svg)));
    const TITLE = 26, GAP = 8, PAD = 12;
    const width = Math.max(...imgs.map(i => i.w)) + 2 * PAD;
    const height = imgs.reduce((h, i) => h + TITLE + i.h + GAP, PAD);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = fg;
    ctx.font = '600 15px sans-serif';
    let y = PAD;
    imgs.forEach((i, n) => {
        ctx.fillText(items[n].title, PAD, y + 18);
        ctx.drawImage(i.img, PAD, y + TITLE, i.w, i.h);
        y += TITLE + i.h + GAP;
    });
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

// the charts of the HAM view (SWR plus the extra charts) and of the Multi view (one per band card), with titles
export function hamChartItems(root, band) {
    const svgs = [...root.querySelectorAll('svg.chart')];
    const extra = [...root.querySelectorAll('.extra .label')].map(e => e.textContent.trim());
    return svgs.map((svg, i) => ({ title: i ? extra[i - 1] : band + ' SWR', svg }));
}

export function multiChartItems(root) {
    return [...root.querySelectorAll('.card')].map(card => {
        const name = card.querySelector('.name').textContent.trim(), swr = card.querySelector('.swr');
        return { title: name + (swr ? '  min SWR ' + swr.textContent.trim() : ''), svg: card.querySelector('svg.chart') };
    });
}
