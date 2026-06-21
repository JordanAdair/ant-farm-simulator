export type CellType = 'Sky' | 'Dirt' | 'Rock' | 'NestAir' | 'Food';

export type AntRole = 'Forager' | 'Digger' | 'Nurse';

export type AntState =
  | 'Wandering'
  | 'ReturningToNest'
  | 'SearchingForFood'
  | 'HarvestingFood'
  | 'DiggingTunnel'
  | 'Nursing'
  | 'Resting'
  | 'CarryingDirt';

export type BroodType = 'Egg' | 'Larva' | 'Pupa';

export interface LogEntry {
  text: string;
  category: 'system' | 'births' | 'deaths';
  timestamp: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface ColonyStats {
  workerCount: number;
  foragerCount: number;
  diggerCount: number;
  nurseCount: number;
  eggCount: number;
  larvaCount: number;
  pupaCount: number;
  foodStockpile: number;
  dirtDugCount: number;
  nestVolume: number;
  activeProject: string;
  elapsedTime: number; // in seconds
}

export interface Brood {
  id: string;
  type: BroodType;
  x: number;
  y: number;
  progress: number; // 0 to 100
  needsFood: boolean;
  beingCarried: boolean;
}

export interface AntBrain {
  weights: number[]; // [leftPheromone, centerPheromone, rightPheromone, targetAngleError, stuckIndicator]
  bias: number;
}

export interface TelemetryPoint {
  time: number;
  totalAnts: number;
  foragers: number;
  diggers: number;
  nurses: number;
  food: number;
  volume: number;
  dirtDug: number;
  eggCount: number;
  larvaCount: number;
  pupaCount: number;
  avgFitness: number;
  maxFitness: number;
}

// Global Configuration
export const CONFIG = {
  // Grid settings
  COLS: 400,
  ROWS: 330,
  CELL_SIZE: 4,
  SKY_HEIGHT: 130, // rows 0 to 129 are air/surface
  
  // Simulation physics
  ANT_SPEED: 1.2,
  ANT_WANDER_STRENGTH: 0.25,
  ANT_SENSOR_ANGLE: 45 * (Math.PI / 180), // rad
  ANT_SENSOR_DIST: 12,
  ANT_SIZE: 2.5,
  ANT_MAX_ENERGY: 100,

  // Brood growth settings
  EGG_HATCH_TIME: 120, // seconds at 1x
  LARVA_GROWTH_TIME: 180, // seconds
  PUPA_HATCH_TIME: 150, // seconds
  QUEEN_EGG_INTERVAL: 45, // lays egg every 45s if food > 0

  // Food / Consumption rates
  FOOD_SPAWN_INTERVAL: 600, // seconds
  FOOD_CONSUMPTION_RATE: 0.05, // food per ant per second
  FOOD_PER_SOURCE: 50,
  FOOD_PIECE_SIZE: 5, // energy/units per piece carried

  // Pheromone rates
  PHEROMONE_DECAY: 0.004,
  PHEROMONE_DIFFUSION: 0.1,
  PHEROMONE_LAY_STRENGTH: 1.0,

  // Offline progression limits
  MAX_OFFLINE_TIME: 86400 * 7, // 1 week max
};

export interface ExcavationStep {
  name: string;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

export function isCellInsidePlanStep(step: ExcavationStep, c: number, r: number): boolean {
  if (c < step.minCol || c > step.maxCol || r < step.minRow || r > step.maxRow) {
    return false;
  }

  // Round corners only for Chambers and Annexes to avoid blocking connections at shafts/link corridors
  const isChamberOrAnnex = step.name.includes('Chamber') || step.name.includes('Annex');
  if (isChamberOrAnnex) {
    const dx = Math.min(c - step.minCol, step.maxCol - c);
    const dy = Math.min(r - step.minRow, step.maxRow - r);
    if (dx < 3 && dy < 2) {
      const dist = (3 - dx) ** 2 + (2 - dy) ** 2;
      if (dist > 5) {
        return false;
      }
    }
  }

  return true;
}


export const EXCAVATION_PLAN: ExcavationStep[] = [
  // Tier 1 (row 168 to 186)
  { name: 'Extend Shaft (Tier 1)', minCol: 199, maxCol: 200, minRow: 168, maxRow: 186 },
  { name: 'Left Chamber (Tier 1)', minCol: 180, maxCol: 198, minRow: 175, maxRow: 179 },
  { name: 'Right Chamber (Tier 1)', minCol: 201, maxCol: 220, minRow: 175, maxRow: 179 },

  // Tier 2 (row 186 to 204)
  { name: 'Extend Shaft (Tier 2)', minCol: 199, maxCol: 200, minRow: 186, maxRow: 204 },
  { name: 'Left Chamber (Tier 2)', minCol: 180, maxCol: 198, minRow: 193, maxRow: 197 },
  { name: 'Right Chamber (Tier 2)', minCol: 201, maxCol: 220, minRow: 193, maxRow: 197 },

  // Tier 3 (row 204 to 222)
  { name: 'Extend Shaft (Tier 3)', minCol: 199, maxCol: 200, minRow: 204, maxRow: 222 },
  { name: 'Left Chamber (Tier 3)', minCol: 180, maxCol: 198, minRow: 211, maxRow: 215 },
  { name: 'Right Chamber (Tier 3)', minCol: 201, maxCol: 220, minRow: 211, maxRow: 215 },

  // Tier 4 (row 222 to 240)
  { name: 'Extend Shaft (Tier 4)', minCol: 199, maxCol: 200, minRow: 222, maxRow: 240 },
  { name: 'Left Chamber (Tier 4)', minCol: 180, maxCol: 198, minRow: 229, maxRow: 233 },
  { name: 'Right Chamber (Tier 4)', minCol: 201, maxCol: 220, minRow: 229, maxRow: 233 },

  // Tier 5 (row 240 to 258)
  { name: 'Extend Shaft (Tier 5)', minCol: 199, maxCol: 200, minRow: 240, maxRow: 258 },
  { name: 'Left Chamber (Tier 5)', minCol: 180, maxCol: 198, minRow: 247, maxRow: 251 },
  { name: 'Right Chamber (Tier 5)', minCol: 201, maxCol: 220, minRow: 247, maxRow: 251 },

  // Tier 6 (row 258 to 276)
  { name: 'Extend Shaft (Tier 6)', minCol: 199, maxCol: 200, minRow: 258, maxRow: 276 },
  { name: 'Left Chamber (Tier 6)', minCol: 180, maxCol: 198, minRow: 265, maxRow: 269 },
  { name: 'Right Chamber (Tier 6)', minCol: 201, maxCol: 220, minRow: 265, maxRow: 269 },

  // Tier 7 (row 276 to 294)
  { name: 'Extend Shaft (Tier 7)', minCol: 199, maxCol: 200, minRow: 276, maxRow: 294 },
  { name: 'Left Chamber (Tier 7)', minCol: 180, maxCol: 198, minRow: 283, maxRow: 287 },
  { name: 'Right Chamber (Tier 7)', minCol: 201, maxCol: 220, minRow: 283, maxRow: 287 },

  // Tier 8 (row 294 to 315)
  { name: 'Extend Shaft (Tier 8)', minCol: 199, maxCol: 200, minRow: 294, maxRow: 315 },
  { name: 'Left Chamber (Tier 8)', minCol: 180, maxCol: 198, minRow: 301, maxRow: 305 },
  { name: 'Right Chamber (Tier 8)', minCol: 201, maxCol: 220, minRow: 301, maxRow: 305 },
];
