// The call video panel: the grid of participant tiles (camera and screen
// share), their layouts, the draggable self-view, and the per-tile controls.
// Three parts — `layout`, `popout`, `tiles` — composed here, with an explicit
// list of what it needs from the rest of the screen (`VideoPanelContext`).

import type { VideoPanelContext } from "./context";
import { createLayout } from "./layout";
import { createTiles } from "./tiles";

export type { VideoPanelContext } from "./context";

export function createVideoPanel(ctx: VideoPanelContext) {
  const layout = createLayout(ctx);
  const tiles = createTiles(ctx, layout);
  return {
    layoutVideoTiles: layout.layoutVideoTiles,
    syncVideoIcons: layout.syncVideoIcons,
    renderVideoTile: tiles.renderVideoTile,
    updateVideoTile: tiles.updateVideoTile,
    screenAudioActive: tiles.screenAudioActive,
    videoTileStreams: tiles.videoTileStreams,
  };
}
