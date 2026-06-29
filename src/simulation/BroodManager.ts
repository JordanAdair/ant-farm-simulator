import { CONFIG } from './types';
import type { Brood, Position } from './types';
import { WorldGrid } from './Grid';

export class BroodManager {
  private _broodList: Brood[] = [];
  public nurseryCapacity: number = 15;

  /** Read-only snapshot of all brood items for callers that need to iterate. */
  public get broodList(): readonly Brood[] {
    return this._broodList;
  }

  constructor() {}

  // ---------------------------------------------------------------------------
  // Intent-named mutation methods — the ONLY way external code may mutate brood
  // ---------------------------------------------------------------------------

  /**
   * Replace the entire brood list — used when restoring saved state (e.g. offline progression).
   * All items are treated as authoritative and replace whatever was previously tracked.
   */
  public seedBrood(items: Brood[]): void {
    this._broodList = items.slice(); // defensive copy
  }

  /**
   * Add a single brood item directly — used by offline progression to lay eggs without
   * going through the full Queen-motion simulation.
   */
  public addBrood(item: Brood): void {
    this._broodList.push(item);
  }

  /**
   * Remove the last brood item from the list (e.g. mite attrition during offline time).
   * Returns the removed item, or undefined if the list was empty.
   */
  public removeLastBrood(): Brood | undefined {
    return this._broodList.pop();
  }

  /**
   * Remove and return the brood item at the given index — used by offline progression
   * when a pupa hatches and the item must be removed by index during an iteration loop.
   */
  public removeBroodAt(index: number): Brood | undefined {
    if (index < 0 || index >= this._broodList.length) return undefined;
    return this._broodList.splice(index, 1)[0];
  }

  /**
   * Mark a brood item as being carried by a nurse.
   * Returns true if the brood was found and not already carried.
   */
  public pickUpBrood(id: string): boolean {
    const brood = this._broodList.find(b => b.id === id);
    if (!brood || brood.beingCarried) return false;
    brood.beingCarried = true;
    return true;
  }

  /**
   * Place a carried brood item at the given position (drops it).
   * Returns true if the brood was found and was being carried.
   */
  public placeBrood(id: string, pos: Position): boolean {
    const brood = this._broodList.find(b => b.id === id);
    if (!brood) return false;
    brood.beingCarried = false;
    brood.x = pos.x;
    brood.y = pos.y;
    return true;
  }

  /**
   * Update the world position of a brood item being carried (called each frame
   * while the nurse is walking toward the target nursery).
   */
  public moveBroodWithCarrier(id: string, pos: Position): boolean {
    const brood = this._broodList.find(b => b.id === id);
    if (!brood) return false;
    brood.x = pos.x;
    brood.y = pos.y;
    return true;
  }

  /**
   * Feed a hungry larva: advances its progress and clears the needsFood flag.
   * Returns true if the larva was found and was hungry.
   */
  public feedLarva(id: string, progressBoost: number = 25): boolean {
    const brood = this._broodList.find(b => b.id === id);
    if (!brood || !brood.needsFood) return false;
    brood.progress = Math.min(100, brood.progress + progressBoost);
    brood.needsFood = false;
    return true;
  }

  /**
   * Return all brood items located in the given nursery (not being carried).
   */
  public getBroodInNursery(nursery: Position): readonly Brood[] {
    return this._broodList.filter(b => {
      if (b.beingCarried) return false;
      const dx = b.x - nursery.x;
      const dy = b.y - nursery.y;
      return Math.sqrt(dx * dx + dy * dy) < 40;
    });
  }

  /**
   * Return a single brood item by id, or null if not found.
   * Callers MUST NOT mutate the returned object — use the mutation methods above.
   */
  public getBroodById(id: string): Readonly<Brood> | null {
    return this._broodList.find(b => b.id === id) ?? null;
  }

  /**
   * Return a snapshot of all brood items that are hungry larvae (not being carried).
   */
  public getHungryLarvae(): readonly Brood[] {
    return this._broodList.filter(b => b.type === 'Larva' && b.needsFood && !b.beingCarried);
  }

  /**
   * Damage a brood item (e.g. from a predator attack). Returns true if the brood
   * was destroyed (progress dropped to zero or below), in which case it is removed
   * from the list.
   */
  public damageBrood(id: string, amount: number): boolean {
    const idx = this._broodList.findIndex(b => b.id === id);
    if (idx === -1) return false;
    const brood = this._broodList[idx];
    brood.progress = Math.max(0, brood.progress - amount);
    if (brood.progress <= 0) {
      this._broodList.splice(idx, 1);
      return true; // destroyed
    }
    return false;
  }

  /**
   * Return all brood items that are misplaced or in flooded nurseries — i.e. brood
   * that a nurse should pick up and relocate.
   */
  public getStrayBrood(grid: WorldGrid, nurseries: Position[]): readonly Brood[] {
    return this._broodList.filter(b => {
      if (b.beingCarried) return false;

      // 1. Is it in a water cell?
      const bCol = Math.floor(b.x / CONFIG.CELL_SIZE);
      const bRow = Math.floor(b.y / CONFIG.CELL_SIZE);
      const bCell = grid.getCell(bCol, bRow);
      if (bCell && bCell.type === 'Water') {
        return true;
      }

      // 2. Is it in a flooded nursery?
      for (const nursery of nurseries) {
        const dist = Math.sqrt((b.x - nursery.x) ** 2 + (b.y - nursery.y) ** 2);
        if (dist < 40 && isNurseryFlooded(grid, nursery)) {
          return true;
        }
      }

      // 3. Is it a misplaced egg or pupa (not in any dry nursery)?
      if (b.type === 'Egg' || b.type === 'Pupa') {
        let inDryNursery = false;
        for (const nursery of nurseries) {
          const dist = Math.sqrt((b.x - nursery.x) ** 2 + (b.y - nursery.y) ** 2);
          if (dist < 40 && !isNurseryFlooded(grid, nursery)) {
            inDryNursery = true;
            break;
          }
        }
        return !inDryNursery;
      }

      return false;
    });
  }

  /**
   * Compressed offline brood lifecycle update — runs simplified egg→larva→pupa→hatch
   * progression for a given time step without the full simulation loop.
   *
   * Returns the number of ants that hatched during this step.
   */
  public updateOffline(
    stepSizeSeconds: number,
    nurses: number,
    consumeFood: (amount: number) => boolean,
    onHatch: (x: number, y: number) => void
  ): number {
    let hatchCount = 0;
    for (let i = this._broodList.length - 1; i >= 0; i--) {
      const b = this._broodList[i];

      if (b.type === 'Egg') {
        b.progress += (100 / CONFIG.EGG_HATCH_TIME) * stepSizeSeconds;
        if (b.progress >= 100) {
          b.type = 'Larva';
          b.progress = 0;
          b.needsFood = true;
        }
      } else if (b.type === 'Larva') {
        if (b.needsFood && nurses > 0 && consumeFood(1)) {
          b.needsFood = false;
          b.progress += 25;
        }
        b.progress += (100 / CONFIG.LARVA_GROWTH_TIME) * stepSizeSeconds * (b.needsFood ? 0.2 : 1.0);
        if (b.progress >= 100) {
          b.type = 'Pupa';
          b.progress = 0;
        }
      } else if (b.type === 'Pupa') {
        b.progress += (100 / CONFIG.PUPA_HATCH_TIME) * stepSizeSeconds;
        if (b.progress >= 100) {
          hatchCount++;
          onHatch(b.x, b.y);
          this._broodList.splice(i, 1);
        }
      }
    }
    return hatchCount;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle (internal mutations — BroodManager is the sole owner)
  // ---------------------------------------------------------------------------

  public update(
    dt: number,
    hatchAnt: (x: number, y: number) => void,
    addLog: (msg: string, cat: 'system' | 'births' | 'deaths') => void
  ): void {
    for (let i = this._broodList.length - 1; i >= 0; i--) {
      const brood = this._broodList[i];

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
          this._broodList.splice(i, 1);
          continue;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Nursery query helpers (read-only)
  // ---------------------------------------------------------------------------

  public getNurseryOccupancy(nursery: Position): number {
    return this._broodList.filter(b => {
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
          for (const b of this._broodList) {
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
      this._broodList.push(newEgg);
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

    this._broodList.push(newEgg);
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
