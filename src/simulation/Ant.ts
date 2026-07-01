import { CONFIG } from './types';
import type { AntRole, AntState, AntContext, RoleBehavior, Position, ExcavationStep, AntBrain, FoodType, Brood } from './types';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { findPath } from './Pathfinder';
import { moveAndAvoidObstacles, normalizeAngle } from './Locomotion';
import type { LocomotionEntity } from './Locomotion';
import { BroodManager } from './BroodManager';
import { Threat } from './Threat';
import { ForagerBehavior } from './behaviors/ForagerBehavior';
import { DiggerBehavior } from './behaviors/DiggerBehavior';
import { NurseBehavior } from './behaviors/NurseBehavior';
import { SoldierBehavior } from './behaviors/SoldierBehavior';

export function createDefaultBrain(): AntBrain {
  return {
    weights: [
      Math.random() * 0.2 - 0.1, // left pheromone
      Math.random() * 0.2 - 0.1, // center pheromone
      Math.random() * 0.2 - 0.1, // right pheromone
      0.8 + (Math.random() * 0.2 - 0.1), // target angle error (positive bias)
      Math.random() * 0.2 - 0.1, // stuck indicator
    ],
    bias: Math.random() * 0.1 - 0.05,
  };
}

// Singleton behavior instances (stateless strategy objects)
const ROLE_BEHAVIORS: Record<AntRole, RoleBehavior> = {
  Forager: new ForagerBehavior(),
  Digger: new DiggerBehavior(),
  Nurse: new NurseBehavior(),
  Soldier: new SoldierBehavior(),
};

export class Ant implements LocomotionEntity, AntContext {
  public id: string;
  public x: number;
  public y: number;
  public angle: number;
  public role: AntRole;
  public state: AntState;

  public cargo: 'None' | 'Food' | 'Dirt' = 'None';
  public cargoFoodType: FoodType | undefined = undefined;
  public energy: number = CONFIG.ANT_MAX_ENERGY;
  public homeChamberX: number;
  public homeChamberY: number;

  // Visual leg animation state
  public legCycle: number = 0;

  // Nursing targets
  public targetBroodId: string | null = null;
  public isHoldingBrood: boolean = false;

  public collisionCooldown: number = 0;
  public collisionTimer: number = 0;
  public diggingChamberTimer: number = 0;
  public diggingAngle: number = Math.PI / 2;
  public targetDropOffset: number | undefined = undefined;

  public num: number;

  // Neural network and learning parameters
  public brain: AntBrain;
  public generation: number;
  public collisions: number = 0;
  public deliveries: number = 0;

  // Age and lifecycle
  public age: number = 0;
  public maxAge: number;
  public submergedTime: number = 0;
  public health: number = 100;

  // Steering targets resolved by state machines
  public desiredAngle: number;
  public desiredPheromone: 'food' | 'home' | 'danger' | 'none' = 'none';

  // Pathfinding
  public currentPath: Position[] | null = null;
  public pathTarget: Position | null = null;
  public patrolTarget: Position | null = null;
  public targetThreatId: string | null = null;

  constructor(
    id: string,
    startX: number,
    startY: number,
    role: AntRole,
    num: number,
    brain?: AntBrain,
    generation: number = 1
  ) {
    this.id = id;
    this.x = startX;
    this.y = startY;
    this.angle = Math.random() * Math.PI * 2;
    this.role = role;
    this.state = 'Wandering';
    this.num = num;

    this.homeChamberX = startX;
    this.homeChamberY = startY;

    this.brain = brain || createDefaultBrain();
    this.generation = generation;
    this.desiredAngle = this.angle;

    this.age = 0;
    this.maxAge = 1200 + Math.random() * 600; // 20 to 30 minutes of life at 1x speed
  }

  // --- AntContext interface implementation ---

  get hasCargo(): boolean {
    return this.cargo !== 'None';
  }

  public addDelivery(): void {
    this.deliveries++;
  }

  public getAngleToTarget(grid: WorldGrid, targetX: number, targetY: number): number {
    const CELL_SIZE = CONFIG.CELL_SIZE;
    const curCol = Math.floor(this.x / CELL_SIZE);
    const curRow = Math.floor(this.y / CELL_SIZE);
    const targetCol = Math.floor(targetX / CELL_SIZE);
    const targetRow = Math.floor(targetY / CELL_SIZE);

    // If target changed, or no path, recalculate
    if (!this.currentPath || !this.pathTarget || this.pathTarget.x !== targetCol || this.pathTarget.y !== targetRow) {
      this.currentPath = findPath(grid, curCol, curRow, targetCol, targetRow) || [];
      this.pathTarget = { x: targetCol, y: targetRow };
    }

    if (this.currentPath && this.currentPath.length > 0) {
      // Steer towards next waypoint
      const nextWP = this.currentPath[0];
      const dx = nextWP.x - this.x;
      const dy = nextWP.y - this.y;

      const curCol = Math.floor(this.x / CELL_SIZE);
      const curRow = Math.floor(this.y / CELL_SIZE);
      const wpCol = Math.floor(nextWP.x / CELL_SIZE);
      const wpRow = Math.floor(nextWP.y / CELL_SIZE);

      // Pop the waypoint if we've entered its cell, or if we're extremely close
      if ((curCol === wpCol && curRow === wpRow) || (dx * dx + dy * dy < CELL_SIZE * CELL_SIZE)) {
        this.currentPath.shift();
        if (this.currentPath.length > 0) {
          const nextNext = this.currentPath[0];
          return Math.atan2(nextNext.y - this.y, nextNext.x - this.x);
        }
      }
      return Math.atan2(dy, dx);
    }

    // Fallback if no path found (should be rare)
    return Math.atan2(targetY - this.y, targetX - this.x);
  }

  // --- End AntContext interface ---

  public getFitness(): number {
    let weight = 10;
    if (this.role === 'Digger') weight = 5;
    else if (this.role === 'Nurse') weight = 8;
    return Math.max(0.1, this.deliveries * weight - this.collisions * 0.02);
  }

  public update(
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    stockpile: { food: number },
    broodList: readonly Brood[],
    queenPos: Position & { energy?: number },
    activeExcavationStep: ExcavationStep | null,
    activeExcavationTarget: Position | null,
    nurseries: Position[],
    foodStorages: Position[],
    broodManager: BroodManager,
    speedMultiplier: number,
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void,
    threats: Threat[] = []
  ) {
    const col = Math.floor(this.x / CONFIG.CELL_SIZE);
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);
    const cell = grid.getCell(col, row);
    const isSubmerged = cell && cell.type === 'Water';

    let speed = CONFIG.ANT_SPEED * speedMultiplier;
    if (isSubmerged) {
      speed *= 0.4;
    }

    this.legCycle += 0.25 * speedMultiplier;

    // Energy slowly depletes. The world is deep, so they need enough energy to make the long walk home!
    this.energy -= 0.002 * speedMultiplier;

    // Submerged drowning logic
    if (isSubmerged) {
      this.submergedTime += (1 / 60) * speedMultiplier;
      if (this.submergedTime > 5.0) {
        this.health -= 2 * speedMultiplier;
      }
      if (spawnDebris && Math.random() < 0.05 * speedMultiplier) {
        spawnDebris(this.x, this.y, 'rgba(156, 180, 215, 0.65)', 1);
      }
    } else {
      this.submergedTime = 0;
      this.health = Math.min(100, this.health + 0.5 * speedMultiplier);
    }
    if (this.energy < 25 && this.state !== 'Resting') {
      this.state = 'Resting'; // go home and eat
    }

    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= speedMultiplier;
    }
    if (this.collisionTimer > 0) {
      this.collisionTimer -= speedMultiplier;
      if (this.collisionTimer > 10) {
        this.currentPath = null; // force recalculate path if stuck
      }
    }

    // Reset steering targets at start of frame
    this.desiredAngle = this.angle;
    this.desiredPheromone = 'none';

    // Flee from nearby threats for non-soldiers
    let isFleeing = false;
    if (this.role !== 'Soldier' && this.state !== 'Resting') {
      let closestThreat: Threat | null = null;
      let minThreatDist = Infinity;
      for (const threat of threats) {
        if (!threat.isDead) {
          const dist = Math.sqrt((threat.x - this.x) ** 2 + (threat.y - this.y) ** 2);
          if (dist < minThreatDist) {
            minThreatDist = dist;
            closestThreat = threat;
          }
        }
      }

      if (minThreatDist < 60 && closestThreat) {
        isFleeing = true;
        this.desiredAngle = Math.atan2(this.y - closestThreat.y, this.x - closestThreat.x);
        this.desiredPheromone = 'none';
        this.currentPath = null; // disrupt pathfinding to flee
      }
    }

    // Role dispatch via behavior strategy pattern
    if (this.state === 'Resting') {
      this.updateResting(grid, stockpile, foodStorages, spawnDebris);
    } else if (!isFleeing) {
      ROLE_BEHAVIORS[this.role].update(
        this,
        grid,
        pheromones,
        stockpile,
        broodList,
        queenPos,
        activeExcavationStep,
        activeExcavationTarget,
        nurseries,
        foodStorages,
        broodManager,
        speedMultiplier,
        threats,
        spawnDebris
      );
    }

    // Clamp desiredAngle on the surface (outside the shaft zone) to horizontal boundaries (max slope of 35 degrees)
    const currentCol = Math.floor(this.x / CONFIG.CELL_SIZE);
    const currentRow = Math.floor(this.y / CONFIG.CELL_SIZE);
    if (currentRow < CONFIG.SKY_HEIGHT && Math.abs(currentCol - grid.nestEntranceCol) > 4) {
      const cosVal = Math.cos(this.desiredAngle);
      const sinVal = Math.sin(this.desiredAngle);
      let ang = Math.atan2(sinVal, cosVal); // normalized to [-PI, PI]

      const maxSlope = 35 * (Math.PI / 180); // 35 degrees in rad (~0.61)
      if (cosVal >= 0) {
        ang = Math.max(-maxSlope, Math.min(maxSlope, ang));
      } else {
        if (ang >= 0) {
          ang = Math.max(Math.PI - maxSlope, ang);
        } else {
          ang = Math.min(-Math.PI + maxSlope, ang);
        }
      }
      this.desiredAngle = ang;
    }

    // Run neural network steering (only when not in collision cooldown)
    if (this.collisionCooldown <= 0) {
      this.steerWithNeuralNetwork(grid, pheromones, speedMultiplier);
    }

    // Apply movement based on current angle
    moveAndAvoidObstacles(this, grid, speed);
  }

  // --- RESTING / REFUELLING (shared logic — stays in Ant) ---
  private updateResting(
    grid: WorldGrid,
    stockpile: { food: number },
    foodStorages: Position[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);
    const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
    const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

    // Find the closest food storage chamber
    let closestStorage = foodStorages[0];
    let minDist = Infinity;
    for (const storage of foodStorages) {
      const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestStorage = storage;
      }
    }

    // If close enough to a food storage, eat and refuel
    if (minDist < 30) {
      if (stockpile.food >= 0.5) {
        stockpile.food -= 0.5;

        // Spawn eating animation/debris at the nearest food cell inside this larder
        if (spawnDebris) {
          const cellCol = Math.floor(this.x / CONFIG.CELL_SIZE);
          const cellRow = Math.floor(this.y / CONFIG.CELL_SIZE);
          let closestFoodCell: Position | null = null;
          let minFoodDist = Infinity;
          for (let dc = -8; dc <= 8; dc++) {
            for (let dr = -8; dr <= 8; dr++) {
              const tc = cellCol + dc;
              const tr = cellRow + dr;
              const cell = grid.getCell(tc, tr);
              if (cell && cell.type === 'Food') {
                const fx = tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
                const fy = tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
                const dSq = (this.x - fx) ** 2 + (this.y - fy) ** 2;
                if (dSq < minFoodDist) {
                  minFoodDist = dSq;
                  closestFoodCell = { x: fx, y: fy };
                }
              }
            }
          }
          if (closestFoodCell) {
            const cCol = Math.floor(closestFoodCell.x / CONFIG.CELL_SIZE);
            const cRow = Math.floor(closestFoodCell.y / CONFIG.CELL_SIZE);
            const cell = grid.getCell(cCol, cRow);
            let color = 'hsl(0, 80%, 48%)';
            if (cell?.foodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
            else if (cell?.foodType === 'Carcass') color = 'hsl(280, 60%, 40%)';

            spawnDebris(closestFoodCell.x, closestFoodCell.y, color, 3);
          }
        }

        this.energy = CONFIG.ANT_MAX_ENERGY;
        this.state = this.role === 'Forager' ? 'SearchingForFood' : (this.role === 'Nurse' ? 'Wandering' : 'DiggingTunnel');
        this.angle += Math.PI; // turn around
        this.collisionCooldown = 0;
        return;
      }
    }

    // Go back to the nest
    if (row < CONFIG.SKY_HEIGHT) {
      // On surface: head to entrance
      this.desiredAngle = this.getAngleToTarget(grid, entranceX, entranceY);
      this.desiredPheromone = 'none';
    } else {
      // Underground: head to closest food storage
      this.desiredAngle = this.getAngleToTarget(grid, closestStorage.x, closestStorage.y);
      this.desiredPheromone = 'home';
    }
  }

  // --- STEERING AI ---
  private steerWithNeuralNetwork(_grid: WorldGrid, pheromones: PheromoneGrid, speedMultiplier: number) {
    const sensorAngle = CONFIG.ANT_SENSOR_ANGLE;
    const sensorDist = CONFIG.ANT_SENSOR_DIST;

    // Calculate sensor positions
    const leftX = this.x + Math.cos(this.angle - sensorAngle) * sensorDist;
    const leftY = this.y + Math.sin(this.angle - sensorAngle) * sensorDist;
    const centerX = this.x + Math.cos(this.angle) * sensorDist;
    const centerY = this.y + Math.sin(this.angle) * sensorDist;
    const rightX = this.x + Math.cos(this.angle + sensorAngle) * sensorDist;
    const rightY = this.y + Math.sin(this.angle + sensorAngle) * sensorDist;

    // Convert to grid cols/rows
    const lCol = Math.floor(leftX / CONFIG.CELL_SIZE);
    const lRow = Math.floor(leftY / CONFIG.CELL_SIZE);
    const cCol = Math.floor(centerX / CONFIG.CELL_SIZE);
    const cRow = Math.floor(centerY / CONFIG.CELL_SIZE);
    const rCol = Math.floor(rightX / CONFIG.CELL_SIZE);
    const rRow = Math.floor(rightY / CONFIG.CELL_SIZE);

    let leftVal = 0;
    let centerVal = 0;
    let rightVal = 0;

    if (this.desiredPheromone === 'food') {
      leftVal = pheromones.getFoodPheromone(lCol, lRow);
      centerVal = pheromones.getFoodPheromone(cCol, cRow);
      rightVal = pheromones.getFoodPheromone(rCol, rRow);
    } else if (this.desiredPheromone === 'home') {
      leftVal = pheromones.getHomePheromone(lCol, lRow);
      centerVal = pheromones.getHomePheromone(cCol, cRow);
      rightVal = pheromones.getHomePheromone(rCol, rRow);
    } else if (this.desiredPheromone === 'danger') {
      leftVal = pheromones.getDangerPheromone(lCol, lRow);
      centerVal = pheromones.getDangerPheromone(cCol, cRow);
      rightVal = pheromones.getDangerPheromone(rCol, rRow);
    }

    // Target angle error normalized to [-1, 1]
    let angleDiff = this.desiredAngle - this.angle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const targetAngleError = angleDiff / Math.PI;

    // Stuck indicator
    const stuckIndicator = this.collisionTimer > 0 ? 1.0 : -1.0;

    // Run feedforward
    const inputs = [
      leftVal,
      centerVal,
      rightVal,
      targetAngleError,
      stuckIndicator
    ];

    let sum = this.brain.bias;
    for (let i = 0; i < 5; i++) {
      sum += this.brain.weights[i] * inputs[i];
    }

    const output = Math.tanh(sum);

    // If following a strict A* path, bypass the neural network to avoid wide turns and wall crashes
    if (this.currentPath && this.currentPath.length > 0 && this.collisionCooldown <= 0) {
      this.angle = this.desiredAngle; // instant snap
    } else {
      // Steer using neural network by up to 0.15 radians
      this.angle += output * 0.15 * speedMultiplier;
    }
    this.angle = normalizeAngle(this.angle);
  }
}
