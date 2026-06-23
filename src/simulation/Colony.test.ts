import { describe, it, expect } from 'vitest';
import { ColonyManager } from './Colony';
import { CONFIG } from './types';
import { Ant } from './Ant';
import { WorldGrid } from './Grid';

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
    
    // Explicitly configure roles to test underrepresented calculation:
    // Say we have 3 Foragers, 3 Diggers, 2 Soldiers, 0 Nurses (Total 8)
    // Targets: Foragers 30%, Diggers 40%, Nurses 15%, Soldiers 15%
    // Nurses are at 0/8 = 0%, so they must be underrepresented.
    colony.ants[0].role = 'Forager';
    colony.ants[1].role = 'Forager';
    colony.ants[2].role = 'Forager';
    colony.ants[3].role = 'Digger';
    colony.ants[4].role = 'Digger';
    colony.ants[5].role = 'Digger';
    colony.ants[6].role = 'Soldier';
    colony.ants[7].role = 'Soldier';

    const role = (colony as any).getUnderRepresentedRole();
    expect(role).toBe('Nurse');

    // Force Forager to be underrepresented:
    // Set roles: 1 Forager, 4 Diggers, 2 Nurses, 1 Soldier (Total 8)
    // Ratios: Forager 12.5% (target 30%, diff = 17.5%)
    colony.ants[0].role = 'Forager';
    colony.ants[1].role = 'Digger';
    colony.ants[2].role = 'Digger';
    colony.ants[3].role = 'Digger';
    colony.ants[4].role = 'Digger';
    colony.ants[5].role = 'Nurse';
    colony.ants[6].role = 'Nurse';
    colony.ants[7].role = 'Soldier';

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

  it('should deplete Queen energy and cause starvation death after 21600 frames', () => {
    const colony = new ColonyManager(200);
    expect(colony.queen.energy).toBe(100);
    expect(colony.queen.isDead).toBeFalsy();

    // Starvation takes 21600 frames at 1x speed.
    // Let's run update with dt = 22000.
    colony.update(22000);

    expect(colony.queen.energy).toBe(0);
    expect(colony.queen.isDead).toBe(true);
  });

  it('should allow Nurse ant to retrieve food cell from larder to feed hungry Queen', () => {
    const colony = new ColonyManager(200);
    const grid = new WorldGrid();
    colony.grid = grid;

    // Set Queen to hungry (< 75)
    colony.queen.energy = 50;

    // Ensure we have a nurse ant close to Queen and starting larder
    const queenX = colony.queen.x;
    const queenY = colony.queen.y;
    const nurse = new Ant('nurse-1', queenX, queenY, 'Nurse', 1);
    colony.ants = [nurse];

    // Check starting food larder setup
    const chambers = colony.getExcavatedChambers(grid);
    const foodStorages = chambers.foodStorages;
    expect(foodStorages.length).toBeGreaterThan(0);

    // Grid starts with food (synchronized from fallback = 200)
    expect(colony.foodStockpile).toBe(200);

    // Call update on the nurse directly in a loop to let her retrieve food and feed the Queen
    const stockpileRef = { food: colony.foodStockpile };
    let fed = false;

    // Run nurse updates for up to 300 steps
    for (let step = 0; step < 300; step++) {
      nurse.update(
        grid,
        {
          addFoodPheromone: () => {},
          addHomePheromone: () => {},
          getFoodPheromone: () => 0,
          getHomePheromone: () => 0,
        } as any,
        stockpileRef,
        colony.broodList,
        colony.queen,
        null,
        null,
        chambers.nurseries,
        foodStorages,
        colony.broodManager,
        1,
        () => {}
      );

      // Reconcile stockpile value
      colony.foodStockpile = stockpileRef.food;

      if (colony.queen.energy > 50) {
        fed = true;
        break;
      }
    }

    expect(fed).toBe(true);
    expect(colony.queen.energy).toBeCloseTo(75, 2);
    expect(colony.foodStockpile).toBe(199); // 1 unit of food cell amount was consumed
  });
});

