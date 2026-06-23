import { describe, it, expect } from 'vitest';
import { OfflineProgression } from './OfflineProgression';
import { WorldGrid } from './Grid';
import { ColonyManager } from './Colony';
import { Environment } from './Environment';

describe('Offline Progression Physics & Threats', () => {
  it('should spawn surface water cells during rainy weather offline and evaporate them in sunny weather', () => {
    // Create a mock engine
    const grid = new WorldGrid();
    const env = new Environment();
    env.weather = 'Rainy';
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;
    env.weatherQueue = [];

    let targetWeather: 'Sunny' | 'Rainy' = 'Rainy';
    env.refillWeatherQueue = () => {
      while (env.weatherQueue.length < 5) {
        env.weatherQueue.push({
          type: targetWeather,
          durationFrames: 10000,
        });
      }
    };

    const colony = new ColonyManager(200);
    colony.ants = []; // no ants

    const mockEngine = {
      grid,
      colony,
      environment: env,
      totalDirtDugGlobal: 0,
      telemetryTracker: { getHistory: () => [], setHistory: () => {} },
      initializeFoliage: () => {},
    } as any;

    // Count initial water cells (should be 0)
    let initialWater = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Water') initialWater++;
      }
    }
    expect(initialWater).toBe(0);

    // Progress offline by 300 seconds (5 minutes of rainy weather)
    const resultRain = (OfflineProgression as any).runOfflineCalculations(mockEngine, 300);
    expect(resultRain).toBeDefined();

    // Check that we have water cells now
    let rainyWater = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Water') rainyWater++;
      }
    }
    expect(rainyWater).toBeGreaterThan(0);

    // Switch weather to Sunny
    targetWeather = 'Sunny';
    env.weatherQueue = [];
    env.weather = 'Sunny';
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;

    // Progress offline by 600 seconds of sunny weather
    const resultSun = (OfflineProgression as any).runOfflineCalculations(mockEngine, 600);
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
    env.weather = 'Rainy'; // keep weather Rainy so that the flooded larder does not evaporate water in step 2
    env.weatherTimer = 0;
    env.weatherTargetDuration = 10000;
    env.weatherQueue = [];

    // Force weather queue to only have Rainy to prevent transition during calculations
    env.refillWeatherQueue = () => {
      while (env.weatherQueue.length < 5) {
        env.weatherQueue.push({
          type: 'Rainy',
          durationFrames: 10000,
        });
      }
    };

    // Add some food cells in the default starting larder box
    const larder = colony.getLarderBoxes(grid)[0];
    const fc = larder.minCol + 1;
    const fr = larder.minRow + 1;
    grid.setCellType(fc, fr, 'Food');
    grid.cells[fc][fr].foodAmount = 25; // Increase to 25 so it does not decay to 0 within 60 seconds
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

    const mockEngine = {
      grid,
      colony,
      environment: env,
      totalDirtDugGlobal: 0,
      telemetryTracker: { getHistory: () => [], setHistory: () => {} },
      initializeFoliage: () => {},
    } as any;

    expect(grid.cells[fc][fr].isMoldy).toBe(false);

    // Run offline calculations for 60 seconds
    const result = (OfflineProgression as any).runOfflineCalculations(mockEngine, 60);

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

    // Put some eggs in the brood list
    colony.broodList = [
      { id: 'b1', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
      { id: 'b2', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
      { id: 'b3', type: 'Egg', x: 100, y: 100, progress: 0, needsFood: false, beingCarried: false },
    ];
    colony.ants = []; // no soldiers

    const mockEngine = {
      grid,
      colony,
      environment: env,
      totalDirtDugGlobal: 0,
      telemetryTracker: { getHistory: () => [], setHistory: () => {} },
      initializeFoliage: () => {},
    } as any;

    // Run calculations for a long offline period (e.g. 10 hours = 36000 seconds, which gives 60 in-game hours)
    // There is a 10% chance of mite invasion every 12 in-game hours.
    // In 60 hours, we check 5 times. Mite invasions should trigger with high probability.
    // If not, we will repeat checks. Let's force Math.random() behavior or run it.
    const originalRandom = Math.random;
    try {
      // Force random to trigger mite invasions (random < 0.10)
      Math.random = () => 0.05;

      const result = (OfflineProgression as any).runOfflineCalculations(mockEngine, 36000);
      expect(result.broodLosses).toBeGreaterThan(0);
      expect(colony.broodList.length).toBeLessThan(3);
      expect(result.threatLogs.some((log: string) => log.includes('Mites'))).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should simulate rain cave-ins and clearing of cave-ins by diggers', () => {
    const grid = new WorldGrid();
    const colony = new ColonyManager(200);
    const env = new Environment();
    env.weather = 'Rainy';

    // Create a NestAir tunnel cell in the nest area
    const col = 200;
    const row = 100;
    grid.setCellType(col, row, 'NestAir');

    // Give colony 2 diggers
    colony.ants = [
      { id: 'd1', role: 'Digger', age: 10, maxAge: 500, health: 100, submergedTime: 0 } as any,
      { id: 'd2', role: 'Digger', age: 10, maxAge: 500, health: 100, submergedTime: 0 } as any,
    ];

    const mockEngine = {
      grid,
      colony,
      environment: env,
      totalDirtDugGlobal: 0,
      telemetryTracker: { getHistory: () => [], setHistory: () => {} },
      initializeFoliage: () => {},
    } as any;

    const originalRandom = Math.random;
    try {
      // Force random to make sure the cave-in chooses our specific tunnel cell
      // Since it picks random col/row in 150-250, 80-250:
      // We can intercept math.random or just make all cells in that box NestAir
      for (let c = 150; c <= 250; c++) {
        for (let r = 80; r <= 250; r++) {
          grid.setCellType(c, r, 'NestAir');
        }
      }

      // Force Math.random() to always clear or run
      Math.random = () => 0.05;

      // Progress offline by 1000 seconds
      const result = (OfflineProgression as any).runOfflineCalculations(mockEngine, 1000);
      
      // Should have caved-in cells, and diggers cleared them
      expect(result.dirtCleared).toBeGreaterThan(0);
      expect(result.threatLogs.some((log: string) => log.includes('cleared'))).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });
});
