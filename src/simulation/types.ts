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
  ROWS: 600,
  CELL_SIZE: 4,
  SKY_HEIGHT: 80, // rows 0 to 79 are air/surface
  
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

export const STARTING_CHAMBER_CENTER_ROW = 300;

export interface ExcavationStep {
  name: string;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  entranceCol?: number;
  baselineRow?: number;
}


export const EXCAVATION_PLAN: ExcavationStep[] = [
  // Tier 1
  { name: 'Extend Shaft (Tier 1)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 1, maxRow: CONFIG.SKY_HEIGHT + 17 },
  { name: 'Left Chamber (Tier 1)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 7, maxRow: CONFIG.SKY_HEIGHT + 11 },
  { name: 'Right Chamber (Tier 1)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 7, maxRow: CONFIG.SKY_HEIGHT + 11 },

  // Tier 2
  { name: 'Extend Shaft (Tier 2)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 17, maxRow: CONFIG.SKY_HEIGHT + 37 },
  { name: 'Left Chamber (Tier 2)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 27, maxRow: CONFIG.SKY_HEIGHT + 31 },
  { name: 'Right Chamber (Tier 2)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 27, maxRow: CONFIG.SKY_HEIGHT + 31 },

  // Tier 3
  { name: 'Extend Shaft (Tier 3)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 37, maxRow: CONFIG.SKY_HEIGHT + 57 },
  { name: 'Left Chamber (Tier 3)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 47, maxRow: CONFIG.SKY_HEIGHT + 51 },
  { name: 'Right Chamber (Tier 3)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 47, maxRow: CONFIG.SKY_HEIGHT + 51 },

  // Tier 4
  { name: 'Extend Shaft (Tier 4)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 57, maxRow: CONFIG.SKY_HEIGHT + 77 },
  { name: 'Left Chamber (Tier 4)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 67, maxRow: CONFIG.SKY_HEIGHT + 71 },
  { name: 'Right Chamber (Tier 4)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 67, maxRow: CONFIG.SKY_HEIGHT + 71 },

  // Tier 5
  { name: 'Extend Shaft (Tier 5)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 77, maxRow: CONFIG.SKY_HEIGHT + 97 },
  { name: 'Left Chamber (Tier 5)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 87, maxRow: CONFIG.SKY_HEIGHT + 91 },
  { name: 'Right Chamber (Tier 5)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 87, maxRow: CONFIG.SKY_HEIGHT + 91 },

  // Tier 6
  { name: 'Extend Shaft (Tier 6)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 97, maxRow: CONFIG.SKY_HEIGHT + 117 },
  { name: 'Left Chamber (Tier 6)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 107, maxRow: CONFIG.SKY_HEIGHT + 111 },
  { name: 'Right Chamber (Tier 6)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 107, maxRow: CONFIG.SKY_HEIGHT + 111 },

  // Tier 7
  { name: 'Extend Shaft (Tier 7)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 117, maxRow: CONFIG.SKY_HEIGHT + 137 },
  { name: 'Left Chamber (Tier 7)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 127, maxRow: CONFIG.SKY_HEIGHT + 131 },
  { name: 'Right Chamber (Tier 7)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 127, maxRow: CONFIG.SKY_HEIGHT + 131 },

  // Tier 8
  { name: 'Extend Shaft (Tier 8)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 137, maxRow: CONFIG.SKY_HEIGHT + 160 },
  { name: 'Left Chamber (Tier 8)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 147, maxRow: CONFIG.SKY_HEIGHT + 151 },
  { name: 'Right Chamber (Tier 8)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 147, maxRow: CONFIG.SKY_HEIGHT + 151 },
];
