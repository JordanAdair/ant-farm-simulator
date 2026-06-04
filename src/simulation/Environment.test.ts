import { describe, it, expect } from 'vitest';
import { Environment } from './Environment';

describe('Environment', () => {
  it('should initialize with default clock and weather', () => {
    const env = new Environment();
    expect(env.dayCount).toBe(1);
    expect(env.hour).toBe(8);
    expect(env.minute).toBe(0);
    expect(env.weather).toBe('Sunny');
  });

  it('should advance time correctly on tick update', () => {
    const env = new Environment();
    
    // 30 updates = 1 game minute. Advance by 30 updates (speed = 1)
    env.update(30, null as any, { x: 0, y: 0, zoom: 1 }, 800, 600, 1);
    
    expect(env.minute).toBe(1);
    expect(env.minuteFraction).toBe(0);

    // Advance by 1800 updates (60 minutes = 1 game hour)
    env.update(1800, null as any, { x: 0, y: 0, zoom: 1 }, 800, 600, 1);
    expect(env.hour).toBe(9);
    expect(env.minute).toBe(1);
  });

  it('should transition weather correctly when queue expires', () => {
    const env = new Environment();
    env.weatherTargetDuration = 100;
    env.weatherTimer = 0;
    env.weatherQueue = [{ type: 'Rainy', durationFrames: 500 }];

    // Advance by 100 updates to trigger weather change
    env.update(100, null as any, { x: 0, y: 0, zoom: 1 }, 800, 600, 1);
    
    expect(env.weather).toBe('Rainy');
    expect(env.weatherTargetDuration).toBe(500);
    expect(env.weatherTimer).toBe(0);
  });

  it('should compute sky light and environmental factors correctly', () => {
    const env = new Environment();
    
    // At hour 12, sky light should be 1.0 (full day)
    env.hour = 12;
    expect(env.getSkyLight()).toBe(1.0);

    // At hour 0 (midnight), sky light should be 0.08 (night)
    env.hour = 0;
    expect(env.getSkyLight()).toBe(0.08);

    // Pressure should change with rain
    env.weather = 'Rainy';
    env.weatherTimer = 500;
    env.weatherTargetDuration = 1000;
    const rainyPressure = env.getPressure();

    env.weather = 'Sunny';
    env.weatherTimer = 0;
    const sunnyPressure = env.getPressure();
    
    expect(sunnyPressure).toBeGreaterThan(rainyPressure);
  });
});
