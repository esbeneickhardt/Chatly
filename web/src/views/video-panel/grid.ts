// Which grid to lay video tiles out on. A square-ish grid is wrong whenever
// the space is not square: two webcams in a tall pane got two tall, narrow
// cells with a small picture floating in each. Instead, try every shape and
// keep the one that gives the pictures the most room.

export interface GridShape {
  cols: number;
  rows: number;
}

/** Picture shape assumed for every tile (webcams and most screens). */
const VIDEO_ASPECT = 16 / 9;

/** The area a 16:9 picture takes up inside a `width` x `height` cell. */
function pictureArea(width: number, height: number): number {
  const pictureWidth = Math.min(width, height * VIDEO_ASPECT);
  return pictureWidth * (pictureWidth / VIDEO_ASPECT);
}

/** The shape for `count` tiles in a `width` x `height` pane with `gap`
 * between cells: the one whose pictures are biggest, preferring fewer empty
 * cells when it is a tie. */
export function chooseGrid(count: number, width: number, height: number, gap = 8): GridShape {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (width <= 0 || height <= 0) {
    const cols = Math.ceil(Math.sqrt(count));
    return { cols, rows: Math.ceil(count / cols) };
  }
  let best: GridShape = { cols: 1, rows: count };
  let bestArea = -1;
  let bestEmpty = Number.POSITIVE_INFINITY;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellWidth = (width - gap * (cols - 1)) / cols;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const area = pictureArea(cellWidth, cellHeight);
    const empty = cols * rows - count;
    if (area > bestArea + 1 || (Math.abs(area - bestArea) <= 1 && empty < bestEmpty)) {
      best = { cols, rows };
      bestArea = area;
      bestEmpty = empty;
    }
  }
  return best;
}
