import { WorldGrid } from './Grid';
import type { Position } from './types';
import { CONFIG } from './types';

// Simple priority queue for A*
class PriorityQueue<T> {
  private items: { element: T; priority: number }[] = [];

  enqueue(element: T, priority: number) {
    let contain = false;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].priority > priority) {
        this.items.splice(i, 0, { element, priority });
        contain = true;
        break;
      }
    }
    if (!contain) {
      this.items.push({ element, priority });
    }
  }

  dequeue(): T | undefined {
    return this.items.shift()?.element;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

export function findPath(grid: WorldGrid, startCol: number, startRow: number, targetCol: number, targetRow: number): Position[] | null {
  // Check bounds
  if (!grid.isValid(startCol, startRow) || !grid.isValid(targetCol, targetRow)) {
    return null;
  }

  // If the target is solid, find the nearest walkable neighbor using BFS
  let finalTargetCol = targetCol;
  let finalTargetRow = targetRow;
  if (!grid.isWalkable(targetCol, targetRow)) {
    let best: Position | null = null;
    const queue = [{ col: targetCol, row: targetRow }];
    const visited = new Set<number>();
    visited.add(targetRow * grid.cols + targetCol);
    let searchIterations = 0;
    
    while (queue.length > 0 && searchIterations < 2000) {
      searchIterations++;
      const cur = queue.shift()!;
      if (grid.isWalkable(cur.col, cur.row)) {
        best = { x: cur.col, y: cur.row };
        break;
      }
      for (const n of getNeighbors(grid, cur.col, cur.row)) {
        const id = n.row * grid.cols + n.col;
        if (!visited.has(id)) {
          visited.add(id);
          queue.push(n);
        }
      }
    }
    
    if (!best) return null; // completely encased map-wide (shouldn't happen)
    finalTargetCol = best.x;
    finalTargetRow = best.y;
  }

  if (startCol === finalTargetCol && startRow === finalTargetRow) return [];

  const openSet = new PriorityQueue<number>();
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  
  const startId = startRow * grid.cols + startCol;
  const targetId = finalTargetRow * grid.cols + finalTargetCol;

  gScore.set(startId, 0);
  openSet.enqueue(startId, heuristic(startCol, startRow, finalTargetCol, finalTargetRow));

  // Cap iterations to avoid freezing
  let iterations = 0;
  const MAX_ITERATIONS = 50000; // max cells expanded

  while (!openSet.isEmpty()) {
    if (iterations++ > MAX_ITERATIONS) break; // fallback

    const currentId = openSet.dequeue()!;
    if (currentId === targetId) {
      return reconstructPath(cameFrom, currentId, grid.cols);
    }

    const curC = currentId % grid.cols;
    const curR = Math.floor(currentId / grid.cols);

    const currentG = gScore.get(currentId)!;
    
    const neighbors = getNeighbors(grid, curC, curR);
    for (const neighbor of neighbors) {
      if (!grid.isWalkable(neighbor.col, neighbor.row)) continue;

      const neighborId = neighbor.row * grid.cols + neighbor.col;
      const moveCost = (neighbor.col !== curC && neighbor.row !== curR) ? 14 : 10;
      const tentativeG = currentG + moveCost;

      const existingG = gScore.get(neighborId) ?? Infinity;
      if (tentativeG < existingG) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeG);
        const fScore = tentativeG + heuristic(neighbor.col, neighbor.row, finalTargetCol, finalTargetRow);
        openSet.enqueue(neighborId, fScore);
      }
    }
  }

  return null;
}

function heuristic(c1: number, r1: number, c2: number, r2: number): number {
  const dc = Math.abs(c1 - c2);
  const dr = Math.abs(r1 - r2);
  return 10 * (dc + dr) + (14 - 2 * 10) * Math.min(dc, dr);
}

function getNeighbors(grid: WorldGrid, col: number, row: number) {
  const neighbors: { col: number; row: number }[] = [];
  for (let r = -1; r <= 1; r++) {
    for (let c = -1; c <= 1; c++) {
      if (r === 0 && c === 0) continue;
      const nc = col + c;
      const nr = row + r;
      if (grid.isValid(nc, nr)) {
        neighbors.push({ col: nc, row: nr });
      }
    }
  }
  return neighbors;
}

function reconstructPath(cameFrom: Map<number, number>, currentId: number, cols: number): Position[] {
  const path: Position[] = [];
  let curr = currentId;
  const CELL_SIZE = CONFIG.CELL_SIZE;
  while (cameFrom.has(curr)) {
    const c = curr % cols;
    const r = Math.floor(curr / cols);
    path.push({ x: c * CELL_SIZE + CELL_SIZE / 2, y: r * CELL_SIZE + CELL_SIZE / 2 });
    curr = cameFrom.get(curr)!;
  }
  path.reverse(); // from start to target
  
  // Return the raw path to ensure ants stick perfectly to the center of walkable cells
  return path;
}
