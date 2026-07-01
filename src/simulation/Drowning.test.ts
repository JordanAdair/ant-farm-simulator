import { describe, it, expect } from 'vitest';
import { Ant } from './Ant';
import { ColonyManager } from './Colony';
import { WorldGrid } from './Grid';
import { CONFIG } from './types';
import type { IFoodStockpile } from './FoodStockpile';

/** Minimal in-memory stockpile for tests that don't need grid-backed food. */
function makeStockpile(initial: number): IFoodStockpile {
  let food = initial;
  return {
    get total() { return food; },
    consume(amount: number) {
      if (food < amount) return false;
      food -= amount;
      return true;
    },
    deposit(amount: number) { food += amount; },
  };
}

describe('Drowning Mechanics', () => {
  it('should decrease worker ant health if submerged in water for more than 5 seconds', () => {
    const grid = new WorldGrid();
    
    // Fill the entire grid with water so the ant cannot escape
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        grid.setCellType(c, r, 'Water');
      }
    }
    
    const col = 200;
    const row = CONFIG.SKY_HEIGHT + 10;
    const ant = new Ant('ant-1', col * CONFIG.CELL_SIZE, row * CONFIG.CELL_SIZE, 'Forager', 1);
    expect(ant.health).toBe(100);
    expect(ant.submergedTime).toBe(0);
    
    const pheromoneMock = {
      addFoodPheromone: () => {},
      addHomePheromone: () => {},
      getFoodPheromone: () => 0,
      getHomePheromone: () => 0,
    } as any;

    // Update ant in water. At 60 fps, 1 frame = 1 / 60 seconds.
    // Let's run for 300 frames (5 seconds)
    for (let i = 0; i < 300; i++) {
      ant.update(
        grid,
        pheromoneMock,
        makeStockpile(100),
        [],
        { x: 100, y: 100 },
        null,
        null,
        [],
        [],
        null as any,
        1,
        () => {}
      );
    }
    
    // At exactly 5.0 seconds, health should still be 100
    expect(ant.health).toBe(100);
    
    // Run for another 60 frames (1 second). It should take damage
    for (let i = 0; i < 60; i++) {
      ant.update(
        grid,
        pheromoneMock,
        makeStockpile(100),
        [],
        { x: 100, y: 100 },
        null,
        null,
        [],
        [],
        null as any,
        1,
        () => {}
      );
    }
    
    expect(ant.health).toBeLessThan(100);
  });

  it('should decrease Queen health if submerged in water for more than 5 seconds and cause drowning death', () => {
    const colony = new ColonyManager(200);
    const grid = new WorldGrid();
    
    // Fill the entire grid with water so the Queen cannot escape
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        grid.setCellType(c, r, 'Water');
      }
    }
    
    expect(colony.queen.health).toBe(100);
    expect(colony.queen.isDead).toBeFalsy();
    
    // Run update for 300 frames (5 seconds)
    colony.update(300, grid);
    expect(colony.queen.health).toBe(100);
    
    // Run update for another 300 frames (5 seconds). She should take damage and die
    colony.update(300, grid);
    
    expect(colony.queen.health).toBeLessThan(100);
    
    // Let's run it until she drowns completely
    for (let i = 0; i < 100; i++) {
      colony.update(60, grid);
      if (colony.queen.isDead) break;
    }
    
    expect(colony.queen.isDead).toBe(true);
    expect(colony.queen.deathReason).toBe('drowning');
  });
});
