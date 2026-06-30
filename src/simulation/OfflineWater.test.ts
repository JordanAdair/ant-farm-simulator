import { describe, it, expect } from 'vitest';
import { OfflineProgression } from './OfflineProgression';
import { WorldGrid } from './Grid';
import { ColonyManager } from './Colony';
import { Environment } from './Environment';
import { Threat } from './Threat';
import type { GameSnapshot } from './types';

/** Build a minimal GameSnapshot for test purposes, reading state from a mock engine shape. */
function makeSnap(
  grid: WorldGrid,
  colony: ColonyManager,
  env: Environment,
  totalDirtDugGlobal = 0
): GameSnapshot {
  return {
    version: 1,
    timestamp: Date.now(),
    gridStr: OfflineProgression.serializeGrid(grid),
    totalDirtDugGlobal,
    maxPopulation: colony.maxPopulation,
    maxGenerationReached: colony.maxGenerationReached,
    excavationPlan: colony.excavationPlan,
    nextAntNum: colony.nextAntNum,
    logs: colony.logs.slice(),
    queen: {
      x: colony.queen.x,
      y: colony.queen.y,
      energy: colony.queen.energy,
      eggTimer: colony.queen.eggTimer,
      restTimer: colony.queen.restTimer ?? 0,
      age: colony.queen.age,
      maxAge: colony.queen.maxAge,
      health: colony.queen.health,
      submergedTime: colony.queen.submergedTime,
      isDead: colony.queen.isDead ?? false,
      deathReason: colony.queen.deathReason,
    },
    broodList: colony.broodManager.broodList.slice() as import('./types').Brood[],
    ants: colony.ants.map(a => ({
      id: (a as any).id ?? 'ant-?',
      x: (a as any).x ?? 0,
      y: (a as any).y ?? 0,
      angle: (a as any).angle ?? 0,
      role: (a as any).role ?? 'Forager',
      state: (a as any).state ?? 'Wandering',
      energy: (a as any).energy ?? 100,
      cargo: (a as any).cargo ?? 'None',
      num: (a as any).num ?? 1,
      brain: (a as any).brain ?? { weights: [0, 0, 0, 0.8, 0], bias: 0 },
      generation: (a as any).generation ?? 1,
      collisions: (a as any).collisions ?? 0,
      deliveries: (a as any).deliveries ?? 0,
      age: (a as any).age ?? 0,
      maxAge: (a as any).maxAge ?? 600,
      health: (a as any).health ?? 100,
      submergedTime: (a as any).submergedTime ?? 0,
    })),
    telemetryHistory: [],
    clock: {
      dayCount: env.dayCount,
      hour: env.hour,
      minute: env.minute,
      minuteFraction: env.minuteFraction,
    },
    weatherState: {
      weather: env.weather,
      weatherTimer: env.weatherTimer,
      weatherTargetDuration: env.weatherTargetDuration,
      weatherQueue: env.weatherQueue.slice(),
    },
  };
}

/** Helper: call the private runOfflineCalculations with the snapshot-based API. */
function runCalcs(
  grid: WorldGrid,
  snap: GameSnapshot,
  seconds: number
): { result: any; updatedSnap: GameSnapshot } {
  return (OfflineProgression as any).runOfflineCalculations(snap, grid, seconds);
}

describe('Offline Progression Physics & Threats', () => {
  it('should spawn surface water cells during rainy weather offline and evaporate them in sunny weather', () => {
    const grid = new WorldGrid();
    const env = new Environment();
    env.weather = 'Rainy';
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;
    env.weatherQueue = [];

    let targetWeather: 'Sunny' | 'Rainy' = 'Rainy';
    env.refillWeatherQueue = () => {
      while (env.weatherQueue.length < 5) {
        env.weatherQueue.push({ type: targetWeather, durationFrames: 10000 });
      }
    };
    env.refillWeatherQueue();

    const colony = new ColonyManager(200);
    colony.ants = [];

    // Count initial water cells (should be 0)
    let initialWater = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Water') initialWater++;
      }
    }
    expect(initialWater).toBe(0);

    // Progress offline by 300 seconds (5 minutes of rainy weather)
    const snapRain = makeSnap(grid, colony, env);
    const { result: resultRain, updatedSnap: snapAfterRain } = runCalcs(grid, snapRain, 300);
    expect(resultRain).toBeDefined();

    // Restore grid from updated snap so grid reflects CA physics
    // (runOfflineCalculations serialises updated gridStr into updatedSnap)
    // The grid object was mutated in-place by CA, so we can check it directly:
    let rainyWater = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Water') rainyWater++;
      }
    }
    expect(rainyWater).toBeGreaterThan(0);

    // Switch weather to Sunny
    targetWeather = 'Sunny';
    const snapSun: GameSnapshot = {
      ...snapAfterRain,
      weatherState: {
        weather: 'Sunny',
        weatherTimer: 0,
        weatherTargetDuration: 10000,
        weatherQueue: Array(5).fill(null).map(() => ({ type: 'Sunny' as const, durationFrames: 10000 })),
      },
    };

    // Progress offline by 600 seconds of sunny weather
    const { result: resultSun } = runCalcs(grid, snapSun, 600);
    expect(resultSun).toBeDefined();

    // Verify some water evaporated
    let sunnyWater = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Water') sunnyWater++;
      }
    }
    expect(sunnyWater).toBeLessThan(rainyWater);
  });

  it('should decay food in flooded larders and log warnings', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    const env = new Environment();
    env.weather = 'Rainy';
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;
    env.weatherQueue = [];

    // Force weather queue to only have Rainy
    env.refillWeatherQueue = () => {
      while (env.weatherQueue.length < 5) {
        env.weatherQueue.push({ type: 'Rainy', durationFrames: 10000 });
      }
    };
    env.refillWeatherQueue();

    // Add some food cells in the default starting larder box
    const larder = colony.getLarderBoxes(grid)[0];
    const fc = larder.minCol + 1;
    const fr = larder.maxRow;
    grid.setCellType(fc, fr, 'Food');
    grid.cells[fc][fr].foodAmount = 25;
    grid.cells[fc][fr].foodType = 'Apple';
    grid.cells[fc][fr].isMoldy = false;

    // Block the left side of the larder box so water doesn't escape laterally
    for (let r = larder.minRow; r <= larder.maxRow; r++) {
      grid.setCellType(larder.minCol - 1, r, 'Rock');
    }

    // Block the bottom of the larder box so water doesn't escape downward or diagonally
    for (let c = 150; c <= 250; c++) {
      grid.setCellType(c, larder.maxRow + 1, 'Rock');
    }

    // Flood the larder box by putting a water cell inside it
    grid.setCellType(larder.minCol, larder.minRow, 'Water');

    expect(grid.cells[fc][fr].isMoldy).toBe(false);

    // Run offline calculations for 60 seconds
    const snap = makeSnap(grid, colony, env);
    const { result } = runCalcs(grid, snap, 60);

    // Expect the food to have become moldy and decayed
    expect(grid.cells[fc][fr].isMoldy).toBe(true);
    expect(grid.cells[fc][fr].foodAmount).toBeLessThan(25);
    expect(result.foodDecayed).toBeGreaterThan(0);
    expect(result.threatLogs.some((log: string) => log.includes('mold') || log.includes('decay'))).toBe(true);
  });

  it('should simulate mite invasions causing brood losses when soldiers are absent', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    const env = new Environment();
    env.weather = 'Sunny';
    env.weatherQueue = Array(5).fill(null).map(() => ({ type: 'Sunny' as const, durationFrames: 10000 }));

    // Put some eggs in the brood list
    colony.broodManager.seedBrood([
      { id: 'b1', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
      { id: 'b2', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
      { id: 'b3', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
    ]);
    colony.ants = []; // no soldiers

    const snap = makeSnap(grid, colony, env);
    expect(snap.broodList).toHaveLength(3);

    const originalRandom = Math.random;
    let updatedSnap: GameSnapshot;
    try {
      // Force random to trigger mite invasions (random < 0.10)
      Math.random = () => 0.05;

      const r = runCalcs(grid, snap, 36000);
      updatedSnap = r.updatedSnap;
      expect(r.result.broodLosses).toBeGreaterThan(0);
      expect(updatedSnap.broodList.length).toBeLessThan(3);
      expect(r.result.threatLogs.some((log: string) => log.includes('Mites'))).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should simulate rain cave-ins and clearing of cave-ins by diggers', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    const env = new Environment();
    env.weather = 'Rainy';
    env.weatherQueue = Array(5).fill(null).map(() => ({ type: 'Rainy' as const, durationFrames: 10000 }));

    // Create a NestAir tunnel cell in the nest area
    const col = 200;
    const row = 100;
    grid.setCellType(col, row, 'NestAir');

    // Give colony 2 diggers
    colony.ants = [
      { id: 'd1', role: 'Digger', age: 10, maxAge: 500, health: 100, submergedTime: 0 } as any,
      { id: 'd2', role: 'Digger', age: 10, maxAge: 500, health: 100, submergedTime: 0 } as any,
    ];

    const originalRandom = Math.random;
    try {
      // Make all cells in the cave-in area NestAir so we are sure to get cave-ins
      for (let c = 150; c <= 250; c++) {
        for (let r = 80; r <= 250; r++) {
          grid.setCellType(c, r, 'NestAir');
        }
      }

      const snap = makeSnap(grid, colony, env);

      Math.random = () => 0.05;
      const { result } = runCalcs(grid, snap, 1000);

      // Should have caved-in cells, and diggers cleared them
      expect(result.dirtCleared).toBeGreaterThan(0);
      expect(result.threatLogs.some((log: string) => log.includes('cleared'))).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should track maxGenerationReached when new ants hatch', () => {
    const colony = new ColonyManager(200);
    expect(colony.maxGenerationReached).toBe(1);

    // Force hatch an ant
    (colony as any).hatchAnt(colony.queen.x, colony.queen.y);
    expect(colony.maxGenerationReached).toBe(2);

    // Reset should set it back to 1
    colony.reset(200);
    expect(colony.maxGenerationReached).toBe(1);
  });

  it('should run CA water updates (trickling) even during sunny weather offline', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    const env = new Environment();
    env.weather = 'Sunny';
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;
    env.weatherQueue = Array(5).fill(null).map(() => ({ type: 'Sunny' as const, durationFrames: 10000 }));

    // Place water cell high up in the nest link/air
    const col = 200;
    const row = 100;
    grid.setCellType(col, row, 'Water');
    grid.setCellType(col, row + 1, 'NestAir');

    const originalRandom = Math.random;
    try {
      Math.random = () => 0.1;

      const snap = makeSnap(grid, colony, env);
      runCalcs(grid, snap, 30);

      // Expect water cell to have trickled down from row 100
      const cellAbove = grid.getCell(col, row);
      expect(cellAbove?.type).not.toBe('Water');

      let foundWaterBelow = false;
      for (let c = 0; c < grid.cols; c++) {
        for (let r = row + 1; r < grid.rows; r++) {
          if (grid.getCell(c, r)?.type === 'Water') {
            foundWaterBelow = true;
            break;
          }
        }
        if (foundWaterBelow) break;
      }
      expect(foundWaterBelow).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should log Queen death by predator attack and preserve deathReason', () => {
    const colony = new ColonyManager(200);
    const grid = new WorldGrid();
    const threat = new Threat('t1', 'Spider', colony.queen.x, colony.queen.y);

    let logAdded = false;
    let logCategory = '';
    const mockAddLog = (msg: string, cat: string) => {
      logAdded = true;
      logCategory = cat;
      colony.addLog(msg, cat as any);
    };

    while (!colony.queen.isDead) {
      (threat as any).attackTarget(colony.queen, [], 1, mockAddLog);
    }

    expect(colony.queen.isDead).toBe(true);
    expect(colony.queen.deathReason).toBe('predator attack');
    expect(logAdded).toBe(true);
    expect(logCategory).toBe('deaths');

    colony.update(1, grid);
    expect(colony.queen.deathReason).toBe('predator attack');
  });
});
