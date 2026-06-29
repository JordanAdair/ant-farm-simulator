import { describe, it, expect } from 'vitest';
import { BroodManager } from './BroodManager';
import type { Position } from './types';

describe('BroodManager Lifecycle', () => {
  it('should progress egg to larva', () => {
    const bm = new BroodManager();
    bm.addBrood({
      id: 'egg-1',
      type: 'Egg',
      x: 100,
      y: 100,
      progress: 99.99,
      needsFood: false,
      beingCarried: false,
    });

    let logCalled = false;
    bm.update(1, () => {}, () => { logCalled = true; });

    expect(bm.broodList[0].type).toBe('Larva');
    expect(bm.broodList[0].progress).toBe(0);
    expect(bm.broodList[0].needsFood).toBe(true);
    expect(logCalled).toBe(true);
  });

  it('should hatch pupa into a new ant', () => {
    const bm = new BroodManager();
    bm.addBrood({
      id: 'pupa-1',
      type: 'Pupa',
      x: 100,
      y: 100,
      progress: 99.99,
      needsFood: false,
      beingCarried: false,
    });

    let hatchCalled = false;
    bm.update(1, (x, y) => {
      expect(x).toBe(100);
      expect(y).toBe(100);
      hatchCalled = true;
    }, () => {});

    expect(hatchCalled).toBe(true);
    expect(bm.broodList.length).toBe(0);
  });

  it('should calculate occupancy and return full/crowded status', () => {
    const bm = new BroodManager();
    const nursery: Position = { x: 100, y: 100 };
    
    // Initially empty
    expect(bm.getNurseryOccupancy(nursery)).toBe(0);
    expect(bm.isNurseryFull(nursery)).toBe(false);
    expect(bm.isNurseryCrowded(nursery)).toBe(false);

    // Add 12 items -> Crowded (12/15 = 80%) but not full
    for (let i = 0; i < 12; i++) {
      bm.addBrood({
        id: `b-${i}`,
        type: 'Egg',
        x: 102,
        y: 98,
        progress: 0,
        needsFood: false,
        beingCarried: false,
      });
    }
    expect(bm.getNurseryOccupancy(nursery)).toBe(12);
    expect(bm.isNurseryFull(nursery)).toBe(false);
    expect(bm.isNurseryCrowded(nursery)).toBe(true);

    // Add 3 more -> Full (15/15)
    for (let i = 12; i < 15; i++) {
      bm.addBrood({
        id: `b-${i}`,
        type: 'Egg',
        x: 102,
        y: 98,
        progress: 0,
        needsFood: false,
        beingCarried: false,
      });
    }
    expect(bm.getNurseryOccupancy(nursery)).toBe(15);
    expect(bm.isNurseryFull(nursery)).toBe(true);
  });

  it('should return available nursery sorted by occupancy', () => {
    const bm = new BroodManager();
    const n1: Position = { x: 100, y: 100 };
    const n2: Position = { x: 200, y: 200 };

    // Put 3 items in n1
    for (let i = 0; i < 3; i++) {
      bm.addBrood({
        id: `n1-${i}`,
        type: 'Egg',
        x: 100,
        y: 100,
        progress: 0,
        needsFood: false,
        beingCarried: false,
      });
    }

    // n2 has 0 occupancy, so getAvailableNursery should return n2
    const best = bm.getAvailableNursery([n1, n2]);
    expect(best).toEqual(n2);
  });

  it('should find a walkable position that is at least 8px away from other brood', () => {
    const bm = new BroodManager();
    const mockGrid = {
      isValid: () => true,
      isWalkable: () => true,
    } as any;

    const nursery: Position = { x: 100, y: 100 };

    // Put a brood item exactly at the center (100, 100)
    bm.addBrood({
      id: 'center-brood',
      type: 'Egg',
      x: 100,
      y: 100,
      progress: 0,
      needsFood: false,
      beingCarried: false,
    });

    // Find spaced position. It should be at least 8px away from (100, 100)
    const pos = bm.findSpacedPositionInNursery(mockGrid, nursery);
    expect(pos).not.toBeNull();
    if (pos) {
      const dist = Math.sqrt((pos.x - 100) ** 2 + (pos.y - 100) ** 2);
      expect(dist).toBeGreaterThanOrEqual(8);
    }
  });

  it('should lay egg at a spaced position in the closest nursery if available', () => {
    const bm = new BroodManager();
    const mockGrid = {
      isValid: () => true,
      isWalkable: () => true,
    } as any;

    const n1: Position = { x: 100, y: 100 };
    const n2: Position = { x: 200, y: 200 };
    const queenPos: Position = { x: 95, y: 95 }; // closest to n1

    let logCalled = false;
    bm.layEgg(mockGrid, queenPos, [n1, n2], () => { logCalled = true; });

    expect(bm.broodList.length).toBe(1);
    expect(bm.broodList[0].type).toBe('Egg');
    expect(logCalled).toBe(true);

    // Should be placed near n1 (since it's closer to queen than n2)
    const distN1 = Math.sqrt((bm.broodList[0].x - n1.x) ** 2 + (bm.broodList[0].y - n1.y) ** 2);
    expect(distN1).toBeLessThan(40);
  });
});

