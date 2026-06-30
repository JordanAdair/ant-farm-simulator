import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { CellType, Position, FoodType } from './types';

export interface Cell {
  type: CellType;
  foodAmount: number;
  noiseVal: number; // for visual grit texturing
  durability?: number; // rock durability (5 hits to clear)
  foodType?: FoodType;
  isMoldy?: boolean;
}

export class WorldGrid {
  public cols: number;
  public rows: number;
  /** Externally read-only view of the grid cells. Mutate via Grid methods or resetCell(). */
  readonly cells: ReadonlyArray<ReadonlyArray<Cell>>;
  /** Internal mutable backing array — never expose directly. */
  private _cells: Cell[][];
  public nestEntranceCol: number;

  constructor() {
    this.cols = CONFIG.COLS;
    this.rows = CONFIG.ROWS;
    this.nestEntranceCol = Math.floor(this.cols / 2);
    this._cells = [];
    this.cells = this._cells;
    this.initializeGrid();
  }

  /** Replace a cell wholesale (e.g. during deserialization). Use field mutations via Grid methods for normal gameplay. */
  public resetCell(col: number, row: number, cell: Cell): void {
    this._cells[col][row] = cell;
  }

  private initializeGrid() {
    for (let c = 0; c < this.cols; c++) {
      this._cells[c] = [];
      for (let r = 0; r < this.rows; r++) {
        let type: CellType = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'Dirt';
        this._cells[c][r] = {
          type,
          foodAmount: 0,
          noiseVal: Math.random(),
        };
      }
    }

    // Generate randomly scattered, less abundant rock-like clusters
    // We spawn 45 irregular clusters below the sky height + 15 row limit
    const numClusters = 45;
    for (let i = 0; i < numClusters; i++) {
      // Pick a random center cell away from the grid edges
      const centerCol = Math.floor(15 + Math.random() * (this.cols - 30));
      const centerRow = Math.floor((CONFIG.SKY_HEIGHT + 18) + Math.random() * (this.rows - (CONFIG.SKY_HEIGHT + 28)));
      
      // Random ellipsoid radii (in cells)
      const radiusX = 2.0 + Math.random() * 4.0;
      const radiusY = 1.5 + Math.random() * 3.0;
      
      const searchRadiusX = Math.ceil(radiusX + 1);
      const searchRadiusY = Math.ceil(radiusY + 1);
      for (let dc = -searchRadiusX; dc <= searchRadiusX; dc++) {
        for (let dr = -searchRadiusY; dr <= searchRadiusY; dr++) {
          const tc = centerCol + dc;
          const tr = centerRow + dr;
          if (this.isValid(tc, tr) && tr >= CONFIG.SKY_HEIGHT + 12) {
            const dx = dc;
            const dy = dr;
            // Ellipse distance formula + small organic boundary noise
            const dist = (dx / radiusX) ** 2 + (dy / radiusY) ** 2;
            const noise = (Math.random() - 0.5) * 0.15;
            
            if (dist + noise <= 1.0) {
              this.cells[tc][tr].type = 'Rock';
              this.cells[tc][tr].durability = 5;
            }
          }
        }
      }
    }

    // Build the initial nest starting chamber for the Queen
    this.buildInitialNest();
  }

  private buildInitialNest() {
    const entranceCol = this.nestEntranceCol;
    const skyHeight = CONFIG.SKY_HEIGHT;

    const centerRow = STARTING_CHAMBER_CENTER_ROW;

    // Generate random chamber dimensions around the original size (approx 33 cols by 8 rows = 264 cells)
    const width = 28 + Math.floor(Math.random() * 9); // 28 to 36 columns
    const height = 7 + Math.floor(Math.random() * 3); // 7 to 9 rows
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);

    const minCol = entranceCol - halfWidth;
    const maxCol = entranceCol + (width - halfWidth - 1);
    const minRow = centerRow - halfHeight;
    const maxRow = minRow + height - 1;

    // 1. Vertical main shaft (straight and clean) from surface down to the chamber
    for (let r = skyHeight; r < minRow; r++) {
      for (let c = entranceCol - 2; c <= entranceCol + 1; c++) {
        if (this.isValid(c, r)) {
          this.clearCell(c, r);
        }
      }
    }

    // 2. Central Queen chamber (random shape, conforming to the new corner styling)
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        if (this.isValid(c, r)) {
          // Conform to new corner styling
          const dx = Math.min(c - minCol, maxCol - c);
          const dy = Math.min(r - minRow, maxRow - r);
          if (dx < 3 && dy < 2) {
            const dist = (3 - dx) ** 2 + (2 - dy) ** 2;
            if (dist > 5) {
              continue; // Skip clearing this cell to round the chamber corner
            }
          }
          this.clearCell(c, r);
        }
      }
    }

    // Spawn some initial food at the surface (fallen apples)
    this.spawnFoodAt(entranceCol - 25, skyHeight - 1, 300); // near nest (Col 175)
    this.spawnFoodAt(entranceCol - 120, skyHeight - 1, 250); // under outer canopy of tree 1 (Col 80)
    this.spawnFoodAt(entranceCol + 60, skyHeight - 1, 250); // under outer canopy of tree 2 (Col 260)
    this.spawnFoodAt(entranceCol + 155, skyHeight - 1, 250); // under outer canopy of tree 3 (Col 355) // under outer canopy of tree 3 // under outer canopy of tree 3 (Col 355)
  }

  public isValid(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  public getCell(col: number, row: number): Cell | null {
    if (!this.isValid(col, row)) return null;
    return this.cells[col][row];
  }

  public clearCell(col: number, row: number) {
    if (this.isValid(col, row)) {
      this.cells[col][row].type = 'NestAir';
      this.cells[col][row].foodAmount = 0;
    }
  }

  public setCellType(col: number, row: number, type: CellType) {
    if (this.isValid(col, row)) {
      this.cells[col][row].type = type;
      if (type !== 'Food') {
        this.cells[col][row].foodAmount = 0;
      }
    }
  }

  /** Place a Food cell at (col, row) with the given amount and food type. */
  public convertToFood(col: number, row: number, amount: number, foodType: FoodType = 'Apple') {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    cell.type = 'Food';
    cell.foodAmount = amount;
    cell.foodType = foodType;
  }

  /** Convert a Food cell back to the given air type and clear all food metadata. */
  public clearFoodCell(col: number, row: number, airType: CellType = 'NestAir') {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    cell.type = airType;
    cell.foodAmount = 0;
    cell.foodType = undefined;
    cell.isMoldy = undefined;
  }

  /** Deposit a food drop at (col, row) for a dying ant carrying food. */
  public depositFoodDrop(col: number, row: number, amount: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    cell.type = 'Food';
    cell.foodAmount = amount;
  }

  /** Deposit a dirt drop at (col, row) for a dying ant carrying dirt underground. */
  public depositDirtDrop(col: number, row: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    if (cell.type === 'NestAir') {
      cell.type = 'Dirt';
      cell.noiseVal = Math.random();
    }
  }

  /**
   * Remove up to `amount` food from a Food cell.
   * Returns the amount actually removed.
   * Clears the cell to `clearType` if food reaches 0.
   */
  public removeFood(col: number, row: number, amount: number, clearType: CellType = 'NestAir'): number {
    if (!this.isValid(col, row)) return 0;
    const cell = this.cells[col][row];
    if (cell.type !== 'Food') return 0;
    const removed = Math.min(cell.foodAmount, amount);
    cell.foodAmount -= removed;
    if (cell.foodAmount <= 0) {
      cell.type = clearType;
      cell.foodAmount = 0;
      cell.foodType = undefined;
      cell.isMoldy = undefined;
    }
    return removed;
  }

  /** Mark a Food cell as moldy. */
  public setMoldy(col: number, row: number) {
    if (!this.isValid(col, row)) return;
    this.cells[col][row].isMoldy = true;
  }

  /** Decay food in a Food cell by `amount`. Clears cell if food reaches 0. */
  public decayFood(col: number, row: number, amount: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    if (cell.type !== 'Food') return;
    cell.foodAmount -= amount;
    if (cell.foodAmount <= 0) {
      cell.type = 'NestAir';
      cell.foodAmount = 0;
      cell.foodType = undefined;
      cell.isMoldy = false;
    }
  }

  /**
   * Add `amount` food to an existing Food cell (partial top-up).
   * Does NOT create a new Food cell — only adds to cells already typed 'Food'.
   */
  public addFoodAmount(col: number, row: number, amount: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    if (cell.type === 'Food') {
      cell.foodAmount += amount;
    }
  }

  /**
   * Subtract `amount` food from an existing Food cell without clearing it.
   * Use when you know the cell still has food remaining after the deduction.
   */
  public subtractFoodAmount(col: number, row: number, amount: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    if (cell.type === 'Food') {
      cell.foodAmount -= amount;
    }
  }

  /** Clear a Food cell to Sky (used when cleaning up stale surface food artifacts). */
  public clearSurfaceFoodCell(col: number, row: number) {
    if (!this.isValid(col, row)) return;
    const cell = this.cells[col][row];
    if (cell.type === 'Food') {
      cell.type = 'Sky';
      cell.foodAmount = 0;
    }
  }

  public isWalkable(col: number, row: number): boolean {
    const cell = this.getCell(col, row);
    if (!cell) return false;
    return cell.type === 'NestAir' || cell.type === 'Sky' || cell.type === 'Food' || cell.type === 'Water';
  }

  public isDiggable(col: number, row: number): boolean {
    const cell = this.getCell(col, row);
    if (!cell) return false;
    return cell.type === 'Dirt' || cell.type === 'Rock';
  }

  public digCell(col: number, row: number): boolean {
    if (!this.isValid(col, row)) return false;
    const cell = this.cells[col][row];
    if (cell.type === 'Dirt') {
      cell.type = 'NestAir';
      return true;
    } else if (cell.type === 'Rock') {
      if (cell.durability === undefined) {
        cell.durability = 5;
      }
      cell.durability--;
      if (cell.durability <= 0) {
        cell.type = 'NestAir';
        return true;
      }
      return true; // Still returns true so the digger carries rock debris (dirt) away
    }
    return false;
  }

  public spawnFoodAt(col: number, row: number, amount: number, foodType: FoodType = 'Apple') {
    // Fill a small cluster with food cells
    const radius = amount > 300 ? 5 : 3;
    for (let c = col - radius; c <= col + radius; c++) {
      for (let r = row - radius; r <= row; r++) {
        if (this.isValid(c, r) && this.cells[c][r].type === 'Sky') {
          // Put food on top of surface
          const dist = Math.sqrt((c - col) ** 2 + (r - row) ** 2);
          if (dist < radius && Math.random() > 0.15) {
            this.cells[c][r].type = 'Food';
            this.cells[c][r].foodAmount = CONFIG.FOOD_PIECE_SIZE;
            this.cells[c][r].foodType = foodType;
          }
        }
      }
    }
  }



  // Find nearest food cell
  public getClosestFood(posX: number, posY: number): Position | null {
    const col = Math.floor(posX / CONFIG.CELL_SIZE);
    const row = Math.floor(posY / CONFIG.CELL_SIZE);

    let closestDist = Infinity;
    let closestPos: Position | null = null;

    // Broad search in a window
    const searchRadius = 40;
    const startC = Math.max(0, col - searchRadius);
    const endC = Math.min(this.cols - 1, col + searchRadius);
    const startR = Math.max(0, row - searchRadius);
    const endR = Math.min(this.rows - 1, row + searchRadius);

    for (let c = startC; c <= endC; c++) {
      for (let r = startR; r <= endR; r++) {
        if (this.cells[c][r].type === 'Food' && this.cells[c][r].foodAmount > 0) {
          const dx = c - col;
          const dy = r - row;
          const distSq = dx * dx + dy * dy;
          if (distSq < closestDist) {
            closestDist = distSq;
            closestPos = {
              x: c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
              y: r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
            };
          }
        }
      }
    }
    return closestPos;
  }

  // Find the surface height for a column (row index of the highest solid block)
  public getSurfaceRow(c: number): number {
    for (let r = 0; r < this.rows; r++) {
      if (this.cells[c][r].type === 'Dirt' || this.cells[c][r].type === 'Rock') {
        return r;
      }
    }
    return this.rows;
  }

  // Deposit dirt on surface to form mounds with natural sloped profiles
  public depositDirt(fromCol: number) {
    // Drop the dirt exactly where the ant is (fromCol)
    let col = Math.max(2, Math.min(this.cols - 3, fromCol));

    // Ensure it is outside the entrance buffer zone (minimum distance of 8 cells)
    // to prevent dirt from settling directly inside the shaft opening or sliding into it.
    if (col < this.nestEntranceCol && col > this.nestEntranceCol - 8) {
      col = this.nestEntranceCol - 8;
    } else if (col >= this.nestEntranceCol && col < this.nestEntranceCol + 8) {
      col = this.nestEntranceCol + 8;
    }

    // Find the surface height for a column (row index of the highest solid block)
    const getSurfaceRow = (c: number): number => this.getSurfaceRow(c);

    // Simulate soil sliding (avalanche) to enforce natural angle of repose
    let settled = false;
    for (let steps = 0; steps < 15 && !settled; steps++) {
      const currentR = getSurfaceRow(col);
      const leftR = getSurfaceRow(col - 1);
      const rightR = getSurfaceRow(col + 1);

      // Lower row index means physically higher.
      // If current column is 2 or more blocks higher than left, slide left
      if (currentR < leftR - 1 && col > 2) {
        // Prevent sliding into the nest entrance shaft buffer
        const nextCol = col - 1;
        if (Math.abs(nextCol - this.nestEntranceCol) >= 8) {
          col--;
        } else {
          settled = true;
        }
      }
      // If current column is 2 or more blocks higher than right, slide right
      else if (currentR < rightR - 1 && col < this.cols - 3) {
        // Prevent sliding into the nest entrance shaft buffer
        const nextCol = col + 1;
        if (Math.abs(nextCol - this.nestEntranceCol) >= 8) {
          col++;
        } else {
          settled = true;
        }
      }
      else {
        settled = true;
      }
    }

    // Drop the dirt at the settled column
    const finalR = getSurfaceRow(col);
    if (finalR > 0) {
      this.cells[col][finalR - 1].type = 'Dirt';
      this.cells[col][finalR - 1].noiseVal = Math.random();
    }
  }

  // Slow mound erosion for Rainy weather conditions
  public erodeMounds() {
    const candidates: number[] = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < CONFIG.SKY_HEIGHT; r++) {
        if (this.cells[c][r].type === 'Dirt') {
          candidates.push(c);
          break;
        }
      }
    }

    if (candidates.length === 0) return;

    // Select a random column with a mound
    const col = candidates[Math.floor(Math.random() * candidates.length)];

    // Find the topmost dirt cell and erode it back to Sky
    for (let r = 0; r < CONFIG.SKY_HEIGHT; r++) {
      if (this.cells[col][r].type === 'Dirt') {
        this.cells[col][r].type = 'Sky';
        break;
      }
    }
  }

  // Count empty spaces underground (for nest volume stats)
  public getNestVolume(): number {
    let volume = 0;
    for (let c = 0; c < this.cols; c++) {
      for (let r = CONFIG.SKY_HEIGHT; r < this.rows; r++) {
        if (this.cells[c][r].type === 'NestAir') {
          volume++;
        }
      }
    }
    return volume;
  }

  // Cellular water simulation update
  public updateWater() {
    for (let r = this.rows - 1; r >= 0; r--) {
      // Collect all water cells in row r
      const waterCols: number[] = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[c][r].type === 'Water') {
          waterCols.push(c);
        }
      }
      if (waterCols.length === 0) continue;

      // Shuffle columns to prevent directional flow bias
      for (let i = waterCols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = waterCols[i];
        waterCols[i] = waterCols[j];
        waterCols[j] = temp;
      }

      for (const c of waterCols) {
        // Double check type in case it was swapped by a lateral move in the same row
        if (this.cells[c][r].type !== 'Water') continue;

        // If a water cell is on the surface (above CONFIG.SKY_HEIGHT) and not in the shaft columns, evaporate it
        if (r < CONFIG.SKY_HEIGHT && (c < this.nestEntranceCol - 2 || c > this.nestEntranceCol + 1)) {
          this.cells[c][r].type = 'Sky';
          continue;
        }

        // 1. Try directly below
        const belowR = r + 1;
        if (belowR < this.rows) {
          const belowCell = this.cells[c][belowR];
          if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
            belowCell.type = 'Water';
            this.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
            continue;
          }
        }

        // 2. Try diagonal below (left or right randomly)
        const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        let movedDiag = false;
        for (const dc of diagOffsets) {
          const tc = c + dc;
          const tr = r + 1;
          if (this.isValid(tc, tr)) {
            const diagCell = this.cells[tc][tr];
            if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
              diagCell.type = 'Water';
              this.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
              movedDiag = true;
              break;
            }
          }
        }
        if (movedDiag) continue;

        // 3. Try lateral left/right randomly
        const latOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        let movedLat = false;
        for (const dc of latOffsets) {
          const tc = c + dc;
          if (this.isValid(tc, r)) {
            const latCell = this.cells[tc][r];
            if (latCell.type === 'NestAir' || latCell.type === 'Sky') {
              latCell.type = 'Water';
              this.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
              movedLat = true;
              break;
            }
          }
        }
        if (movedLat) continue;
      }
    }
  }

  // Cellular food gravity simulation
  public updateFoodPhysics() {
    for (let r = this.rows - 2; r >= 0; r--) {
      const foodCols: number[] = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[c][r].type === 'Food') {
          foodCols.push(c);
        }
      }
      if (foodCols.length === 0) continue;

      // Shuffle columns to prevent directional falling bias
      for (let i = foodCols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = foodCols[i];
        foodCols[i] = foodCols[j];
        foodCols[j] = temp;
      }

      for (const c of foodCols) {
        if (this.cells[c][r].type !== 'Food') continue;

        // 1. Try directly below
        const belowR = r + 1;
        if (belowR < this.rows) {
          const belowCell = this.cells[c][belowR];
          if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
            belowCell.type = 'Food';
            belowCell.foodAmount = this.cells[c][r].foodAmount;
            belowCell.foodType = this.cells[c][r].foodType;
            belowCell.isMoldy = this.cells[c][r].isMoldy;

            this.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
            this.cells[c][r].foodAmount = 0;
            this.cells[c][r].foodType = undefined;
            this.cells[c][r].isMoldy = undefined;
            continue;
          }
        }

        // 2. Try diagonal below (left or right randomly) to slide down slopes
        const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        let movedDiag = false;
        for (const dc of diagOffsets) {
          const tc = c + dc;
          const tr = r + 1;
          if (this.isValid(tc, tr)) {
            const diagCell = this.cells[tc][tr];
            if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
              diagCell.type = 'Food';
              diagCell.foodAmount = this.cells[c][r].foodAmount;
              diagCell.foodType = this.cells[c][r].foodType;
              diagCell.isMoldy = this.cells[c][r].isMoldy;

              this.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
              this.cells[c][r].foodAmount = 0;
              this.cells[c][r].foodType = undefined;
              this.cells[c][r].isMoldy = undefined;
              movedDiag = true;
              break;
            }
          }
        }
        if (movedDiag) continue;
      }
    }
  }
}
