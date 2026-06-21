import { describe, it, expect } from 'vitest';
import { FoliageSystem } from './Foliage';
import { WorldGrid } from './Grid';

describe('FoliageSystem', () => {
  it('should initialize with trees and grass blades', () => {
    const foliage = new FoliageSystem();
    const grid = new WorldGrid();
    foliage.initialize(grid);

    expect(foliage.trees).toHaveLength(3);
    expect(foliage.grassBlades.length).toBeGreaterThanOrEqual(64);
    expect(foliage.grassBlades.length).toBeLessThanOrEqual(96);
  });

  it('should grow fruit when updated', () => {
    const foliage = new FoliageSystem();
    const grid = new WorldGrid();
    foliage.initialize(grid);

    const initialGrowth = foliage.trees[0].fruits[0].growth;
    foliage.update(100, grid, 'Sunny', () => {});
    const postGrowth = foliage.trees[0].fruits[0].growth;

    expect(postGrowth).toBeGreaterThan(initialGrowth);
  });

  it('should trigger fruit drop and fall', () => {
    const foliage = new FoliageSystem();
    const grid = new WorldGrid();
    foliage.initialize(grid);

    const fruit = foliage.trees[0].fruits[0];
    fruit.growth = 100;

    let logCalled = false;
    foliage.triggerFruitDrop(grid, (_, cat) => {
      logCalled = true;
      expect(cat).toBe('system');
    });

    expect(fruit.isFalling).toBe(true);
    expect(logCalled).toBe(true);

    // Let it fall on update
    // Initial Y is around surface height minus relY (surface row is 130 * 4 = 520, relY is e.g. -270, so y is ~250)
    expect(fruit.y).toBe(130 * 4 + fruit.relY);

    // Run updates to simulate gravity and fall
    let hitGround = false;
    for (let i = 0; i < 200; i++) {
      foliage.update(1, grid, 'Sunny', (msg) => {
        if (msg.includes('bursts open')) {
          hitGround = true;
        }
      });
      if (hitGround) break;
    }

    expect(hitGround).toBe(true);
    expect(fruit.isFalling).toBe(false);
    expect(fruit.growth).toBe(0);
  });
});
