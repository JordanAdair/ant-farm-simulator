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

  it('should correctly select the underrepresented role based on target ratios', () => {
    const colony = new ColonyManager(200);
    // Initial roles are: 3 Foragers, 4 Diggers, 1 Nurse
    // Total 8 ants.
    // Ratios: Forager: 3/8 = 37.5% (target 40%), Digger: 4/8 = 50% (target 35%), Nurse: 1/8 = 12.5% (target 25%)
    // Deviation from target (target - current):
    // Forager: 40% - 37.5% = 2.5%
    // Digger: 35% - 50% = -15%
    // Nurse: 25% - 12.5% = 12.5%
    // Nurse is furthest below target, so it should be underrepresented.
    // Let's call the private getUnderRepresentedRole method using type casting:
    const role = (colony as any).getUnderRepresentedRole();
    expect(role).toBe('Nurse');

    // If we add another Nurse, we have: 3 Foragers, 4 Diggers, 2 Nurses (Total 9)
    // Ratios: Forager: 33.3%, Digger: 44.4%, Nurse: 22.2%
    // Devs: Forager: 6.7%, Digger: -9.4%, Nurse: 2.8%
    // Forager is now furthest below target.
    colony.ants[0].role = 'Nurse'; // Convert one Forager to Nurse -> 2 Foragers, 4 Diggers, 2 Nurses (Total 8)
    // Ratios: Forager: 25%, Digger: 50%, Nurse: 25%
    // Devs: Forager: 15%, Digger: -15%, Nurse: 0%
    // Forager should be underrepresented
    const role2 = (colony as any).getUnderRepresentedRole();
    expect(role2).toBe('Forager');
  });

  it('should balance roles when they deviate by more than 2% from targets', () => {
    const colony = new ColonyManager(200);
    
    // Set roles extremely skewed: 8 foragers, 0 diggers, 0 nurses (Total 8)
    for (const ant of colony.ants) {
      ant.role = 'Forager';
      ant.cargo = 'None';
    }

    // Run balancer update loop multiple times to trigger reassignment
    // (balancer checks Math.random() < 0.01, so we simulate multiple frames or override the check)
    // Let's just manually run the private balanceAntRoles:
    for (let i = 0; i < 500; i++) {
      (colony as any).balanceAntRoles();
    }

    // Since we called balanceAntRoles 500 times with Math.random() < 0.01 per call,
    // some foragers should have been reassigned to other roles to balance towards target ratios.
    const foragersCount = colony.ants.filter(a => a.role === 'Forager').length;
    expect(foragersCount).toBeLessThan(8);
  });

  it('should relocate the Queen when her current nursery is full', () => {
    const colony = new ColonyManager(200);
    const grid = {
      isValid: () => true,
      isWalkable: () => true,
      getNestVolume: () => 100,
      cols: CONFIG.COLS,
      rows: CONFIG.ROWS,
    } as any;

    const n1 = { x: 100, y: 100 };
    const n2 = { x: 200, y: 100 };
    
    // Override getExcavatedChambers to return two mock nurseries
    colony.getExcavatedChambers = () => ({
      nurseries: [n1, n2],
      foodStorages: []
    });

    colony.queen.currentNursery = n1;
    colony.queen.x = n1.x;
    colony.queen.y = n1.y;

    // Fill current nursery (n1) with 15 eggs
    for (let i = 0; i < 15; i++) {
      colony.broodList.push({
        id: `egg-${i}`,
        type: 'Egg',
        x: n1.x,
        y: n1.y,
        progress: 0,
        needsFood: false,
        beingCarried: false,
      });
    }

    // Force queen.eggTimer to 0 and ensure enough food to lay egg
    colony.queen.eggTimer = 0;
    colony.foodStockpile = 20;

    // Call update to trigger layEgg -> relocation check
    colony.update(1, grid);

    // Expect the Queen to have calculated a path to relocate
    expect(colony.queen.path).toBeDefined();
    expect(colony.queen.path!.length).toBeGreaterThan(0);
    // She should also target n2 now
    expect(colony.queen.currentNursery).toEqual(n2);
  });
});

