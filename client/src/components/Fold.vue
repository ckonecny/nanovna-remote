<script setup>
import { computed, ref } from 'vue';
import { store } from '../store';
import { normalizeOrder, moveTo } from '../lib/order';

// A section that can be folded to one line and moved to another place of its view (`group`: 'ham' or 'multi').
// `summary` is shown while it is closed; `open` forces it open (a running guided calibration must not hide behind a
// closed header). Open state and order are kept in the browser. The parent must be a flex column: the position is
// the CSS `order`, so moving a section does not touch the DOM.
const props = defineProps({
    id: { type: String, required: true },
    group: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    startOpen: { type: Boolean, default: true },
    open: { type: Boolean, default: false },
    tone: { type: String, default: '' }, // 'ok' marks the header green
});

const isOpen = computed(() => props.open || (store.folds[props.id] ?? props.startOpen));
const toggle = () => { store.folds[props.id] = !isOpen.value; };

const current = () => normalizeOrder(props.group, store.order[props.group]);
const position = computed(() => current().indexOf(props.id) + 1); // 0 stays free for what is not movable (the warning banner)
const place = (index) => { store.order[props.group] = moveTo(current(), props.id, index); };

const root = ref(null);
const dragging = ref(false);

// Dragging by the handle: the section changes places with a neighbour as soon as the pointer passes the middle of it.
const scroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    return document.scrollingElement;
};
const neighbours = () => [...root.value.parentElement.children].filter(e => e.classList.contains('fold') && e.dataset.group === props.group);
const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.value = true;
};
const onMove = (e) => {
    if (!dragging.value) return;
    const sorted = neighbours().sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const i = sorted.indexOf(root.value);
    const prev = sorted[i - 1], next = sorted[i + 1];
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    if (prev && e.clientY < mid(prev)) place(i - 1);
    else if (next && e.clientY > mid(next)) place(i + 1);
    const edge = 60, sc = scroller(root.value);
    if (e.clientY < edge) sc.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - edge) sc.scrollBy(0, 12);
};
const onUp = () => { dragging.value = false; };
const onKey = (e) => {
    const i = current().indexOf(props.id);
    if (e.key === 'ArrowUp') { place(i - 1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { place(i + 1); e.preventDefault(); }
};
</script>

<template>
  <section ref="root" class="fold" :class="{ dragging }" :data-group="group" :style="{ order: position }">
    <div class="fold-head" :class="tone">
      <button class="handle" type="button" title="Drag to move this section" aria-label="Move section (arrow keys)" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @keydown="onKey"><span class="icon">drag_indicator</span></button>
      <button class="fold-toggle" type="button" :aria-expanded="isOpen" @click="toggle">
        <span class="fold-title">{{ title }}</span>
        <span v-if="!isOpen && summary" class="fold-sum">{{ summary }}</span>
        <span class="chev" :class="{ open: isOpen }" aria-hidden="true"></span>
      </button>
    </div>
    <div v-show="isOpen" class="fold-body"><slot /></div>
  </section>
</template>

<style scoped>
.fold { display: flex; flex-direction: column; gap: 8px; }
.fold.dragging { opacity: 0.85; outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 8px; }
.fold-head { display: flex; align-items: center; min-height: var(--tap); border-radius: 8px; background: var(--tile-bg); }
.fold-head.ok { background: rgba(76, 175, 80, 0.15); box-shadow: inset 4px 0 0 #4caf50; }
.handle { display: flex; align-items: center; justify-content: center; align-self: stretch; width: 32px; padding: 0; border: 0; background: none; color: var(--text-dim); opacity: 0.55; cursor: grab; touch-action: none; }
.handle:hover, .handle:focus-visible, .dragging .handle { opacity: 1; }
.handle .icon { font-size: 20px; }
.fold-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; align-self: stretch; padding: 0 14px 0 0; border: 0; background: none; color: var(--text-main); font: inherit; text-align: left; cursor: pointer; }
.fold-title { font-size: 14px; font-weight: 500; white-space: nowrap; }
.fold-sum { flex: 1; min-width: 0; font-size: 13px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fold-title + .chev { margin-left: auto; }
.fold-sum + .chev { margin-left: 0; }
/* a thin chevron, drawn in CSS: pointing down when open, to the left when closed */
.chev { flex: none; width: 7px; height: 7px; border-right: 1.5px solid var(--text-dim); border-bottom: 1.5px solid var(--text-dim); opacity: 0.7; transform: rotate(45deg) translate(-2px, -2px); transition: transform 0.15s; }
.chev.open { transform: rotate(225deg) translate(-2px, -2px); }
.fold-body { display: flex; flex-direction: column; gap: 10px; }
</style>
