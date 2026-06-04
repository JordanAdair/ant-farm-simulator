import { describe, it, expect } from 'vitest';
import { TelemetryTracker } from './Telemetry';
import type { ColonyStats } from './types';
import { Ant, createDefaultBrain } from './Ant';

describe('TelemetryTracker', () => {
  it('should initialize with empty history by default', () => {
    const tracker = new TelemetryTracker();
    expect(tracker.getHistory()).toEqual([]);
  });

  it('should record telemetry points correctly and compute fitness stats', () => {
    const tracker = new TelemetryTracker();
    
    // Create mock colony stats
    const mockStats: ColonyStats = {
      workerCount: 3,
      foragerCount: 1,
      diggerCount: 1,
      nurseCount: 1,
      eggCount: 0,
      larvaCount: 0,
      pupaCount: 0,
      foodStockpile: 15,
      dirtDugCount: 0,
      nestVolume: 100,
      activeProject: 'Test Project',
      elapsedTime: 0,
    };

    // Create mock ants with known deliveries and collisions to verify fitness averaging
    const ant1 = new Ant('ant-1', 0, 0, 'Forager', 1, createDefaultBrain(), 1);
    ant1.deliveries = 5; // Forager fitness: 5 * 10 - 0 * 0.02 = 50
    ant1.collisions = 0;

    const ant2 = new Ant('ant-2', 0, 0, 'Digger', 2, createDefaultBrain(), 1);
    ant2.deliveries = 2; // Digger fitness: 2 * 5 - 100 * 0.02 = 10 - 2 = 8
    ant2.collisions = 100;

    const ants = [ant1, ant2];

    tracker.record(mockStats, ants, 42);

    const history = tracker.getHistory();
    expect(history.length).toBe(1);
    
    const point = history[0];
    expect(point.time).toBe(0);
    expect(point.totalAnts).toBe(3);
    expect(point.food).toBe(15);
    expect(point.volume).toBe(25); // Math.floor(100 * 0.25)
    expect(point.dirtDug).toBe(42);
    expect(point.maxFitness).toBe(50); // Forager
    expect(point.avgFitness).toBe(29); // (50 + 8) / 2
  });

  it('should cap history at 200 data points and trim old points', () => {
    const tracker = new TelemetryTracker();
    
    const mockStats: ColonyStats = {
      workerCount: 0, foragerCount: 0, diggerCount: 0, nurseCount: 0,
      eggCount: 0, larvaCount: 0, pupaCount: 0, foodStockpile: 0,
      dirtDugCount: 0, nestVolume: 0, activeProject: '', elapsedTime: 0,
    };

    // Push 205 records
    for (let i = 0; i < 205; i++) {
      tracker.record(mockStats, [], 0);
    }

    const history = tracker.getHistory();
    expect(history.length).toBe(200);
    // The first point in history should represent the 6th record (since 5 old ones were shifted out)
    expect(history[0].time).toBe(5 * 3); // 5 * 3 seconds = 15 seconds elapsed
    expect(history[199].time).toBe(204 * 3); // 204 * 3 seconds = 612 seconds
  });
});
