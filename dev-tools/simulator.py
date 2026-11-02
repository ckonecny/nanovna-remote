#!/usr/bin/env python3
"""Simulated NanoVNA bridge for screenshots and tests without hardware.

Behaves like the ESP32 bridge: serves the web app (client/dist, built with `npm run build:esp`), stores the app-side
calibration (/api/appcal) and speaks the NanoVNA text shell over WebSocket (/ws). The measurements are modelled:
the raw readings carry error terms, so the app's own open/short/load calibration works on them like on a real device.

What is connected is chosen with GET /sim/dut/<name> (no name: list). Names:
  antenna      multiband antenna with a resonance in every ham band (default)
  open short load   the calibration standards (the load is slightly imperfect)
  cable-open cable-short   25 m of coax (velocity factor 0.66, lossy) with the far end open or shorted
  cable-fault  the same cable, open at the end, with a damaged spot at 12 m

needs aiohttp (pip install aiohttp)
usage: simulator.py [port]      then open http://localhost:<port>/?host=localhost:<port>
The values are modelled, not measured.
"""
import cmath, math, random, struct, sys
from pathlib import Path

from aiohttp import WSMsgType, web

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = Path(__file__).resolve().parent.parent / "client" / "dist"
STATE_DIR = Path(__file__).resolve().parent / "sim_state"
APPCAL = STATE_DIR / "appcal.json"

C0 = 299792458.0
BANDS = [(1.81e6, 2.0e6), (3.5e6, 3.8e6), (5.3515e6, 5.3665e6), (7.0e6, 7.2e6), (10.1e6, 10.15e6), (14.0e6, 14.35e6),
         (18.068e6, 18.168e6), (21.0e6, 21.45e6), (24.89e6, 24.99e6), (28.0e6, 29.7e6), (50e6, 52e6), (70e6, 70.5e6),
         (144e6, 146e6), (430e6, 440e6)]
# resonance position inside the band (fraction), feed resistance and Q: a little different in every band
RES = [(0.55, 46, 14), (0.35, 58, 9), (0.50, 52, 40), (0.42, 49, 18), (0.60, 44, 60), (0.38, 53, 25), (0.55, 61, 55),
       (0.45, 47, 20), (0.50, 51, 70), (0.30, 55, 12), (0.60, 43, 16), (0.50, 50, 45), (0.40, 57, 30), (0.52, 48, 8)]

# NanoVNA-H raw error terms (what the app's calibration removes)
def error_terms(f):
    ed = 0.045 * cmath.exp(1j * (0.4 + f / 9e7))
    es = 0.07 * cmath.exp(1j * (-0.9 + f / 2.5e8))
    er = 0.93 * (1 + 0.02 * math.sin(f / 4e7)) * cmath.exp(-2j * math.pi * f * 0.8e-9)
    return ed, es, er


def gamma_of_z(z, z0=50.0):
    return (z - z0) / (z + z0)


def antenna(f):
    centres = [math.sqrt(a * b) for a, b in BANDS]
    i = min(range(len(BANDS)), key=lambda k: abs(math.log(f / centres[k])))
    a, b = BANDS[i]
    frac, r, q = RES[i]
    f0 = a + frac * (b - a)
    z = r + 1j * r * q * (f / f0 - f0 / f)
    return gamma_of_z(z)


def coax(f, length, z0=51.0, vf=0.66):
    """propagation constant of a lossy cable (about RG-58)"""
    alpha = 0.148 * math.sqrt(f / 1e8) / 8.686
    beta = 2 * math.pi * f / (C0 * vf)
    return alpha + 1j * beta, z0


def cable(f, end, length=25.0, fault=None):
    g, z0 = coax(f, length)
    # input impedance of the line, then the reflection against 50 ohm
    if end == "open":
        zin = z0 / cmath.tanh(g * length)
    else:
        zin = z0 * cmath.tanh(g * length)
    gam = gamma_of_z(zin)
    if fault:
        d, gf = fault
        # a partial reflection at distance d adds an echo; what passes on is reduced
        gam = gf * cmath.exp(-2 * g * d) + (1 - gf * gf) * gam
    return gam


def load_standard(f):
    return 0.012 * (f / 1e8) ** 0.5 * cmath.exp(1j * (0.7 + f / 3e8))


def reflection(dut, f):
    if dut == "antenna": return antenna(f)
    if dut == "open": return 1.0 + 0j
    if dut == "short": return -1.0 + 0j
    if dut == "load": return load_standard(f)
    if dut == "cable-open": return cable(f, "open")
    if dut == "cable-short": return cable(f, "short")
    if dut == "cable-fault": return cable(f, "open", fault=(12.0, -0.25))
    return 0j


class Vna:
    def __init__(self):
        self.dut = "antenna"
        self.start, self.stop, self.points = 50000, 900000000, 101
        self.slots = {}

    def freqs(self):
        n = self.points
        return [int(self.start + (self.stop - self.start) * i / (n - 1)) for i in range(n)]

    def data(self, ch):
        out = []
        for f in self.freqs():
            if ch == 0:
                ed, es, er = error_terms(f)
                g = reflection(self.dut, f)
                gm = ed + er * g / (1 - es * g)
            else:
                gm = 0.0002 * cmath.exp(1j * f / 5e6)  # nothing connected between the ports
            gm += complex(random.gauss(0, 6e-5), random.gauss(0, 6e-5))
            out.append(f"{gm.real:.6f} {gm.imag:.6f}")
        return out

    def capture(self):
        """a simple picture of the NanoVNA's screen: graticule and the log-magnitude trace"""
        w, h = 320, 240
        px = [0x0000] * (w * h)
        def put(x, y, c):
            if 0 <= x < w and 0 <= y < h: px[y * w + x] = c
        for i in range(0, 301, 30):
            for y in range(20, 220): put(10 + i, y, 0x3186)
        for j in range(0, 201, 25):
            for x in range(10, 311): put(x, 20 + j, 0x3186)
        prev = None
        for i, line in enumerate(self.data(0)):
            re, im = map(float, line.split())
            db = 20 * math.log10(max(math.hypot(re, im), 1e-4))
            x, y = 10 + int(i * 300 / max(self.points - 1, 1)), int(20 + (-db) * 5)
            if prev:
                for k in range(max(abs(y - prev[1]), 1) + 1):
                    put(x, min(max(prev[1] + (y - prev[1]) * k // max(abs(y - prev[1]), 1), 20), 219), 0x07E0)
            prev = (x, y)
        return b"".join(struct.pack(">H", p) for p in px)

    def handle(self, line):
        """returns the reply (bytes) to one shell command, without the echo and the prompt"""
        parts = line.split()
        if not parts: return b""
        cmd, args = parts[0], parts[1:]
        if cmd == "version": return b"1.2.0\r\n"
        if cmd == "info":
            return (b"Kernel: simulator\r\nBoard: NanoVNA-H (simulated)\r\nVersion: 1.2.0\r\nPlatform: simulated\r\n")
        if cmd == "frequencies": return ("\r\n".join(str(f) for f in self.freqs()) + "\r\n").encode()
        if cmd == "data": return ("\r\n".join(self.data(int(args[0]) if args else 0)) + "\r\n").encode()
        if cmd == "sweep" and len(args) == 2:
            what, v = args[0], int(float(args[1]))
            if what == "start": self.start = v
            elif what == "stop": self.stop = v
            elif what == "center": c = (self.start + self.stop) // 2; self.start += v - c; self.stop += v - c
            elif what == "span": c = (self.start + self.stop) // 2; self.start, self.stop = c - v // 2, c + v // 2
            if self.stop < self.start: self.stop = self.start
            return b""
        if cmd == "scan" and len(args) >= 3:
            self.start, self.stop, self.points = int(args[0]), int(args[1]), max(2, int(args[2]))
            if len(args) < 4: return b""
            mask = int(args[3])  # bit 0: frequency, bit 1: channel 0, bit 2: channel 1
            cols = ([[str(f) for f in self.freqs()]] if mask & 1 else []) + [self.data(c) for c in (0, 1) if mask & (2 << c)]
            return ("\r\n".join(" ".join(row) for row in zip(*cols)) + "\r\n").encode()
        if cmd == "save" and args: self.slots[args[0]] = (self.start, self.stop, self.points); return b""
        if cmd == "recall" and args:
            self.start, self.stop, self.points = self.slots.get(args[0], (50000, 900000000, 101))
            return b""
        if cmd == "capture": return self.capture()
        return b""  # resume, pause, cal, freq, port ... have no output


vna = Vna()


async def shell(request):
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)
    buf = ""
    async for msg in ws:
        if msg.type not in (WSMsgType.TEXT, WSMsgType.BINARY): continue
        text = msg.data if msg.type == WSMsgType.TEXT else msg.data.decode("latin-1")
        for ch in text:
            if ch == "\r":
                await ws.send_bytes(buf.encode() + b"\r\n" + vna.handle(buf) + b"ch> ")
                buf = ""
            else:
                buf += ch
    return ws


async def sim(request):
    name = request.match_info.get("name")
    if name: vna.dut = name
    return web.json_response({"dut": vna.dut})


async def appcal_get(request):
    if not APPCAL.exists(): return web.Response(status=404)
    return web.Response(body=APPCAL.read_bytes(), content_type="application/json")


async def appcal_put(request):
    APPCAL.write_bytes(await request.read())
    return web.json_response({"ok": True})


async def asset(request):
    f = ROOT / (request.match_info["path"] or "index.html")
    if not f.is_file() or ROOT not in f.resolve().parents: f = ROOT / "index.html"
    return web.FileResponse(f)


STATE_DIR.mkdir(exist_ok=True)
app = web.Application(client_max_size=1024 ** 3)
app.add_routes([web.get("/ws", shell), web.get("/sim", sim), web.get("/sim/dut/{name}", sim),
                web.get("/api/appcal", appcal_get), web.put("/api/appcal", appcal_put),
                web.get("/{path:.*}", asset)])
print(f"simulator on http://localhost:{PORT}/?host=localhost:{PORT}  (dut: antenna)", flush=True)
web.run_app(app, host="0.0.0.0", port=PORT, print=None)
