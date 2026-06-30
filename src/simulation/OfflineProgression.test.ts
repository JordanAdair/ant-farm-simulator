import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineProgression } from './OfflineProgression';
import { WorldGrid } from './Grid';
import { CONFIG } from './types';
import type { GameSnapshot } from './types';
import { generateProceduralNestPlan } from './NestPlanner';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

/** Build a minimal GameSnapshot for testing. */
function makeTestSnapshot(grid: WorldGrid): GameSnapshot {
  const entranceCol = grid.nestEntranceCol;
  return {
    version: 1,
    timestamp: Date.now(),
    gridStr: OfflineProgression.serializeGrid(grid),
    totalDirtDugGlobal: 10,
    maxPopulation: 8,
    maxGenerationReached: 1,
    excavationPlan: generateProceduralNestPlan(entranceCol),
    nextAntNum: 2,
    logs: [],
    queen: {
      x: entranceCol * CONFIG.CELL_SIZE,
      y: 114 * CONFIG.CELL_SIZE,
      energy: 100,
      eggTimer: 10,
      restTimer: 0,
      age: 0,
      maxAge: CONFIG.QUEEN_MAX_AGE,
      health: 100,
      submergedTime: 0,
      isDead: false,
    },
    broodList: [],
    ants: [
      {
        id: 'ant-1',
        x: 100,
        y: 200,
        angle: 0.5,
        role: 'Forager',
        state: 'SearchingForFood',
        energy: 100,
        cargo: 'None',
        num: 1,
        brain: { weights: [0, 0, 0, 0.8, 0], bias: 0 },
        generation: 1,
        collisions: 0,
        deliveries: 0,
        age: 10,
        maxAge: 500,
        health: 100,
        submergedTime: 0,
      },
    ],
    telemetryHistory: [],
    clock: { dayCount: 1, hour: 8, minute: 0, minuteFraction: 0 },
    weatherState: { weather: 'Sunny', weatherTimer: 0, weatherTargetDuration: 9000, weatherQueue: [] },
  };
}

describe('OfflineProgression', () => {
  let mockGrid: WorldGrid;
  let mockEngine: any;

  beforeEach(() => {
    localStorageMock.clear();
    mockGrid = new WorldGrid();

    // Mock engine that implements snapshot() and restore() using the test snapshot shape
    let storedSnap: GameSnapshot = makeTestSnapshot(mockGrid);
    mockEngine = {
      grid: mockGrid,
      snapshot(): GameSnapshot {
        return { ...storedSnap, gridStr: OfflineProgression.serializeGrid(this.grid) };
      },
      restore(s: GameSnapshot) {
        storedSnap = s;
      },
      initializeFoliage: () => {},
    };
  });

  it('should successfully save and load state', () => {
    OfflineProgression.saveState(mockEngine);
    const saveStr = localStorage.getItem('ant_farm_save_v3');
    expect(saveStr).not.toBeNull();

    // Verify it deserializes and loads
    const result = OfflineProgression.loadState(mockEngine);
    // Since elapsedSeconds is 0 (both saved and loaded in same instant), it should return null
    expect(result).toBeNull();
  });

  it('should compute offline progression when elapsed time is > 15 seconds', () => {
    OfflineProgression.saveState(mockEngine);

    // Manually backdate the timestamp in localStorage by 100 seconds
    const saveStr = localStorage.getItem('ant_farm_save_v3')!;
    const stateObj = JSON.parse(saveStr);
    stateObj.timestamp = Date.now() - 100 * 1000;
    localStorage.setItem('ant_farm_save_v3', JSON.stringify(stateObj));

    const result = OfflineProgression.loadState(mockEngine);
    expect(result).not.toBeNull();
    expect(result!.elapsedSeconds).toBe(100);
  });
});
