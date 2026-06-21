import { CONFIG } from './types';
import { WorldGrid } from './Grid';

export interface LocomotionEntity {
  x: number;
  y: number;
  angle: number;
  collisionCooldown: number;
  collisionTimer: number;
  collisions: number;
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function steerTowardsAngle(entity: LocomotionEntity, target: number, rate: number) {
  let diff = target - entity.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  entity.angle += diff * rate;
  entity.angle = normalizeAngle(entity.angle);
}

export function steerTowardsTargetNest(
  entity: LocomotionEntity,
  grid: WorldGrid,
  targetX: number,
  targetY: number
): number {
  const CELL_SIZE = CONFIG.CELL_SIZE;
  const curCol = Math.floor(entity.x / CELL_SIZE);
  const curRow = Math.floor(entity.y / CELL_SIZE);
  const targetCol = Math.floor(targetX / CELL_SIZE);
  const targetRow = Math.floor(targetY / CELL_SIZE);
  const skyRow = CONFIG.SKY_HEIGHT;

  const shaftColStart = grid.nestEntranceCol - 2;
  const shaftColEnd = grid.nestEntranceCol + 1;
  const shaftMidX = (grid.nestEntranceCol * CELL_SIZE) + (CELL_SIZE / 2);

  // If both the ant and the target are above the surface, steer directly
  if (curRow < skyRow && targetRow < skyRow) {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    return Math.atan2(dy, dx);
  }

  // If the ant is on the surface (above the nest) and the target is underground:
  // It must first go to the nest entrance (shaft top)
  if (curRow < skyRow && targetRow >= skyRow) {
    const entranceX = grid.nestEntranceCol * CELL_SIZE;
    const entranceY = skyRow * CELL_SIZE;
    const dx = entranceX - entity.x;
    if (Math.abs(dx) < CELL_SIZE * 3.0) {
      return Math.PI / 2; // Go straight down into the shaft
    } else {
      const dy = entranceY - entity.y;
      return Math.atan2(dy, dx);
    }
  }

  // If the ant is underground and the target is on the surface:
  // It must first climb up the shaft to the surface
  if (curRow >= skyRow && targetRow < skyRow) {
    // If we are in the shaft, go straight up
    if (curCol >= shaftColStart && curCol <= shaftColEnd) {
      return -Math.PI / 2; // Go straight up
    } else {
      // We are in a side chamber, walk horizontally towards the shaft
      const dx = shaftMidX - entity.x;
      return Math.atan2(0, dx); // steer purely horizontally (dy = 0) to avoid getting stuck on chamber ceilings/floors
    }
  }

  // Both ant and target are underground (row >= skyRow)
  const inShaft = curCol >= shaftColStart && curCol <= shaftColEnd;

  if (inShaft) {
    // If we are in the shaft:
    // If we need to go to a different height, move vertically
    if (Math.abs(curRow - targetRow) > 2) {
      const dy = targetY - entity.y;
      return Math.atan2(dy, 0); // Move vertically (dx = 0) within the shaft
    } else {
      // We are at the correct height, steer towards target
      const dx = targetX - entity.x;
      const dy = targetY - entity.y;
      return Math.atan2(dy, dx);
    }
  } else {
    // We are in a side chamber (left or right)
    // Check if target is on the same side AND at roughly the same height
    const sameSide = (curCol < shaftColStart && targetCol < shaftColStart) ||
                     (curCol > shaftColEnd && targetCol > shaftColEnd);
    
    if (sameSide && Math.abs(curRow - targetRow) <= 4) {
      // Direct steering
      const dx = targetX - entity.x;
      const dy = targetY - entity.y;
      return Math.atan2(dy, dx);
    } else {
      // Target is on the other side, or at a different height.
      // We must walk horizontally to the shaft first.
      const dx = shaftMidX - entity.x;
      // Keep dy small or zero to walk straight horizontally into the shaft
      return Math.atan2(0, dx);
    }
  }
}

export function moveAndAvoidObstacles(
  entity: LocomotionEntity,
  grid: WorldGrid,
  speed: number
) {
  const snapCol = Math.floor(entity.x / CONFIG.CELL_SIZE);
  const snapRow = Math.floor(entity.y / CONFIG.CELL_SIZE);

  // 1. Gravity on the surface (Only for cells that are Sky or Food)
  if (grid.isValid(snapCol, snapRow)) {
    const currentCell = grid.getCell(snapCol, snapRow);
    if (currentCell && (currentCell.type === 'Sky' || currentCell.type === 'Food')) {
      // Check for solid support in a 5x2 region (horizontal range of 2 cells, vertical range from currentRow to currentRow + 1)
      let hasSupport = false;
      for (let dc = -2; dc <= 2; dc++) {
        for (let dr = 0; dr <= 1; dr++) {
          if (grid.isValid(snapCol + dc, snapRow + dr)) {
            if (!grid.isWalkable(snapCol + dc, snapRow + dr)) {
              hasSupport = true;
              break;
            }
          }
        }
        if (hasSupport) break;
      }

      // Only apply gravity if the ant has no physical support nearby (i.e. not climbing a wall, slope, or standing on a block)
      if (!hasSupport) {
        // Fall down due to gravity (velocity scales with game speed)
        entity.y += 1.5 * (speed / CONFIG.ANT_SPEED);
      }
    }
  }

  // 2. Escape hatch: If trapped inside a solid tile, find the nearest walkable tile in a 5-cell radius and snap to it.
  if (!grid.isWalkable(snapCol, snapRow)) {
    let found = false;
    for (let r = 1; r <= 5 && !found; r++) {
      const searchOffsets = [
        [0, -r], [0, r], [-r, 0], [r, 0],
        [-r, -r], [-r, r], [r, -r], [r, r],
        [-r, -Math.floor(r/2)], [-r, Math.floor(r/2)],
        [r, -Math.floor(r/2)], [r, Math.floor(r/2)],
        [-Math.floor(r/2), -r], [Math.floor(r/2), -r],
        [-Math.floor(r/2), r], [Math.floor(r/2), r]
      ];
      for (const [dc, dr] of searchOffsets) {
        const tc = snapCol + dc;
        const tr = snapRow + dr;
        if (grid.isWalkable(tc, tr)) {
          // Snap to center of walkable cell to clear solid boundary
          entity.x = tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
          entity.y = tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      // Fallback: teleport to nest entrance
      entity.x = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      entity.y = (CONFIG.SKY_HEIGHT - 1) * CONFIG.CELL_SIZE;
    }
  }

  // Wander slightly to look alive (only when not in collision cooldown)
  if (entity.collisionCooldown <= 0) {
    entity.angle += (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;
  }

  let nextX = entity.x + Math.cos(entity.angle) * speed;
  let nextY = entity.y + Math.sin(entity.angle) * speed;

  const cushion = 1.5;
  const lookAheadX = nextX + Math.cos(entity.angle) * cushion;
  const lookAheadY = nextY + Math.sin(entity.angle) * cushion;
  const nextCol = Math.floor(lookAheadX / CONFIG.CELL_SIZE);
  const nextRow = Math.floor(lookAheadY / CONFIG.CELL_SIZE);

  if (grid.isWalkable(nextCol, nextRow)) {
    entity.x = nextX;
    entity.y = nextY;
  } else {
    // Collision detected! Try sliding horizontally or vertically.
    const canSlideHorizontal = grid.isWalkable(nextCol, snapRow);
    const canSlideVertical = grid.isWalkable(snapCol, nextRow);

    const slideHorizontal = () => {
      const slideDir = Math.cos(entity.angle) >= 0 ? 1 : -1;
      entity.x += slideDir * speed;
      const targetAngle = slideDir === 1 ? 0 : Math.PI;
      steerTowardsAngle(entity, targetAngle, 0.2);
      entity.collisionCooldown = 6;
      entity.collisions++;
      entity.collisionTimer = 20;
    };

    const slideVertical = () => {
      let slideDir = Math.sin(entity.angle) > 0 ? 1 : -1;
      if (Math.abs(Math.sin(entity.angle)) < 0.1) {
        if (snapRow < CONFIG.SKY_HEIGHT + 5) {
          slideDir = -1; // climb up
        } else {
          slideDir = Math.random() < 0.5 ? 1 : -1;
        }
      }
      entity.y += slideDir * speed;
      const targetAngle = slideDir === 1 ? Math.PI / 2 : -Math.PI / 2;
      steerTowardsAngle(entity, targetAngle, 0.2);
      entity.collisionCooldown = 6;
      entity.collisions++;
      entity.collisionTimer = 20;
    };

    if (canSlideHorizontal && !canSlideVertical) {
      slideHorizontal();
    } else if (canSlideVertical && !canSlideHorizontal) {
      slideVertical();
    } else if (canSlideHorizontal && canSlideVertical) {
      // Diagonal corner! Pick the major axis of movement to slide along
      if (Math.abs(Math.cos(entity.angle)) > Math.abs(Math.sin(entity.angle))) {
        slideHorizontal();
      } else {
        slideVertical();
      }
    } else {
      // Complete block! Both directions blocked (corner or head-on collision)
      // Find a walkable direction by scanning alternative angles
      let foundWalkable = false;
      const angleScans = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI];

      for (const da of angleScans) {
        const scanAngle = entity.angle + da;
        const checkX = entity.x + Math.cos(scanAngle) * CONFIG.CELL_SIZE;
        const checkY = entity.y + Math.sin(scanAngle) * CONFIG.CELL_SIZE;
        const checkCol = Math.floor(checkX / CONFIG.CELL_SIZE);
        const checkRow = Math.floor(checkY / CONFIG.CELL_SIZE);

        if (grid.isWalkable(checkCol, checkRow)) {
          entity.angle = scanAngle;
          // Move forward by speed
          entity.x += Math.cos(scanAngle) * speed;
          entity.y += Math.sin(scanAngle) * speed;
          entity.collisionCooldown = 12; // 12 updates cooldown
          foundWalkable = true;
          entity.collisions++;
          entity.collisionTimer = 20;
          break;
        }
      }

      if (!foundWalkable) {
        // Complete turnaround
        entity.angle += Math.PI;
        entity.collisionCooldown = 15;
        entity.collisions++;
        entity.collisionTimer = 20;
      }
    }
  }

  // Hard boundary clamping and bounce
  const maxX = grid.cols * CONFIG.CELL_SIZE - 4;
  const maxY = grid.rows * CONFIG.CELL_SIZE - 4;

  if (entity.x <= 4) {
    entity.x = 4;
    entity.angle = Math.PI - entity.angle; // Bounce horizontally
    entity.collisions++;
    entity.collisionTimer = 20;
  } else if (entity.x >= maxX) {
    entity.x = maxX;
    entity.angle = Math.PI - entity.angle; // Bounce horizontally
    entity.collisions++;
    entity.collisionTimer = 20;
  }

  if (entity.y <= 4) {
    entity.y = 4;
    entity.angle = -entity.angle; // Bounce vertically
    entity.collisions++;
    entity.collisionTimer = 20;
  } else if (entity.y >= maxY) {
    entity.y = maxY;
    entity.angle = -entity.angle; // Bounce vertically
    entity.collisions++;
    entity.collisionTimer = 20;
  }

  entity.angle = normalizeAngle(entity.angle);
}
