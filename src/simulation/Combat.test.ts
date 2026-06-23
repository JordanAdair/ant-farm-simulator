import { describe, it, expect } from 'vitest';
import { ColonyManager } from './Colony';
import { CONFIG } from './types';
import { Ant } from './Ant';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { Threat } from './Threat';

describe('Combat and Soldier System', () => {
  it('should initialize with Soldier roles and balance towards target Soldier ratio', () => {
    const colony = new ColonyManager(200);
    // Initially, there should be a Soldier in the starting colony
    const soldierCount = colony.ants.filter(a => a.role === 'Soldier').length;
    expect(soldierCount).toBe(1);

    // If we skew roles by setting all to Forager, soldiers should eventually be allocated
    colony.ants.forEach(a => {
      a.role = 'Forager';
      a.cargo = 'None';
    });

    const originalRandom = Math.random;
    Math.random = () => 0.0;
    try {
      for (let i = 0; i < 100; i++) {
        (colony as any).balanceAntRoles();
      }
    } finally {
      Math.random = originalRandom;
    }

    const foragers = colony.ants.filter(a => a.role === 'Forager').length;
    expect(foragers).toBeLessThan(8);

    const soldiers = colony.ants.filter(a => a.role === 'Soldier').length;
    expect(soldiers).toBeGreaterThan(0);
  });

  it('should spawn threats, move threats, and lock targets during combat updates', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    
    // Spawn a Spider threat
    const spider = new Threat('test-spider', 'Spider', 200 * CONFIG.CELL_SIZE, (CONFIG.SKY_HEIGHT - 5) * CONFIG.CELL_SIZE);
    colony.threats.push(spider);

    expect(colony.threats.length).toBe(1);
    expect(spider.health).toBe(100);
    expect(spider.state).toBe('Wandering');

    // Run spider update in proximity of ants to lock targets
    // Position some ants near spider
    const nurse = new Ant('nurse-1', spider.x + 5, spider.y + 5, 'Nurse', 1);
    colony.ants = [nurse];
    colony.queen.isDead = true;

    spider.update(
      grid,
      new PheromoneGrid(),
      colony.ants,
      colony.broodList,
      colony.queen,
      1,
      () => {},
      () => {}
    );

    // Spider should lock onto nurse ant and hunt
    expect(spider.target).toBe(nurse);
    expect(spider.state).toBe('Hunting');
  });

  it('should generate, decay, and diffuse danger pheromones', () => {
    const grid = new WorldGrid();
    const pheromones = new PheromoneGrid();

    // At start, danger pheromones should be 0
    expect(pheromones.getDangerPheromone(50, 50)).toBe(0);

    // Lay danger pheromones
    pheromones.addDangerPheromone(50, 50, 2.0);
    expect(pheromones.getDangerPheromone(50, 50)).toBe(2.0);

    // Run update to decay and diffuse
    pheromones.update(grid, 1);

    // Should decay to less than 2.0
    expect(pheromones.getDangerPheromone(50, 50)).toBeLessThan(2.0);

    // Should diffuse to neighboring cells
    expect(pheromones.getDangerPheromone(49, 50)).toBeGreaterThan(0);
    expect(pheromones.getDangerPheromone(51, 50)).toBeGreaterThan(0);
  });

  it('should decompose defeated threats into Carcass food cells', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    
    // Clear a 10x10 block around start so cells are NestAir
    const col = 200;
    const row = 150;
    for (let c = col - 5; c <= col + 5; c++) {
      for (let r = row - 5; r <= row + 5; r++) {
        grid.setCellType(c, r, 'NestAir');
      }
    }

    // Spawn spider at col, row
    const spider = new Threat('test-spider-dead', 'Spider', col * CONFIG.CELL_SIZE, row * CONFIG.CELL_SIZE);
    spider.health = 0; // dead
    colony.threats.push(spider);

    // Decompose threat
    spider.decompose(grid, () => {});

    // Check if food type is Carcass at or near the spawn point
    let foodCount = 0;
    for (let c = col - 3; c <= col + 3; c++) {
      for (let r = row - 3; r <= row + 3; r++) {
        const cell = grid.getCell(c, r);
        if (cell && cell.type === 'Food' && cell.foodType === 'Carcass') {
          foodCount++;
        }
      }
    }
    // Spider drops 4 Carcass food cells
    expect(foodCount).toBe(4);
  });
});
