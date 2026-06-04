import { CONFIG } from './types';
import { WorldGrid } from './Grid';

export class PheromoneGrid {
  public cols: number;
  public rows: number;
  
  // 2D grids for home and food pheromones
  public homeGrid: number[][];
  public foodGrid: number[][];
  
  private tempHomeGrid: number[][];
  private tempFoodGrid: number[][];

  constructor() {
    this.cols = CONFIG.COLS;
    this.rows = CONFIG.ROWS;
    
    this.homeGrid = [];
    this.foodGrid = [];
    this.tempHomeGrid = [];
    this.tempFoodGrid = [];
    
    for (let c = 0; c < this.cols; c++) {
      this.homeGrid[c] = new Array(this.rows).fill(0);
      this.foodGrid[c] = new Array(this.rows).fill(0);
      this.tempHomeGrid[c] = new Array(this.rows).fill(0);
      this.tempFoodGrid[c] = new Array(this.rows).fill(0);
    }
  }

  public addHomePheromone(col: number, row: number, strength: number) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.homeGrid[col][row] = Math.min(10.0, this.homeGrid[col][row] + strength);
    }
  }

  public addFoodPheromone(col: number, row: number, strength: number) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.foodGrid[col][row] = Math.min(10.0, this.foodGrid[col][row] + strength);
    }
  }

  public getHomePheromone(col: number, row: number): number {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      return this.homeGrid[col][row];
    }
    return 0;
  }

  public getFoodPheromone(col: number, row: number): number {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      return this.foodGrid[col][row];
    }
    return 0;
  }

  public update(grid: WorldGrid, speedMultiplier: number) {
    const decay = CONFIG.PHEROMONE_DECAY * speedMultiplier;
    const diffRate = CONFIG.PHEROMONE_DIFFUSION;

    // 1. Decay and prepare temp grids
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        this.homeGrid[c][r] = Math.max(0, this.homeGrid[c][r] - decay);
        this.foodGrid[c][r] = Math.max(0, this.foodGrid[c][r] - decay);
        
        this.tempHomeGrid[c][r] = this.homeGrid[c][r];
        this.tempFoodGrid[c][r] = this.foodGrid[c][r];
      }
    }

    // 2. Diffuse: mix values only through walkable cells (tunnels, air)
    for (let c = 1; c < this.cols - 1; c++) {
      for (let r = 1; r < this.rows - 1; r++) {
        if (!grid.isWalkable(c, r)) continue;

        let homeSum = 0;
        let foodSum = 0;
        let walkableCount = 0;

        // Check 4 cardinal neighbors
        const neighbors = [
          [c + 1, r],
          [c - 1, r],
          [c, r + 1],
          [c, r - 1],
        ];

        for (const [nc, nr] of neighbors) {
          if (grid.isWalkable(nc, nr)) {
            homeSum += this.homeGrid[nc][nr];
            foodSum += this.foodGrid[nc][nr];
            walkableCount++;
          }
        }

        if (walkableCount > 0) {
          const avgHome = homeSum / walkableCount;
          const avgFood = foodSum / walkableCount;
          
          this.tempHomeGrid[c][r] = this.homeGrid[c][r] * (1 - diffRate) + avgHome * diffRate;
          this.tempFoodGrid[c][r] = this.foodGrid[c][r] * (1 - diffRate) + avgFood * diffRate;
        }
      }
    }

    // 3. Copy temp grids back
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        this.homeGrid[c][r] = this.tempHomeGrid[c][r];
        this.foodGrid[c][r] = this.tempFoodGrid[c][r];
      }
    }
  }

  public clear() {
    for (let c = 0; c < this.cols; c++) {
      this.homeGrid[c].fill(0);
      this.foodGrid[c].fill(0);
    }
  }
}
