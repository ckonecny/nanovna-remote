// Order of the movable sections of a view. The default is the order below; the user can drag sections to another place
// (the order is kept per view in the browser). Sections that are not in a saved order (added by an update) go to the end.
export const DEFAULT_ORDER = {
    ham: ['ham-bands', 'ham-tools', 'ham-swr', 'ham-tiles', 'ham-extras', 'ham-cal'],
    multi: ['multi-bands', 'multi-tools', 'multi-cards', 'multi-cal'],
};

export function normalizeOrder(group, saved) {
    const defaults = DEFAULT_ORDER[group] || [];
    if (!Array.isArray(saved)) return [...defaults];
    const known = saved.filter((id, i) => defaults.includes(id) && saved.indexOf(id) === i);
    return [...known, ...defaults.filter(id => !known.includes(id))];
}

// the order with `id` moved to position `index` (clamped)
export function moveTo(order, id, index) {
    const from = order.indexOf(id);
    if (from < 0) return [...order];
    const rest = order.filter(x => x !== id);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
    return rest;
}
