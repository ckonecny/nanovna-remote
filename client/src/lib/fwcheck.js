// Is there a newer firmware for the connected NanoVNA? Only boards of the hugen79 firmware projects are checked:
// other builds use their own version numbers, and a wrong comparison would only confuse.

const REPOS = { 'NanoVNA-H': 'hugen79/NanoVNA-H', 'NanoVNA-H 4': 'hugen79/NanoVNA-H4' };

// "1.2.50" -> [1, 2, 50]; null when the text is no plain dotted version
export function parseVersion(text) {
    const m = /^v?(\d+(?:\.\d+)*)$/.exec(String(text || '').trim());
    return m ? m[1].split('.').map(Number) : null;
}

export function isNewer(latest, current) {
    const a = parseVersion(latest), b = parseVersion(current);
    if (!a || !b) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d > 0;
    }
    return false;
}

// the GitHub project of the board named in the `info` text, or null
export function firmwareRepo(info) {
    const m = /Board:\s*(NanoVNA-H(?: 4)?)\b/.exec(info || '');
    return m ? REPOS[m[1]] : null;
}

// { tag, url } of the latest release when it is newer than `version`, otherwise null (also on any error)
export async function newerFirmware(version, info, fetchFn = fetch) {
    const repo = firmwareRepo(info);
    if (!repo || !parseVersion(version)) return null;
    try {
        const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) return null;
        const rel = await res.json();
        return isNewer(rel.tag_name, version) ? { tag: rel.tag_name, url: rel.html_url } : null;
    } catch {
        return null;
    }
}
