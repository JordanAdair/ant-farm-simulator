import { CONFIG } from './types';
import type { LarderBox } from './types';
import type { WorldGrid } from './Grid';

export interface IFoodStockpile {
  readonly total: number;
  consume(amount: number): boolean;
  deposit(amount: number): void;
}

/**
 * FoodStockpile is the single source of truth for colony food.
 * All reads and writes go directly through larder grid cells —
 * there is no separate in-memory counter.
 *
 * If `setTotal()` is called before the grid is connected, the requested amount
 * is stored as a pending deposit and applied the first time the grid becomes
 * available (checked on every call to `total`, `consume`, and `deposit`).
 */
export class FoodStockpile implements IFoodStockpile {
  /** Amount to deposit the first time the grid becomes available. */
  private _pendingDeposit: number = 200; // start with 200 until overridden
  private _gridWasConnected: boolean = false;
  private readonly getGrid: () => WorldGrid | undefined;
  private readonly getLarderBoxes: () => LarderBox[];

  constructor(
    getGrid: () => WorldGrid | undefined,
    getLarderBoxes: () => LarderBox[]
  ) {
    this.getGrid = getGrid;
    this.getLarderBoxes = getLarderBoxes;
  }

  /** Apply any pending deposit once the grid is first available. */
  private applyPendingDeposit(): void {
    const grid = this.getGrid();
    if (!grid || this._gridWasConnected) return;
    this._gridWasConnected = true;
    if (this._pendingDeposit <= 0) return;
    const amount = this._pendingDeposit;
    this._pendingDeposit = 0;
    this._depositIntoGrid(grid, amount);
  }

  /** Internal deposit that writes directly into the grid without recursion guard. */
  private _depositIntoGrid(grid: WorldGrid, amount: number): void {
    let remaining = amount;
    for (const box of this.getLarderBoxes()) {
      if (remaining <= 0) break;
      for (let c = box.minCol; c <= box.maxCol && remaining > 0; c++) {
        for (let r = box.minRow; r <= box.maxRow && remaining > 0; r++) {
          const cell = grid.getCell(c, r);
          if (!cell) continue;
          if (cell.type === 'Food' && cell.foodAmount < CONFIG.FOOD_PIECE_SIZE) {
            const cap = CONFIG.FOOD_PIECE_SIZE - cell.foodAmount;
            const add = Math.min(remaining, cap);
            cell.foodAmount += add;
            remaining -= add;
          } else if (cell.type === 'NestAir') {
            cell.type = 'Food';
            cell.foodType = 'Apple';
            const amt = Math.min(remaining, CONFIG.FOOD_PIECE_SIZE);
            cell.foodAmount = amt;
            remaining -= amt;
          }
        }
      }
    }
  }

  /**
   * Set the total food to a specific value.
   * If the grid is available, adjusts cells directly.
   * If not yet connected, stores the value as a pending deposit for when it connects.
   */
  setTotal(amount: number): void {
    const grid = this.getGrid();
    if (!grid) {
      // Grid not yet connected — store as pending deposit
      this._pendingDeposit = amount;
      this._gridWasConnected = false; // allow reapplication when grid reconnects
      return;
    }
    // Grid is available: drain existing food and re-deposit the target amount
    const current = this.total;
    const diff = amount - current;
    if (diff > 0) {
      this.deposit(diff);
    } else if (diff < 0) {
      this.consume(-diff);
    }
  }

  /** Sum of foodAmount across all larder cells. */
  get total(): number {
    this.applyPendingDeposit();
    const grid = this.getGrid();
    if (!grid) return 0;
    let total = 0;
    for (const box of this.getLarderBoxes()) {
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            total += cell.foodAmount;
          }
        }
      }
    }
    return total;
  }

  /**
   * Atomically deduct `amount` from larder cells.
   * Returns true if the full amount was available and deducted, false otherwise.
   * Partial deductions are NOT applied — the operation is all-or-nothing.
   */
  consume(amount: number): boolean {
    this.applyPendingDeposit();
    const grid = this.getGrid();
    if (!grid) return false;
    if (amount <= 0) return true;

    // Check if we have enough first
    if (this.total < amount) return false;

    // Perform the deduction
    let remaining = amount;
    const boxes = this.getLarderBoxes();
    for (let b = boxes.length - 1; b >= 0 && remaining > 0; b--) {
      const box = boxes[b];
      for (let c = box.maxCol; c >= box.minCol && remaining > 0; c--) {
        for (let r = box.maxRow; r >= box.minRow && remaining > 0; r--) {
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            const take = Math.min(cell.foodAmount, remaining);
            cell.foodAmount -= take;
            remaining -= take;
            if (cell.foodAmount <= 0) {
              cell.type = 'NestAir';
              cell.foodAmount = 0;
              cell.foodType = undefined;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Add `amount` of food into larder cells.
   * Fills partially-occupied cells first, then converts NestAir cells to Food.
   * Any food that cannot fit (larder full) is silently dropped.
   */
  deposit(amount: number): void {
    this.applyPendingDeposit();
    const grid = this.getGrid();
    if (!grid || amount <= 0) return;
    this._depositIntoGrid(grid, amount);
  }
}
