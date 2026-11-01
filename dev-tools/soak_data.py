"""Soak test over the bridge: set the sweep once, then only read `data 0` (no repeated `scan`).
Usage: soak_data.py <host> <seconds> [scan]   (with `scan`: control run with the repeated scan like the worker)"""
import asyncio, sys, time, websockets

async def cmd(ws, text, timeout=5):
    await ws.send((text + "\r").encode())
    buf = b""
    end = time.time() + timeout
    while not buf.endswith(b"ch> "):
        left = end - time.time()
        if left <= 0:
            raise TimeoutError(f"no answer to {text!r}, got {len(buf)} bytes")
        buf += await asyncio.wait_for(ws.recv(), left)
    return buf.decode(errors="replace")

async def main():
    host, seconds = sys.argv[1], float(sys.argv[2])
    control = len(sys.argv) > 3 and sys.argv[3] == "scan"
    async with websockets.connect(f"ws://{host}/ws", ping_interval=None, max_size=None) as ws:
        for _ in range(6):
            try:
                await cmd(ws, "", 1.5)
                break
            except TimeoutError:
                pass
        if not control:
            await cmd(ws, "sweep 140000000 150000000 101")
        n = bad = 0
        t0 = time.time()
        last = None
        while time.time() - t0 < seconds:
            try:
                text = await cmd(ws, "scan 140000000 150000000 101 3" if control else "data 0")
            except TimeoutError as e:
                print(f"WEDGED after {n} commands, {time.time()-t0:.0f} s: {e}", flush=True)
                return
            rows = [l for l in text.splitlines() if l.strip() and not l.startswith("ch>") and not l.startswith(("scan", "data"))]
            if len(rows) != 101:
                bad += 1
            last = rows
            n += 1
            if n % 500 == 0:
                print(f"{n} commands ok, {time.time()-t0:.0f} s, {bad} bad", flush=True)
            await asyncio.sleep(0.05)
        print(f"DONE: {n} commands, {time.time()-t0:.0f} s, {bad} bad, no hang", flush=True)
        print("sample:", last[0] if last else None)

asyncio.run(main())
