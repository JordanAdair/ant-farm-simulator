import { describe, it, expect } from 'vitest';
import { PheromoneGrid } from './Pheromones';
import { WorldGrid } from './Grid';
import { CONFIG } from './types';

describe('PheromoneGrid', () => {
  it('should initialize with zeros', () => {
    const pg = new PheromoneGrid();
    expect(pg.getHomePheromone(10, 10)).toBe(0);
    expect(pg.getFoodPheromone(10, 10)).toBe(0);
  });

  it('should allow adding pheromones', () => {
    const pg = new PheromoneGrid();
    pg.addHomePheromone(10, 10, 1.0);
    pg.addFoodPheromone(10, 10, 2.0);
    expect(pg.getHomePheromone(10, 10)).toBe(1.0);
    expect(pg.getFoodPheromone(10, 10)).toBe(2.0);
  });

  it('should decay food pheromones normally when food is nearby', () => {
    const grid = new WorldGrid();
    const pg = new PheromoneGrid();

    // Place food at (10, 10)
    grid.cells[10][10].type = 'Food';
    grid.cells[10][10].foodAmount = 100;

    // Lay food pheromone at (12, 12) (Manhattan distance = 4 cells, which is <= 80)
    pg.addFoodPheromone(12, 12, 1.0);

    // Update once (speedMultiplier = 1)
    pg.update(grid, 1);

    // Expected value = (1.0 - 0.004) * (1 - 0.1) = 0.8964
    const expectedDecayed = 1.0 - CONFIG.PHEROMONE_DECAY;
    const expected = expectedDecayed * (1 - CONFIG.PHEROMONE_DIFFUSION);
    expect(pg.getFoodPheromone(12, 12)).toBeCloseTo(expected, 5);
  });

  it('should decay food pheromones at 5x accelerated rate when all food is depleted', () => {
    const grid = new WorldGrid();
    const pg = new PheromoneGrid();

    // Clear all food from the grid
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        grid.cells[c][r].type = 'NestAir';
        grid.cells[c][r].foodAmount = 0;
      }
    }

    // Lay food pheromone at (12, 12)
    pg.addFoodPheromone(12, 12, 1.0);

    // Update once
    pg.update(grid, 1);

    // Expected value = (1.0 - 5 * 0.004) * (1 - 0.1) = 0.882
    const expectedDecayed = 1.0 - 5 * CONFIG.PHEROMONE_DECAY;
    const expected = expectedDecayed * (1 - CONFIG.PHEROMONE_DIFFUSION);
    expect(pg.getFoodPheromone(12, 12)).toBeCloseTo(expected, 5);
  });

  it('should decay food pheromones at 5x accelerated rate when food is far away (> 80 cells)', () => {
    const grid = new WorldGrid();
    const pg = new PheromoneGrid();

    // Clear all food from grid, then place food far away at (150, 150)
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        grid.cells[c][r].type = 'NestAir';
        grid.cells[c][r].foodAmount = 0;
      }
    }
    grid.cells[150][150].type = 'Food';
    grid.cells[150][150].foodAmount = 100;

    // Lay food pheromone at (10, 10) (Manhattan distance = 140 + 140 = 280 cells, which is > 80)
    pg.addFoodPheromone(10, 10, 1.0);

    // Update once
    pg.update(grid, 1);

    // Expected value = (1.0 - 5 * 0.004) * (1 - 0.1) = 0.882
    const expectedDecayed = 1.0 - 5 * CONFIG.PHEROMONE_DECAY;
    const expected = expectedDecayed * (1 - CONFIG.PHEROMONE_DIFFUSION);
    expect(pg.getFoodPheromone(10, 10)).toBeCloseTo(expected, 5);
  });
});
