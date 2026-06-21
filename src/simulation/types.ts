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
  COLS: 200,
  ROWS: 165,
  CELL_SIZE: 4,
  SKY_HEIGHT: 65, // rows 0 to 129 are air/surface
  
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
  // Tier 1 (row 77 to 93)
  { name: 'Extend Shaft (Tier 1)', minCol: 99, maxCol: 100, minRow: 77, maxRow: 93 },
  { name: 'Left Chamber (Tier 1)', minCol: 90, maxCol: 98, minRow: 82, maxRow: 86 },
  { name: 'Right Chamber (Tier 1)', minCol: 101, maxCol: 110, minRow: 82, maxRow: 86 },

  // Tier 2 (row 93 to 109)
  { name: 'Extend Shaft (Tier 2)', minCol: 99, maxCol: 100, minRow: 93, maxRow: 109 },
  { name: 'Left Chamber (Tier 2)', minCol: 90, maxCol: 98, minRow: 98, maxRow: 102 },
  { name: 'Right Chamber (Tier 2)', minCol: 101, maxCol: 110, minRow: 98, maxRow: 102 },

  // Tier 3 (row 109 to 125)
  { name: 'Extend Shaft (Tier 3)', minCol: 99, maxCol: 100, minRow: 109, maxRow: 125 },
  { name: 'Left Chamber (Tier 3)', minCol: 90, maxCol: 98, minRow: 114, maxRow: 118 },
  { name: 'Right Chamber (Tier 3)', minCol: 101, maxCol: 110, minRow: 114, maxRow: 118 },

  // Tier 4 (row 125 to 141)
  { name: 'Extend Shaft (Tier 4)', minCol: 99, maxCol: 100, minRow: 125, maxRow: 141 },
  { name: 'Left Chamber (Tier 4)', minCol: 90, maxCol: 98, minRow: 130, maxRow: 134 },
  { name: 'Right Chamber (Tier 4)', minCol: 101, maxCol: 110, minRow: 130, maxRow: 134 },

  // Tier 5 (row 141 to 160)
  { name: 'Extend Shaft (Tier 5)', minCol: 99, maxCol: 100, minRow: 141, maxRow: 160 },
  { name: 'Left Chamber (Tier 5)', minCol: 90, maxCol: 98, minRow: 146, maxRow: 150 },
  { name: 'Right Chamber (Tier 5)', minCol: 101, maxCol: 110, minRow: 146, maxRow: 150 },
];
