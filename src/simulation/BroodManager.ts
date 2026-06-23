import { CONFIG } from './types';
import type { Brood, Position } from './types';
import { WorldGrid } from './Grid';

export class BroodManager {
  public broodList: Brood[] = [];
  public nurseryCapacity: number = 15;

  constructor() {}

  public update(
    dt: number,
    hatchAnt: (x: number, y: number) => void,
    addLog: (msg: string, cat: 'system' | 'births' | 'deaths') => void
  ): void {
    for (let i = this.broodList.length - 1; i >= 0; i--) {
      const brood = this.broodList[i];
      
      if (brood.type === 'Egg') {
        brood.progress += (100 / CONFIG.EGG_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          brood.type = 'Larva';
          brood.progress = 0;
          brood.needsFood = true;
          addLog('An egg hatched into a hungry larva.', 'births');
        }
      } else if (brood.type === 'Larva') {
        if (!brood.needsFood) {
          brood.progress += (100 / CONFIG.LARVA_GROWTH_TIME / 60) * dt;
          if (brood.progress >= 100) {
            brood.type = 'Pupa';
            brood.progress = 0;
            addLog('A larva spun a silk cocoon and entered pupation.', 'births');
          }
          if (Math.random() < 0.002 * dt) {
            brood.needsFood = true;
          }
        }
      } else if (brood.type === 'Pupa') {
        brood.progress += (100 / CONFIG.PUPA_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          hatchAnt(brood.x, brood.y);
          this.broodList.splice(i, 1);
          continue;
        }
      }
    }
  }

  public getNurseryOccupancy(nursery: Position): number {
    return this.broodList.filter(b => {
      if (b.beingCarried) return false;
      const dx = b.x - nursery.x;
      const dy = b.y - nursery.y;
      return Math.sqrt(dx * dx + dy * dy) < 40; // nursery chamber radius is 40px
    }).length;
  }

  public isNurseryFull(nursery: Position): boolean {
    return this.getNurseryOccupancy(nursery) >= this.nurseryCapacity;
  }

  public isNurseryCrowded(nursery: Position): boolean {
    return this.getNurseryOccupancy(nursery) >= Math.floor(this.nurseryCapacity * 0.8);
  }

  public getAvailableNursery(nurseries: Position[]): Position | null {
    const valid = nurseries.filter(n => !this.isNurseryFull(n));
    if (valid.length === 0) return null;
    return valid.sort((a, b) => this.getNurseryOccupancy(a) - this.getNurseryOccupancy(b))[0];
  }

  public findSpacedPositionInNursery(grid: WorldGrid, nursery: Position): Position | null {
    const stepSize = CONFIG.CELL_SIZE;
    const maxRadius = 30; // Search up to 30px out
    const candidates: Position[] = [];

    for (let r = 0; r <= maxRadius; r += stepSize) {
      const numSteps = r === 0 ? 1 : Math.ceil(2 * Math.PI * r / stepSize);
      for (let i = 0; i < numSteps; i++) {
        const angle = (i / numSteps) * 2 * Math.PI;
        const dx = Math.round(Math.cos(angle) * r);
        const dy = Math.round(Math.sin(angle) * r);
        const tx = nursery.x + dx;
        const ty = nursery.y + dy;

        const col = Math.floor(tx / stepSize);
        const row = Math.floor(ty / stepSize);

        if (grid.isValid(col, row) && grid.isWalkable(col, row)) {
          let tooClose = false;
          for (const b of this.broodList) {
            if (b.beingCarried) continue;
            const distSq = (b.x - tx) ** 2 + (b.y - ty) ** 2;
            if (distSq < 8 * 8) { // 8 pixels threshold
              tooClose = true;
              break;
            }
          }
          if (!tooClose) {
            candidates.push({ x: tx, y: ty });
          }
        }
      }
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    return null;
  }

  public layEgg(
    grid: WorldGrid,
    queenPos: Position,
    nurseries: Position[],
    addLog: (msg: string, cat: 'births') => void
  ): void {
    if (nurseries.length === 0) {
      const rx = queenPos.x + (Math.random() - 0.5) * 30;
      const ry = queenPos.y + 10;
      const targetPos = { x: rx, y: ry };
      const id = `brood-${Math.random().toString(36).substr(2, 9)}`;
      const newEgg: Brood = {
        id,
        type: 'Egg',
        x: targetPos.x,
        y: targetPos.y,
        progress: 0,
        needsFood: false,
        beingCarried: false,
      };
      this.broodList.push(newEgg);
      addLog('The Queen laid a new egg.', 'births');
      return;
    }

    let closestNursery = nurseries[0];
    let minDist = Infinity;
    for (const nursery of nurseries) {
      const dist = Math.sqrt((queenPos.x - nursery.x) ** 2 + (queenPos.y - nursery.y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestNursery = nursery;
      }
    }

    let targetPos = this.findSpacedPositionInNursery(grid, closestNursery);
    if (!targetPos) {
      const altNursery = this.getAvailableNursery(nurseries);
      if (altNursery) {
        targetPos = this.findSpacedPositionInNursery(grid, altNursery);
      }
    }

    if (!targetPos) {
      const rx = queenPos.x + (Math.random() - 0.5) * 30;
      const ry = queenPos.y + 10;
      targetPos = { x: rx, y: ry };
    }

    const id = `brood-${Math.random().toString(36).substr(2, 9)}`;
    const newEgg: Brood = {
      id,
      type: 'Egg',
      x: targetPos.x,
      y: targetPos.y,
      progress: 0,
      needsFood: false,
      beingCarried: false,
    };

    this.broodList.push(newEgg);
    addLog('The Queen laid a new egg.', 'births');
  }

  public getAvailableDryNursery(grid: WorldGrid, nurseries: Position[]): Position | null {
    const dryNurseries = nurseries.filter(n => !isNurseryFlooded(grid, n));
    if (dryNurseries.length === 0) return null;
    const valid = dryNurseries.filter(n => !this.isNurseryFull(n));
    if (valid.length === 0) {
      return dryNurseries.sort((a, b) => this.getNurseryOccupancy(a) - this.getNurseryOccupancy(b))[0];
    }
    return valid.sort((a, b) => this.getNurseryOccupancy(a) - this.getNurseryOccupancy(b))[0];
  }
}

export function isNurseryFlooded(grid: WorldGrid, nursery: Position): boolean {
  const stepSize = CONFIG.CELL_SIZE;
  const col = Math.floor(nursery.x / stepSize);
  const row = Math.floor(nursery.y / stepSize);

  for (let c = col - 10; c <= col + 10; c++) {
    for (let r = row - 10; r <= row + 10; r++) {
      if (grid.isValid(c, r)) {
        const cell = grid.getCell(c, r);
        if (cell && cell.type === 'Water') {
          return true;
        }
      }
    }
  }
  return false;
}

