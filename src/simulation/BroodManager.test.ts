import { describe, it, expect } from 'vitest';
import { BroodManager } from './BroodManager';
import { Position } from './types';

describe('BroodManager Lifecycle', () => {
  it('should progress egg to larva', () => {
    const bm = new BroodManager();
    bm.broodList.push({
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
    bm.broodList.push({
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
      bm.broodList.push({
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
      bm.broodList.push({
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
      bm.broodList.push({
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
});
