import { describe, it, expect } from 'vitest';
import { ColonyManager } from './Colony';
import { CONFIG } from './types';

describe('ColonyManager', () => {
  it('should initialize with starting ants under 180 seconds old', () => {
    const colony = new ColonyManager(200);
    expect(colony.ants.length).toBe(8);
    for (const ant of colony.ants) {
      expect(ant.age).toBeLessThanOrEqual(180);
      expect(ant.age).toBeGreaterThanOrEqual(0);
    }
  });

  it('should decrement Queen egg timer even when food is 0', () => {
    const colony = new ColonyManager(200);
    colony.foodStockpile = 0;
    colony.queen.eggTimer = 10;

    // Advance by 60 frames (1 second at 1x speed)
    colony.update(60);

    expect(colony.queen.eggTimer).toBeCloseTo(9.0, 5);
  });

  it('should freeze Queen egg timer at 0 when food is 0', () => {
    const colony = new ColonyManager(200);
    colony.foodStockpile = 0;
    colony.queen.eggTimer = 0.5;

    // Advance by 60 frames (1 second at 1x speed)
    colony.update(60);

    expect(colony.queen.eggTimer).toBe(0);
    expect(colony.broodList.length).toBe(0); // No egg laid because food < 10
  });

  it('should lay egg immediately when food becomes available if timer is 0', () => {
    const colony = new ColonyManager(200);
    colony.foodStockpile = 0;
    colony.queen.eggTimer = 0;

    // Give 10 food
    colony.foodStockpile = 10;

    // Advance by 1 frame (dt = 1)
    colony.update(1);

    expect(colony.broodList.length).toBe(1);
    expect(colony.broodList[0].type).toBe('Egg');
    expect(colony.foodStockpile).toBeCloseTo(0.0, 5);
    expect(colony.queen.eggTimer).toBeGreaterThan(0); // Reset timer
  });

  it('should scale food consumption with population', () => {
    const colony = new ColonyManager(200);
    colony.foodStockpile = 100;
    
    // We have 8 ants in the colony.
    // Passive consumption rate = 8 * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * dt / 60
    // At dt = 60 (1 second): 8 * 0.05 * 0.1 * 1 = 0.04 food.
    const expectedConsumption = 8 * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * 1; // 0.04
    
    colony.update(60);
    expect(colony.foodStockpile).toBeCloseTo(100 - expectedConsumption, 5);
  });
});
