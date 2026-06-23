export type CellType = 'Sky' | 'Dirt' | 'Rock' | 'NestAir' | 'Food' | 'Water';

export type FoodType = 'Apple' | 'Foliage' | 'Carcass';

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
  EGG_HATCH_TIME: 60, // seconds at 1x
  LARVA_GROWTH_TIME: 90, // seconds
  PUPA_HATCH_TIME: 75, // seconds
  QUEEN_EGG_INTERVAL: 20, // lays egg every 20s if food > 0

  // Food / Consumption rates
  FOOD_SPAWN_INTERVAL: 600, // seconds
  FOOD_CONSUMPTION_RATE: 0.05, // food per ant per second
  FOOD_PER_SOURCE: 50,
  FOOD_PIECE_SIZE: 5, // energy/units per piece carried

  // Pheromone rates
  PHEROMONE_DECAY: 0.004,
  PHEROMONE_DIFFUSION: 0.1,
  PHEROMONE_LAY_STRENGTH: 1.0,

  // Water & Weather configurations
  WATER_EVAPORATION_RATE: 2,
  QUEEN_MAX_AGE: 15, // max age of Queen in game days

  // Offline progression limits
  MAX_OFFLINE_TIME: 86400 * 7, // 1 week max
};

export const STARTING_CHAMBER_CENTER_ROW = CONFIG.SKY_HEIGHT + 34;

export interface ExcavationStep {
  name: string;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  entranceCol?: number;
  baselineRow?: number;
}

export interface LarderBox {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  centerX: number;
  centerY: number;
}

export const EXCAVATION_PLAN: ExcavationStep[] = [
  // Tier 1
  { name: 'Extend Shaft (Tier 1)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 38, maxRow: CONFIG.SKY_HEIGHT + 56 },
  { name: 'Left Chamber (Tier 1)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 45, maxRow: CONFIG.SKY_HEIGHT + 49 },
  { name: 'Right Chamber (Tier 1)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 45, maxRow: CONFIG.SKY_HEIGHT + 49 },

  // Tier 2
  { name: 'Extend Shaft (Tier 2)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 56, maxRow: CONFIG.SKY_HEIGHT + 74 },
  { name: 'Left Chamber (Tier 2)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 63, maxRow: CONFIG.SKY_HEIGHT + 67 },
  { name: 'Right Chamber (Tier 2)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 63, maxRow: CONFIG.SKY_HEIGHT + 67 },

  // Tier 3
  { name: 'Extend Shaft (Tier 3)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 74, maxRow: CONFIG.SKY_HEIGHT + 92 },
  { name: 'Left Chamber (Tier 3)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 81, maxRow: CONFIG.SKY_HEIGHT + 85 },
  { name: 'Right Chamber (Tier 3)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 81, maxRow: CONFIG.SKY_HEIGHT + 85 },

  // Tier 4
  { name: 'Extend Shaft (Tier 4)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 92, maxRow: CONFIG.SKY_HEIGHT + 110 },
  { name: 'Left Chamber (Tier 4)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 99, maxRow: CONFIG.SKY_HEIGHT + 103 },
  { name: 'Right Chamber (Tier 4)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 99, maxRow: CONFIG.SKY_HEIGHT + 103 },

  // Tier 5
  { name: 'Extend Shaft (Tier 5)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 110, maxRow: CONFIG.SKY_HEIGHT + 128 },
  { name: 'Left Chamber (Tier 5)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 117, maxRow: CONFIG.SKY_HEIGHT + 121 },
  { name: 'Right Chamber (Tier 5)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 117, maxRow: CONFIG.SKY_HEIGHT + 121 },

  // Tier 6
  { name: 'Extend Shaft (Tier 6)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 128, maxRow: CONFIG.SKY_HEIGHT + 146 },
  { name: 'Left Chamber (Tier 6)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 135, maxRow: CONFIG.SKY_HEIGHT + 139 },
  { name: 'Right Chamber (Tier 6)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 135, maxRow: CONFIG.SKY_HEIGHT + 139 },

  // Tier 7
  { name: 'Extend Shaft (Tier 7)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 146, maxRow: CONFIG.SKY_HEIGHT + 164 },
  { name: 'Left Chamber (Tier 7)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 153, maxRow: CONFIG.SKY_HEIGHT + 157 },
  { name: 'Right Chamber (Tier 7)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 153, maxRow: CONFIG.SKY_HEIGHT + 157 },

  // Tier 8
  { name: 'Extend Shaft (Tier 8)', minCol: 199, maxCol: 200, minRow: CONFIG.SKY_HEIGHT + 164, maxRow: CONFIG.SKY_HEIGHT + 185 },
  { name: 'Left Chamber (Tier 8)', minCol: 180, maxCol: 198, minRow: CONFIG.SKY_HEIGHT + 171, maxRow: CONFIG.SKY_HEIGHT + 175 },
  { name: 'Right Chamber (Tier 8)', minCol: 201, maxCol: 220, minRow: CONFIG.SKY_HEIGHT + 171, maxRow: CONFIG.SKY_HEIGHT + 175 },
];
