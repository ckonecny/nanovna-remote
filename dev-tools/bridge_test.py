#!/usr/bin/env python3
"""Proof of concept for the ESP32 WebSocket bridge: talks to the NanoVNA text shell through ws://<host>/ws.
usage: bridge_test.py [host] [seconds]"""
import asyncio, sys, time
import websockets

HOST = sys.argv[1] if len(sys.argv) > 1 else "nanovna.local"
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 20


async def command(ws, cmd, expect_bytes=None, timeout=20):
    """sends a command, collects the reply until the shell prompt (or expect_bytes bytes)"""
    await ws.send(cmd + "\r")
    buf = b""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            buf += await asyncio.wait_for(ws.recv(), 1)
        except asyncio.TimeoutError:
            continue
        if expect_bytes is not None:
            if len(buf) >= expect_bytes + len(cmd) + 2:
                break
        elif buf.endswith(b"ch> "):
            break
    return buf, time.time() - t0


async def main():
    async with websockets.connect(f"ws://{HOST}/ws", max_size=None, ping_interval=None) as ws:
        # like the real client: send Return until the shell answers with its prompt
        t0 = time.time()
        for attempt in range(1, 8):
            buf, _ = await command(ws, "", timeout=2)
            if buf.endswith(b"ch> "):
                break
        print(f"prompt after {attempt} attempt(s), {time.time()-t0:.1f}s" if buf.endswith(b"ch> ") else f"NO PROMPT: {buf[:80]!r}")
        buf, dt = await command(ws, "version")
        print("version:", buf.decode(errors="replace").split("\n")[1].strip(), f"({dt:.2f}s)")
        buf, dt = await command(ws, "info")
        print("info:", " | ".join(l.strip() for l in buf.decode(errors="replace").split("\n")[1:4]), f"({dt:.2f}s)")
        buf, dt = await command(ws, "scan 100000000 150000000 101 3")
        lines = [l for l in buf.decode(errors="replace").split("\n")[1:] if l.strip() and not l.startswith("ch>")]
        print(f"scan: {len(lines)} lines in {dt:.2f}s, first: {lines[0].strip() if lines else None}")
        buf, dt = await command(ws, "capture", expect_bytes=320 * 240 * 2)
        print(f"capture: {len(buf)} bytes in {dt:.2f}s ({len(buf)/max(dt,1e-6)/1024:.0f} KB/s)")
        await asyncio.sleep(1)
        while True:  # swallow what is left of the screenshot (trailing prompt)
            try:
                await asyncio.wait_for(ws.recv(), 0.5)
            except asyncio.TimeoutError:
                break
        # endurance: repeated sweeps
        t_end = time.time() + DURATION
        n = bad = 0
        while time.time() < t_end:
            buf, dt = await command(ws, "scan 3000000 30000000 101 3")
            rows = [l for l in buf.decode(errors="replace").split("\n")[1:] if len(l.split()) == 3]
            n += 1
            if len(rows) != 101:
                bad += 1
                print(f"  sweep {n}: {len(rows)} rows (bad)")
        print(f"endurance: {n} sweeps, {bad} bad, avg {DURATION/max(n,1):.2f}s each")


asyncio.run(main())
