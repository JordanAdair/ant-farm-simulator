import { describe, it, expect } from 'vitest';
import { BroodManager } from './BroodManager';
import { CONFIG } from './types';

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
});
