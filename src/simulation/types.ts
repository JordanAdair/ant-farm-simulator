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
  // Tier 1 (row 76 to 92)
  { name: 'Extend Shaft (Tier 1)', minCol: 199, maxCol: 200, minRow: 76, maxRow: 92 },
  { name: 'Left Chamber (Tier 1)', minCol: 180, maxCol: 198, minRow: 82, maxRow: 86 },
  { name: 'Right Chamber (Tier 1)', minCol: 201, maxCol: 220, minRow: 82, maxRow: 86 },

  // Tier 2 (row 92 to 112)
  { name: 'Extend Shaft (Tier 2)', minCol: 199, maxCol: 200, minRow: 92, maxRow: 112 },
  { name: 'Left Chamber (Tier 2)', minCol: 180, maxCol: 198, minRow: 102, maxRow: 106 },
  { name: 'Right Chamber (Tier 2)', minCol: 201, maxCol: 220, minRow: 102, maxRow: 106 },

  // Tier 3 (row 112 to 132)
  { name: 'Extend Shaft (Tier 3)', minCol: 199, maxCol: 200, minRow: 112, maxRow: 132 },
  { name: 'Left Chamber (Tier 3)', minCol: 180, maxCol: 198, minRow: 122, maxRow: 126 },
  { name: 'Right Chamber (Tier 3)', minCol: 201, maxCol: 220, minRow: 122, maxRow: 126 },

  // Tier 4 (row 132 to 152)
  { name: 'Extend Shaft (Tier 4)', minCol: 199, maxCol: 200, minRow: 132, maxRow: 152 },
  { name: 'Left Chamber (Tier 4)', minCol: 180, maxCol: 198, minRow: 142, maxRow: 146 },
  { name: 'Right Chamber (Tier 4)', minCol: 201, maxCol: 220, minRow: 142, maxRow: 146 },

  // Tier 5 (row 152 to 172)
  { name: 'Extend Shaft (Tier 5)', minCol: 199, maxCol: 200, minRow: 152, maxRow: 172 },
  { name: 'Left Chamber (Tier 5)', minCol: 180, maxCol: 198, minRow: 162, maxRow: 166 },
  { name: 'Right Chamber (Tier 5)', minCol: 201, maxCol: 220, minRow: 162, maxRow: 166 },

  // Tier 6 (row 172 to 192)
  { name: 'Extend Shaft (Tier 6)', minCol: 199, maxCol: 200, minRow: 172, maxRow: 192 },
  { name: 'Left Chamber (Tier 6)', minCol: 180, maxCol: 198, minRow: 182, maxRow: 186 },
  { name: 'Right Chamber (Tier 6)', minCol: 201, maxCol: 220, minRow: 182, maxRow: 186 },

  // Tier 7 (row 192 to 212)
  { name: 'Extend Shaft (Tier 7)', minCol: 199, maxCol: 200, minRow: 192, maxRow: 212 },
  { name: 'Left Chamber (Tier 7)', minCol: 180, maxCol: 198, minRow: 202, maxRow: 206 },
  { name: 'Right Chamber (Tier 7)', minCol: 201, maxCol: 220, minRow: 202, maxRow: 206 },

  // Tier 8 (row 212 to 235)
  { name: 'Extend Shaft (Tier 8)', minCol: 199, maxCol: 200, minRow: 212, maxRow: 235 },
  { name: 'Left Chamber (Tier 8)', minCol: 180, maxCol: 198, minRow: 222, maxRow: 226 },
  { name: 'Right Chamber (Tier 8)', minCol: 201, maxCol: 220, minRow: 222, maxRow: 226 },
];
