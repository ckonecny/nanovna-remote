import { describe, it, expect, afterEach } from 'vitest';
import { NanoVNA_WebSocket } from '../lib/nanovna';
import { DemoSocket } from '../lib/demo';

// the simulated NanoVNA answers bandwidth / smooth / power like the device: a reply line for a query and for bandwidth, nothing for the others
describe('sweep settings', () => {
    const original = globalThis.WebSocket;
    afterEach(() => { globalThis.WebSocket = original; });

    it('reads and changes bandwidth, smoothing and power, also after commands without a reply', async () => {
        DemoSocket.OPEN = 1;
        globalThis.WebSocket = DemoSocket;
        const vna = new NanoVNA_WebSocket({});
        await vna.open({ url: 'ws://demo' });
        expect(await vna.getSweepSettings()).toEqual({ bandwidth: 3, smooth: 0, power: 255 });
        await vna.setBandwidth(39);
        await vna.setSmooth(4);
        await vna.setPower(1);
        expect(await vna.getSweepSettings()).toEqual({ bandwidth: 39, smooth: 4, power: 1 });
    });
});
