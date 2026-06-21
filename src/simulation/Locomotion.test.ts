import { describe, it, expect } from 'vitest';
import { WorldGrid } from './Grid';
import { CONFIG } from './types';
import {
  normalizeAngle,
  steerTowardsAngle,
  steerTowardsTargetNest,
  moveAndAvoidObstacles,
  type LocomotionEntity
} from './Locomotion';

describe('Locomotion Physics & Steering', () => {
  it('should normalize angles correctly to [-PI, PI]', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
  });

  it('should steer towards an angle at a specified rate', () => {
    const entity: LocomotionEntity = {
      x: 0,
      y: 0,
      angle: 0,
      collisionCooldown: 0,
      collisionTimer: 0,
      collisions: 0
    };

    // Steer towards PI/2 (90 deg) with a rate of 0.5
    steerTowardsAngle(entity, Math.PI / 2, 0.5);
    expect(entity.angle).toBeCloseTo(Math.PI / 4);
  });

  it('should steer towards the nest entrance if the entity is on the surface and target is underground', () => {
    const grid = new WorldGrid();
    const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
    const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

    // Entity is far to the right of the entrance, on the surface (y = entranceY - 10)
    const entity: LocomotionEntity = {
      x: entranceX + 100,
      y: entranceY - 10,
      angle: 0,
      collisionCooldown: 0,
      collisionTimer: 0,
      collisions: 0
    };

    // Target is underground
    const targetX = entranceX;
    const targetY = entranceY + 100;

    const angle = steerTowardsTargetNest(entity, grid, targetX, targetY);
    // Angle should point towards the nest entrance
    const expectedAngle = Math.atan2(entranceY - entity.y, entranceX - entity.x);
    expect(angle).toBeCloseTo(expectedAngle);
  });

  it('should fall due to gravity when in sky/air and unsupported', () => {
    const grid = new WorldGrid();
    const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
    
    // Position entity in sky where it's walkable (Sky cell) and unsupported
    // Set collisionCooldown = 1 to prevent wander angle changes, and initial angle = 0 so y-velocity is purely gravity.
    const entity: LocomotionEntity = {
      x: entranceX,
      y: 10 * CONFIG.CELL_SIZE, // sky row
      angle: 0,
      collisionCooldown: 1,
      collisionTimer: 0,
      collisions: 0
    };

    const initialY = entity.y;
    // Speed = CONFIG.ANT_SPEED, so y should increase by 1.5
    moveAndAvoidObstacles(entity, grid, CONFIG.ANT_SPEED);
    expect(entity.y).toBeGreaterThan(initialY);
    expect(entity.y - initialY).toBeCloseTo(1.5);
  });
});
