import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineProgression } from './OfflineProgression';
import { WorldGrid } from './Grid';

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

describe('OfflineProgression', () => {
  let mockEngine: any;

  beforeEach(() => {
    localStorageMock.clear();
    
    // Create a minimal mock for SimulationEngine
    const mockGrid = new WorldGrid();
    
    const mockAnts = [
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
        brain: {},
        generation: 1,
        collisions: 0,
        deliveries: 0,
        age: 10,
        maxAge: 500,
      },
    ];

    const mockQueen = {
      x: 100,
      y: 200,
      energy: 100,
      eggTimer: 10,
      restTimer: 0,
    };

    mockEngine = {
      grid: mockGrid,
      totalDirtDugGlobal: 10,
      colony: {
        foodStockpile: 100,
        excavationPlan: [],
        queen: mockQueen,
        broodList: [],
        ants: mockAnts,
        nextAntNum: 2,
        logs: [],
        addLog: (text: string, category: string) => {
          mockEngine.colony.logs.push({ text, category, timestamp: Date.now() });
        },
        generateProceduralNestPlan: () => [],
      },
      telemetryTracker: {
        getHistory: () => [],
        setHistory: () => {},
      },
      environment: {
        dayCount: 1,
        hour: 8,
        minute: 0,
        minuteFraction: 0,
        weather: 'Sunny',
        weatherTimer: 0,
        weatherTargetDuration: 9000,
        weatherQueue: [],
        refillWeatherQueue: () => {},
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
