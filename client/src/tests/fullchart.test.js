import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { useFullChart } from '../lib/fullchart';
import ChartFrame from '../components/ChartFrame.vue';

describe('useFullChart', () => {
    it('knows which chart is full and its size', () => {
        const fc = useFullChart();
        expect(fc.sizeOf('a', 300, 110)).toEqual([300, 110]);
        fc.onFrame('a', { full: true, w: 800, h: 400 });
        expect(fc.isFull('a')).toBe(true);
        expect(fc.sizeOf('a', 300, 110)).toEqual([800, 400]);
        expect(fc.sizeOf('b', 300, 110)).toEqual([300, 110]);
        fc.onFrame('b', { full: false, w: 0, h: 0 }); // another chart closing does not end it
        expect(fc.isFull('a')).toBe(true);
        fc.onFrame('a', { full: false, w: 0, h: 0 });
        expect(fc.current.value).toBeNull();
    });
});

describe('ChartFrame', () => {
    it('toggles with the button and with Escape, and reports it', async () => {
        const w = mount(ChartFrame, { props: { title: 'SWR 40 m' }, slots: { default: '<svg class="inner" />' }, attachTo: document.body });
        expect(w.classes()).not.toContain('full');
        await w.find('button').trigger('click');
        expect(w.classes()).toContain('full');
        expect(w.text()).toContain('SWR 40 m');
        expect(w.emitted('change').at(-1)[0].full).toBe(true);
        expect(w.find('svg.inner').exists()).toBe(true); // the chart stays in place
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await w.vm.$nextTick();
        expect(w.classes()).not.toContain('full');
        expect(w.emitted('change').at(-1)[0].full).toBe(false);
        w.unmount();
    });
});
