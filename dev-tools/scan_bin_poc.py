#!/usr/bin/env python3
"""Proof of concept for #49: reads sweeps with the NanoVNA-H `scan_bin` command through the bridge and compares the time
with the command sequence the web app uses today. usage: scan_bin_poc.py [host]

scan_bin <start> <stop> <points> <mask> blocks until the sweep is done and answers with
  uint16 mask (0x80 | requested mask), uint16 points, then per point: uint32 frequency (if mask bit 0),
  float32 re, im of channel 0 (bit 1) and of channel 1 (bit 2)   (little endian)"""
import asyncio, struct, sys, time
import websockets

HOST = sys.argv[1] if len(sys.argv) > 1 else "nanovna.local"
BANDS = ["1800000 2000000", "3500000 3800000", "7000000 7200000", "14000000 14350000", "28000000 29700000"]


async def cmd(ws, c, timeout=15):
    await ws.send(c + "\r")
    buf, t0 = b"", time.time()
    while time.time() - t0 < timeout and not buf.endswith(b"ch> "):
        try:
            buf += await asyncio.wait_for(ws.recv(), 0.6)
        except asyncio.TimeoutError:
            pass
    return buf


def parse(buf):
    """-> list of (freq or None, [re, im, ...]) from a scan_bin reply"""
    i = buf.index(b"\r\n") + 2
    mask, n = struct.unpack_from("<HH", buf, i)
    i += 4
    channels = bin(mask & 6).count("1")
    size = (4 if mask & 1 else 0) + 8 * channels
    rows = []
    for k in range(n):
        o = i + k * size
        freq = struct.unpack_from("<I", buf, o)[0] if mask & 1 else None
        rows.append((freq, struct.unpack_from(f"<{2 * channels}f", buf, o + (4 if mask & 1 else 0))))
    return rows


async def main():
    async with websockets.connect(f"ws://{HOST}/ws", max_size=None, ping_interval=None) as ws:
        for _ in range(6):
            if (await cmd(ws, "")).endswith(b"ch> "):
                break
        rng = "1000000 30000000 101"
        rows = parse(await cmd(ws, f"scan_bin {rng} 7"))
        text = [l.split() for l in (await cmd(ws, f"scan {rng} 7")).decode().split("\r\n") if l[:1].isdigit()]
        print(f"scan_bin: {len(rows)} points, text scan: {len(text)} points, first {rows[0][0]} Hz / {text[0][0]} Hz, "
              f"last {rows[-1][0]} Hz / {text[-1][0]} Hz")

        t0 = time.time()
        for b in BANDS:  # what the Multi view does today: set range, resume, wait for the sweep, read
            await cmd(ws, f"scan {b} 101"); await cmd(ws, "resume"); await asyncio.sleep(0.9)
            await cmd(ws, "frequencies"); await cmd(ws, "data 0")
        old = time.time() - t0
        t0 = time.time()
        for b in BANDS:
            parse(await cmd(ws, f"scan_bin {b} 101 3"))
        print(f"5 HAM bands: today {old:.1f} s, scan_bin {time.time() - t0:.1f} s")

        for name, c in (("scan + 0.4 s + frequencies + data 0 + data 1", None), ("scan, mask 7 (text)", f"scan {rng} 7"),
                        ("scan_bin, mask 7", f"scan_bin {rng} 7")):
            t0 = time.time()
            for _ in range(5):
                if c:
                    await cmd(ws, c)
                else:
                    await cmd(ws, f"scan {rng}"); await asyncio.sleep(0.4)
                    for x in ("frequencies", "data 0", "data 1"):
                        await cmd(ws, x)
            print(f"{name}: {(time.time() - t0) / 5:.2f} s per full sweep")


asyncio.run(main())
