import { ref } from 'vue';

// Which chart of a view fills the screen, and the size of its box. Charts that draw at a pixel size (the SVG ones) take their
// size from here while one of them is full; id names the chart inside the view.
export function useFullChart() {
    const current = ref(null); // { id, w, h } or null
    const onFrame = (id, s) => {
        if (s.full) current.value = { id, w: s.w, h: s.h };
        else if (current.value && current.value.id === id) current.value = null;
    };
    const isFull = (id) => !!current.value && current.value.id === id;
    // [w, h] of the chart with this id: the full-screen box while it is full, else the given size
    const sizeOf = (id, w, h) => (isFull(id) ? [current.value.w, current.value.h] : [w, h]);
    return { current, onFrame, isFull, sizeOf };
}
