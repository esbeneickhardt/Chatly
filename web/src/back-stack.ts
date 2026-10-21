// Layers (Settings, one of its pages, a sheet) that the phone's own back
// button or back gesture closes, top one first, the way native apps
// behave. Each open layer is one browser history entry tagged with its
// id; landing on an older entry closes every layer above it.
//
// Stepping back is asynchronous: a layer opened while a step back is
// still on its way (a sheet that closes and opens a dialog in the same
// tap) waits for it to land before adding its own entry, or the step
// back would land on, and close, the new layer instead.

let nextId = 1;
const layers: { id: number; onBack: () => void }[] = [];
/** Layers whose history entry hasn't been added yet (see above). */
const unpushed = new Set<number>();
let pendingSteps = 0;

window.addEventListener("popstate", (e) => {
  const landed = (e.state as { backLayer?: number } | null)?.backLayer ?? 0;
  if (pendingSteps > 0) pendingSteps -= 1;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.id <= landed) break;
    if (unpushed.has(layer.id)) continue;
    layers.splice(i, 1);
    layer.onBack();
  }
  if (pendingSteps === 0) {
    for (const layer of layers) {
      if (unpushed.delete(layer.id)) history.pushState({ backLayer: layer.id }, "");
    }
  }
});

/** Opens a layer; `onBack` runs when back closes it. Call the returned
 * function when the layer closes some other way (a button, a swipe): it
 * drops this layer *and every layer above it* (the caller is closing
 * those too) and steps history back over all their entries at once. */
export function pushBackLayer(onBack: () => void): () => void {
  const id = nextId++;
  layers.push({ id, onBack });
  if (pendingSteps > 0) unpushed.add(id);
  else history.pushState({ backLayer: id }, "");
  return () => {
    const index = layers.findIndex((l) => l.id === id);
    if (index === -1) return;
    const removed = layers.splice(index);
    const pushed = removed.filter((l) => !unpushed.delete(l.id));
    if (pushed.length === 0) return;
    const top = pushed[pushed.length - 1].id;
    if ((history.state as { backLayer?: number } | null)?.backLayer !== top) return;
    pendingSteps += 1;
    history.go(-pushed.length);
  };
}
