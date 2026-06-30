import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { AntRole, GameSnapshot } from './types';
import { WorldGrid } from './Grid';
import { SimulationEngine } from './Engine';
import { createDefaultBrain } from './Ant';
import { generateProceduralNestPlan } from './NestPlanner';

export interface OfflineResult {
  elapsedSeconds: number;
  foodGathered: number;
  foodConsumed: number;
  antsBorn: number;
  dirtDug: number;
  foodDecayed?: number;
  broodLosses?: number;
  dirtCleared?: number;
  threatLogs?: string[];
}

export class OfflineProgression {
  // ---------------------------------------------------------------------------
  // Grid serialisation helpers — shared by snapshot() and restore()
  // ---------------------------------------------------------------------------

  // Compress grid to a simple character string to save space and keep it fast.
  // This is also called by Engine.snapshot() internally.
  public static serializeGrid(grid: WorldGrid): string {
    const chars: string[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const colChars: string[] = [];
      for (let r = 0; r < grid.rows; r++) {
        const cell = grid.cells[c][r];
        let ch = 'D'; // Dirt
        if (cell.type === 'Sky') ch = 'S';
        else if (cell.type === 'Rock') ch = 'R';
        else if (cell.type === 'NestAir') ch = 'A';
        else if (cell.type === 'Water') ch = 'W';
        else if (cell.type === 'Food') {
          if (cell.isMoldy) {
            ch = 'M'; // Moldy Apple
            if (cell.foodType === 'Foliage') ch = 'N';
            else if (cell.foodType === 'Carcass') ch = 'O';
          } else {
            ch = 'F'; // Default Apple
            if (cell.foodType === 'Foliage') ch = 'G';
            else if (cell.foodType === 'Carcass') ch = 'C';
          }
        }
        colChars.push(ch);
      }
      chars.push(colChars.join(''));
    }
    return chars.join(',');
  }

  // ---------------------------------------------------------------------------
  // Public save / load API  — only touches engine via engine.snapshot() /
  // engine.restore().  No direct access to Engine, Colony, or Ant fields.
  // ---------------------------------------------------------------------------

  public static saveState(engine: SimulationEngine): void {
    try {
      const snap = engine.snapshot();
      localStorage.setItem('ant_farm_save_v3', JSON.stringify(snap));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }

  public static loadState(engine: SimulationEngine): OfflineResult | null {
    try {
      // Clean up legacy v1 and v2 saves if present
      if (localStorage.getItem('ant_farm_save_v1')) {
        localStorage.removeItem('ant_farm_save_v1');
      }
      if (localStorage.getItem('ant_farm_save_v2')) {
        localStorage.removeItem('ant_farm_save_v2');
      }

      const saveStr = localStorage.getItem('ant_farm_save_v3');
      if (!saveStr) return null;

      const raw = JSON.parse(saveStr);
      if (!raw || !raw.gridStr) return null;

      // Validate snapshot version — reject unknowable future formats
      const parsedVersion: number = raw.version ?? 0;
      if (parsedVersion > 1) {
        console.warn(`Save version ${parsedVersion} is newer than supported (1). Ignoring save.`);
        return null;
      }

      // Normalise legacy saves (version 0 / pre-snapshot) into GameSnapshot shape
      const snap: GameSnapshot = this.normaliseLegacyOrCurrent(raw, engine.grid.cols, engine.grid.rows);
      if (!snap) return null;

      // Check if grid dimensions in save string match current config
      const cols = snap.gridStr.split(',');
      if (cols.length !== engine.grid.cols || (cols[0] && cols[0].length !== engine.grid.rows)) {
        console.warn('Saved grid dimensions mismatch. Resetting world grid to new configuration.');
        return null;
      }

      // Restore engine state from snapshot
      engine.restore(snap);

      // Calculate offline delta
      const savedTime = snap.timestamp;
      const elapsedMs = Date.now() - savedTime;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);

      // Only simulate if offline for more than 15 seconds
      if (elapsedSeconds > 15) {
        const { result, updatedSnap } = this.runOfflineCalculations(snap, engine.grid, elapsedSeconds);
        // Apply the mutated snapshot (colony state, clock, weather, ants, queen, brood, logs)
        // Grid is already correct in engine — we pass it through via updatedSnap.gridStr
        engine.restore(updatedSnap);
        return result;
      }
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: normalise legacy or current raw parsed objects into a GameSnapshot
  // ---------------------------------------------------------------------------

  private static normaliseLegacyOrCurrent(raw: any, gridCols: number, _gridRows: number): GameSnapshot {
    // Legacy v1/v2 saves didn't have a version field — reconstruct the shape
    const gridStr: string = raw.gridStr ?? '';

    const queen = raw.queen
      ? {
          x: raw.queen.x ?? 0,
          y: raw.queen.y ?? 0,
          energy: raw.queen.energy ?? 100,
          eggTimer: raw.queen.eggTimer ?? CONFIG.QUEEN_EGG_INTERVAL,
          restTimer: raw.queen.restTimer ?? 0,
          age: raw.queen.age ?? 0,
          maxAge: raw.queen.maxAge ?? CONFIG.QUEEN_MAX_AGE,
          health: raw.queen.health ?? 100,
          submergedTime: raw.queen.submergedTime ?? 0,
          isDead: raw.queen.isDead ?? false,
          deathReason: raw.queen.deathReason,
        }
      : {
          x: 0, y: 0, energy: 100, eggTimer: CONFIG.QUEEN_EGG_INTERVAL,
          restTimer: 0, age: 0, maxAge: CONFIG.QUEEN_MAX_AGE,
          health: 100, submergedTime: 0, isDead: false,
        };

    const ants = (raw.ants ?? []).map((a: any) => ({
      id: a.id ?? `ant-${a.num ?? 0}`,
      x: a.x ?? 0,
      y: a.y ?? 0,
      angle: a.angle ?? 0,
      role: a.role ?? 'Forager',
      state: a.state ?? 'Wandering',
      energy: a.energy ?? 100,
      cargo: a.cargo ?? 'None',
      num: a.num ?? 1,
      brain: a.brain ?? createDefaultBrain(),
      generation: a.generation ?? 1,
      collisions: a.collisions ?? 0,
      deliveries: a.deliveries ?? 0,
      age: a.age ?? 0,
      maxAge: a.maxAge ?? (600 + Math.random() * 300),
      health: a.health ?? 100,
      submergedTime: a.submergedTime ?? 0,
    }));

    const rawLogs = raw.logs ?? [];
    const logs = rawLogs.map((l: any) => {
      let entry: any = {};
      if (typeof l === 'string') {
        entry = { text: l, category: 'system', timestamp: Date.now() };
      } else {
        entry = { ...l };
      }
      const textLower = (entry.text ?? '').toLowerCase();
      if (textLower.includes('hatch') || textLower.includes('egg') || textLower.includes('larva') || textLower.includes('pupa') || textLower.includes('born')) {
        entry.category = 'births';
      } else if (textLower.includes('died') || textLower.includes('death') || textLower.includes('accident') || textLower.includes('dehydration') || textLower.includes('exhaustion') || textLower.includes('cave-in') || textLower.includes('drowned')) {
        entry.category = 'deaths';
      } else {
        entry.category = entry.category ?? 'system';
      }
      return entry;
    });

    const clock = raw.clock ?? {};
    const weatherState = raw.weatherState ?? {};

    const excavationPlan = raw.excavationPlan && raw.excavationPlan.length > 0
      ? raw.excavationPlan
      : generateProceduralNestPlan(Math.floor(gridCols / 2));

    return {
      version: raw.version ?? 0,
      timestamp: raw.timestamp ?? Date.now(),
      gridStr,
      totalDirtDugGlobal: raw.totalDirtDug ?? raw.totalDirtDugGlobal ?? 0,
      maxPopulation: raw.maxPopulation ?? 8,
      maxGenerationReached: raw.maxGenerationReached ?? 1,
      excavationPlan,
      nextAntNum: raw.nextAntNum ?? (ants.length > 0 ? Math.max(...ants.map((a: any) => a.num ?? 0)) + 1 : 1),
      logs,
      queen,
      broodList: raw.broodList ?? [],
      ants,
      telemetryHistory: raw.telemetryHistory ?? [],
      clock: {
        dayCount: clock.dayCount ?? 1,
        hour: clock.hour ?? 8,
        minute: clock.minute ?? 0,
        minuteFraction: clock.minuteFraction ?? 0,
      },
      weatherState: {
        weather: weatherState.weather ?? 'Sunny',
        weatherTimer: weatherState.weatherTimer ?? 0,
        weatherTargetDuration: weatherState.weatherTargetDuration ?? 9000,
        weatherQueue: weatherState.weatherQueue ?? [],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Core offline calculations — operates exclusively on GameSnapshot fields and
  // WorldGrid API methods.  No access to Engine, Colony, or Ant fields.
  // ---------------------------------------------------------------------------

  private static runOfflineCalculations(
    inputSnap: GameSnapshot,
    grid: WorldGrid,
    totalSeconds: number
  ): { result: OfflineResult; updatedSnap: GameSnapshot } {
    // Work on a shallow copy so the original is not mutated in-place
    const snap: GameSnapshot = {
      ...inputSnap,
      queen: { ...inputSnap.queen },
      clock: { ...inputSnap.clock },
      weatherState: {
        ...inputSnap.weatherState,
        weatherQueue: inputSnap.weatherState.weatherQueue.slice(),
      },
      ants: inputSnap.ants.map(a => ({ ...a })),
      broodList: inputSnap.broodList.map(b => ({ ...b })),
      logs: inputSnap.logs.slice(),
    };

    // Limit maximum offline duration to avoid excessive growth
    const duration = Math.min(totalSeconds, CONFIG.MAX_OFFLINE_TIME);

    // Helper to add a log entry directly to the snapshot log list
    const addLog = (text: string, category: 'system' | 'births' | 'deaths') => {
      const timestamp = Date.now();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      snap.logs.unshift({ text: `[${timeStr}] ${text}`, category, timestamp });
      if (snap.logs.length > 40) snap.logs.pop();
    };

    // Helper: refill weather queue when it runs low
    const refillWeatherQueue = () => {
      while (snap.weatherState.weatherQueue.length < 5) {
        const type = Math.random() < 0.35 ? 'Rainy' : 'Sunny';
        const hours = type === 'Sunny' ? (4 + Math.random() * 4) : (2 + Math.random() * 2);
        snap.weatherState.weatherQueue.push({ type, durationFrames: Math.round(hours * 900) });
      }
    };

    // Progress Clock Offline
    const totalSimMinutes = Math.floor(duration * 2);
    const inGameHours = totalSimMinutes / 60;
    const addHours = Math.floor(totalSimMinutes / 60);
    const addMinutes = totalSimMinutes % 60;

    snap.clock.minute += addMinutes;
    if (snap.clock.minute >= 60) {
      snap.clock.minute -= 60;
      snap.clock.hour += 1;
    }
    snap.clock.hour += addHours;
    if (snap.clock.hour >= 24) {
      snap.clock.dayCount += Math.floor(snap.clock.hour / 24);
      snap.clock.hour = snap.clock.hour % 24;
    }

    // Progress Weather Queue Offline and track rainy/sunny seconds
    let rainySeconds = 0;
    let sunnySeconds = 0;

    let offlineFramesRemaining = duration * 60;
    let currentRemaining = Math.max(0, snap.weatherState.weatherTargetDuration - snap.weatherState.weatherTimer);

    if (offlineFramesRemaining >= currentRemaining) {
      const currentCycleSecs = currentRemaining / 60;
      if (snap.weatherState.weather === 'Rainy') {
        rainySeconds += currentCycleSecs;
      } else {
        sunnySeconds += currentCycleSecs;
      }
      offlineFramesRemaining -= currentRemaining;

      refillWeatherQueue();
      let next = snap.weatherState.weatherQueue.shift()!;
      snap.weatherState.weather = next.type;
      snap.weatherState.weatherTargetDuration = next.durationFrames;
      snap.weatherState.weatherTimer = 0;

      while (offlineFramesRemaining >= snap.weatherState.weatherTargetDuration) {
        const cycleSecs = snap.weatherState.weatherTargetDuration / 60;
        if (snap.weatherState.weather === 'Rainy') {
          rainySeconds += cycleSecs;
        } else {
          sunnySeconds += cycleSecs;
        }
        offlineFramesRemaining -= snap.weatherState.weatherTargetDuration;
        refillWeatherQueue();
        next = snap.weatherState.weatherQueue.shift()!;
        snap.weatherState.weather = next.type;
        snap.weatherState.weatherTargetDuration = next.durationFrames;
        snap.weatherState.weatherTimer = 0;
      }

      const finalSecs = offlineFramesRemaining / 60;
      if (snap.weatherState.weather === 'Rainy') {
        rainySeconds += finalSecs;
      } else {
        sunnySeconds += finalSecs;
      }
      snap.weatherState.weatherTimer = offlineFramesRemaining;
    } else {
      const finalSecs = offlineFramesRemaining / 60;
      if (snap.weatherState.weather === 'Rainy') {
        rainySeconds += finalSecs;
      } else {
        sunnySeconds += finalSecs;
      }
      snap.weatherState.weatherTimer += offlineFramesRemaining;
    }

    // Count roles from snapshot ant list
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;
    let soldiers = 0;
    snap.ants.forEach(a => {
      if (a.role === 'Forager') foragers++;
      else if (a.role === 'Digger') diggers++;
      else if (a.role === 'Nurse') nurses++;
      else if ((a.role as string) === 'Soldier') soldiers++;
    });

    const threatLogs: string[] = [];

    // 1. Spawn Rain Water Offline (rebalanced trickle at nest entrance, no surface pooling)
    let waterAccumulated = 0;
    if (rainySeconds > 0) {
      const spawnCount = Math.min(2000, Math.floor(rainySeconds * 1.2));
      for (let i = 0; i < spawnCount; i++) {
        const col = grid.nestEntranceCol - 2 + Math.floor(Math.random() * 4);
        const row = CONFIG.SKY_HEIGHT;
        if (grid.isValid(col, row)) {
          const cell = grid.getCell(col, row);
          if (cell && (cell.type === 'NestAir' || cell.type === 'Sky')) {
            grid.setWaterCell(col, row);
            waterAccumulated++;
          }
        }
      }
    }

    // 2. Sunny Water Evaporation Offline
    let waterEvaporated = 0;
    if (sunnySeconds > 0) {
      const evapAttempts = Math.min(15000, Math.floor(sunnySeconds * 21));
      const rate = CONFIG.WATER_EVAPORATION_RATE || 2;
      for (let i = 0; i < evapAttempts; i++) {
        for (let j = 0; j < rate; j++) {
          const col = Math.floor(Math.random() * grid.cols);
          for (let r = 0; r < grid.rows; r++) {
            const cell = grid.getCell(col, r);
            if (cell && cell.type === 'Water') {
              grid.setCellType(col, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
              waterEvaporated++;
              break;
            }
          }
        }
      }
    }

    // 3. Localized CA water updates offline
    const caSteps = Math.min(1000, Math.floor(duration * 2));
    if (caSteps > 0) {
      for (let step = 0; step < caSteps; step++) {
        for (let r = 250; r >= 80; r--) {
          const waterCols: number[] = [];
          for (let c = 150; c <= 250; c++) {
            if (grid.cells[c][r].type === 'Water') {
              waterCols.push(c);
            }
          }
          if (waterCols.length === 0) continue;

          for (let i = waterCols.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = waterCols[i];
            waterCols[i] = waterCols[j];
            waterCols[j] = temp;
          }

          for (const c of waterCols) {
            if (grid.cells[c][r].type !== 'Water') continue;

            // If a water cell is on the surface (at or above CONFIG.SKY_HEIGHT) and not in the shaft columns, evaporate it
            if (r <= CONFIG.SKY_HEIGHT && (c < grid.nestEntranceCol - 2 || c > grid.nestEntranceCol + 1)) {
              grid.setCellType(c, r, 'Sky');
              continue;
            }

            const belowR = r + 1;
            if (belowR <= 250) {
              const belowCell = grid.cells[c][belowR];
              if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
                grid.setCellType(c, belowR, 'Water');
                grid.setCellType(c, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
                continue;
              }
            }

            const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedDiag = false;
            for (const dc of diagOffsets) {
              const tc = c + dc;
              const tr = r + 1;
              if (tc >= 150 && tc <= 250 && tr <= 250) {
                const diagCell = grid.cells[tc][tr];
                if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
                  grid.setCellType(tc, tr, 'Water');
                  grid.setCellType(c, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
                  movedDiag = true;
                  break;
                }
              }
            }
            if (movedDiag) continue;

            const latOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedLat = false;
            for (const dc of latOffsets) {
              const tc = c + dc;
              if (tc >= 150 && tc <= 250) {
                const latCell = grid.cells[tc][r];
                if (latCell.type === 'NestAir' || latCell.type === 'Sky') {
                  grid.setCellType(tc, r, 'Water');
                  grid.setCellType(c, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
                  movedLat = true;
                  break;
                }
              }
            }
            if (movedLat) continue;
          }
        }
      }
    }

    // 3.5. Granular food gravity updates offline
    const foodSteps = Math.min(500, Math.floor(duration * 1));
    if (foodSteps > 0) {
      for (let step = 0; step < foodSteps; step++) {
        for (let r = grid.rows - 2; r >= 0; r--) {
          const foodCols: number[] = [];
          for (let c = 0; c < grid.cols; c++) {
            if (grid.cells[c][r].type === 'Food') {
              foodCols.push(c);
            }
          }
          if (foodCols.length === 0) continue;

          for (let i = foodCols.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = foodCols[i];
            foodCols[i] = foodCols[j];
            foodCols[j] = temp;
          }

          for (const c of foodCols) {
            if (grid.cells[c][r].type !== 'Food') continue;

            const belowR = r + 1;
            if (belowR < grid.rows) {
              const belowCell = grid.cells[c][belowR];
              if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
                const srcCell = grid.cells[c][r];
                grid.setCellType(c, belowR, 'Food');
                const dstCell = grid.cells[c][belowR];
                dstCell.foodAmount = srcCell.foodAmount;
                dstCell.foodType = srcCell.foodType;
                dstCell.isMoldy = srcCell.isMoldy;
                grid.setCellType(c, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
                grid.cells[c][r].foodAmount = 0;
                grid.cells[c][r].foodType = undefined;
                grid.cells[c][r].isMoldy = undefined;
                continue;
              }
            }

            const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedDiag = false;
            for (const dc of diagOffsets) {
              const tc = c + dc;
              const tr = r + 1;
              if (grid.isValid(tc, tr)) {
                const diagCell = grid.cells[tc][tr];
                if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
                  const srcCell = grid.cells[c][r];
                  grid.setCellType(tc, tr, 'Food');
                  const dstCell = grid.cells[tc][tr];
                  dstCell.foodAmount = srcCell.foodAmount;
                  dstCell.foodType = srcCell.foodType;
                  dstCell.isMoldy = srcCell.isMoldy;
                  grid.setCellType(c, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
                  grid.cells[c][r].foodAmount = 0;
                  grid.cells[c][r].foodType = undefined;
                  grid.cells[c][r].isMoldy = undefined;
                  movedDiag = true;
                  break;
                }
              }
            }
            if (movedDiag) continue;
          }
        }
      }
    }

    // 4. Rain cave-ins & Diggers clearing cave-ins
    let caveInsCount = 0;
    let dirtCleared = 0;
    if (rainySeconds > 0) {
      const maxCaveIns = Math.min(50, Math.floor(rainySeconds * 0.05));
      for (let i = 0; i < maxCaveIns; i++) {
        const col = 150 + Math.floor(Math.random() * 101);
        const row = 80 + Math.floor(Math.random() * 171);
        const cell = grid.getCell(col, row);
        if (cell && cell.type === 'NestAir') {
          grid.setCellType(col, row, 'Dirt');
          caveInsCount++;
        }
      }
      if (caveInsCount > 0) {
        threatLogs.push(`Threat: Heavy rain storm caused ${caveInsCount} tunnel cave-ins!`);
        addLog(`Heavy rain storm caused ${caveInsCount} tunnel cave-ins!`, 'system');

        if (diggers > 0) {
          const clearCapacity = Math.floor(diggers * 0.002 * duration);
          const targetClear = Math.min(caveInsCount, clearCapacity);
          let clearedSoFar = 0;
          for (let attempt = 0; attempt < 500 && clearedSoFar < targetClear; attempt++) {
            const col = 150 + Math.floor(Math.random() * 101);
            const row = 80 + Math.floor(Math.random() * 171);
            const cell = grid.getCell(col, row);
            if (cell && cell.type === 'Dirt') {
              const isAdjToAir =
                grid.getCell(col + 1, row)?.type === 'NestAir' ||
                grid.getCell(col - 1, row)?.type === 'NestAir' ||
                grid.getCell(col, row + 1)?.type === 'NestAir' ||
                grid.getCell(col, row - 1)?.type === 'NestAir';
              if (isAdjToAir) {
                grid.setCellType(col, row, 'NestAir');
                clearedSoFar++;
              }
            }
          }
          dirtCleared = clearedSoFar;
          if (dirtCleared > 0) {
            threatLogs.push(`Defense: Diggers cleared ${dirtCleared} caved-in dirt cells to restore tunnel flow.`);
            addLog(`Diggers cleared ${dirtCleared} caved-in dirt cells.`, 'system');
          }
        }
      }
    }

    // 5. Mold Decay in Larders — uses grid API only
    let foodDecayed = 0;
    const larderBoxes = getLarderBoxesFromPlan(snap.excavationPlan, grid);
    let moldLogs = false;
    for (const box of larderBoxes) {
      const flooded = isLarderFloodedGrid(grid, box);
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            if (flooded && !cell.isMoldy) {
              grid.setMoldy(c, r);
              moldLogs = true;
            }
            if (cell.isMoldy) {
              const decayAmount = 0.3 * duration;
              const actualDecay = Math.min(cell.foodAmount, decayAmount);
              grid.decayFood(c, r, actualDecay);
              foodDecayed += actualDecay;
            }
          }
        }
      }
    }
    foodDecayed = Math.floor(foodDecayed);
    if (moldLogs) {
      addLog('Flooded larder detected! Food stockpiles are decaying from mold.', 'system');
      threatLogs.push('Warning: Water leaked into the larder chamber, causing mold decay!');
    } else if (foodDecayed > 0) {
      threatLogs.push(`Warning: Moldy food in larder decayed: lost ${foodDecayed} food units.`);
    }

    // 6. Digging progression (clearing dirt cells underground) — grid API only
    const digRatePerSecond = 0.00008;
    const rawCellsToDig = Math.floor(diggers * digRatePerSecond * duration);
    let cellsDug = 0;

    if (rawCellsToDig > 0) {
      const candidates: { c: number; r: number }[] = [];
      for (let c = 5; c < grid.cols - 5; c++) {
        for (let r = CONFIG.SKY_HEIGHT + 5; r < grid.rows - 3; r++) {
          if (grid.isDiggable(c, r)) {
            const isAdjToAir =
              grid.getCell(c + 1, r)?.type === 'NestAir' ||
              grid.getCell(c - 1, r)?.type === 'NestAir' ||
              grid.getCell(c, r + 1)?.type === 'NestAir' ||
              grid.getCell(c, r - 1)?.type === 'NestAir';
            if (isAdjToAir) {
              candidates.push({ c, r });
            }
          }
        }
      }

      candidates.sort(() => Math.random() - 0.5);

      const targetDig = Math.min(rawCellsToDig, candidates.length, 300);
      for (let i = 0; i < targetDig; i++) {
        const cell = candidates[i];
        if (grid.digCell(cell.c, cell.r)) {
          cellsDug++;
          snap.totalDirtDugGlobal++;
          grid.depositDirt(cell.c);
        }
      }
    }

    // 7. Foraging / Food gathering progress — grid API only
    let foodAvailableOnGrid = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Food') {
          foodAvailableOnGrid += grid.cells[c][r].foodAmount;
        }
      }
    }

    const gatherRatePerForagerSecond = 0.005;
    const maxGatherable = foragers * gatherRatePerForagerSecond * duration;
    const foodGathered = Math.floor(Math.min(maxGatherable, foodAvailableOnGrid));

    let foodToConsumeFromGrid = foodGathered;
    for (let c = 0; c < grid.cols && foodToConsumeFromGrid > 0; c++) {
      for (let r = 0; r < grid.rows && foodToConsumeFromGrid > 0; r++) {
        if (grid.cells[c][r].type === 'Food') {
          const removed = grid.removeFood(c, r, foodToConsumeFromGrid, 'Sky');
          foodToConsumeFromGrid -= removed;
        }
      }
    }

    // Track gathered food by adding it to the larder via grid
    let foodToAdd = foodGathered;
    for (const box of larderBoxes) {
      if (foodToAdd <= 0) break;
      for (let c = box.minCol; c <= box.maxCol; c++) {
        if (foodToAdd <= 0) break;
        for (let r = box.minRow; r <= box.maxRow; r++) {
          if (foodToAdd <= 0) break;
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'NestAir') {
            const amt = Math.min(foodToAdd, CONFIG.FOOD_PIECE_SIZE);
            grid.convertToFood(c, r, amt, 'Apple');
            foodToAdd -= amt;
          } else if (cell && cell.type === 'Food' && cell.foodAmount < CONFIG.FOOD_PIECE_SIZE) {
            const cap = CONFIG.FOOD_PIECE_SIZE - cell.foodAmount;
            const add = Math.min(foodToAdd, cap);
            grid.addFoodAmount(c, r, add);
            foodToAdd -= add;
          }
        }
      }
    }

    // 8. Colony food consumption — remove from larder grid cells
    let currentFoodStockpile = 0;
    for (const box of larderBoxes) {
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') currentFoodStockpile += cell.foodAmount;
        }
      }
    }
    const foodConsumedRaw = snap.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * duration;
    const foodConsumed = Math.floor(Math.min(foodConsumedRaw, currentFoodStockpile));
    // Remove food consumed from larder
    let foodToRemove = foodConsumed;
    outer: for (let b = larderBoxes.length - 1; b >= 0; b--) {
      const box = larderBoxes[b];
      for (let c = box.maxCol; c >= box.minCol; c--) {
        for (let r = box.maxRow; r >= box.minRow; r--) {
          if (foodToRemove <= 0) break outer;
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            const removed = grid.removeFood(c, r, foodToRemove, 'NestAir');
            foodToRemove -= removed;
          }
        }
      }
    }

    // 9. Mite Invasions — mutates snap.broodList
    let broodLosses = 0;
    if (inGameHours > 0) {
      const intervals = Math.max(1, Math.floor(inGameHours / 12));
      for (let i = 0; i < intervals; i++) {
        if (snap.broodList.length > 0 && Math.random() < 0.10) {
          if (soldiers > 0) {
            threatLogs.push("Defense: Mites invaded the nurseries, but Soldier ants successfully defended the brood!");
          } else {
            const lossCount = Math.min(snap.broodList.length, 1 + Math.floor(Math.random() * 3));
            if (lossCount > 0) {
              broodLosses += lossCount;
              snap.broodList.splice(snap.broodList.length - lossCount, lossCount);
            }
          }
        }
      }
      if (broodLosses > 0) {
        threatLogs.push(`Threat: Mites invaded the nurseries and devoured ${broodLosses} brood items!`);
        addLog(`Mites invaded the nurseries and devoured ${broodLosses} brood items!`, 'deaths');
      }
    }

    // 10. Queen aging, energy, health & drowning updates — mutates snap.queen
    if (!snap.queen.isDead) {
      snap.queen.age += duration / 120;

      const qCol = Math.floor(snap.queen.x / CONFIG.CELL_SIZE);
      const qRow = Math.floor(snap.queen.y / CONFIG.CELL_SIZE);
      const qCell = grid.getCell(qCol, qRow);
      const qSubmerged = qCell && qCell.type === 'Water';

      if (qSubmerged) {
        snap.queen.submergedTime += duration;
        if (snap.queen.submergedTime > 5.0) {
          const damage = 2 * 60 * (duration - Math.max(0, 5.0 - (snap.queen.submergedTime - duration)));
          snap.queen.health = Math.max(0, snap.queen.health - damage);
        }
      } else {
        snap.queen.submergedTime = 0;
        snap.queen.health = Math.min(100, snap.queen.health + 30 * duration);
      }

      const queenEnergyLoss = (100 / 360) * duration;
      snap.queen.energy = Math.max(0, snap.queen.energy - queenEnergyLoss);

      // Queen feeding by nurses — measure current stockpile from larder
      if (snap.queen.energy < 75 && nurses > 0) {
        let stockAfterConsume = 0;
        for (const box of larderBoxes) {
          for (let c = box.minCol; c <= box.maxCol; c++) {
            for (let r = box.minRow; r <= box.maxRow; r++) {
              const cell = grid.getCell(c, r);
              if (cell && cell.type === 'Food') stockAfterConsume += cell.foodAmount;
            }
          }
        }
        if (stockAfterConsume >= 5) {
          const deficit = 100 - snap.queen.energy;
          const feedsNeeded = Math.ceil(deficit / 25);
          const feedsPossible = Math.min(feedsNeeded, Math.floor(stockAfterConsume / 5));
          if (feedsPossible > 0) {
            snap.queen.energy = Math.min(100, snap.queen.energy + feedsPossible * 25);
            // Remove feeding cost from larder
            let feedCost = feedsPossible * 5;
            for (let b = larderBoxes.length - 1; b >= 0; b--) {
              const box = larderBoxes[b];
              for (let c = box.maxCol; c >= box.minCol; c--) {
                for (let r = box.maxRow; r >= box.minRow; r--) {
                  if (feedCost <= 0) break;
                  const cell = grid.getCell(c, r);
                  if (cell && cell.type === 'Food') {
                    const removed = grid.removeFood(c, r, feedCost, 'NestAir');
                    feedCost -= removed;
                  }
                }
              }
            }
          }
        }
      }

      if (snap.queen.age >= snap.queen.maxAge) {
        snap.queen.isDead = true;
        snap.queen.deathReason = 'old age';
        addLog('The Queen has died of old age! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has died of old age.');
      } else if (snap.queen.energy <= 0) {
        snap.queen.isDead = true;
        snap.queen.deathReason = 'starvation';
        addLog('The Queen has died of starvation! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has died of starvation.');
      } else if (snap.queen.health <= 0) {
        snap.queen.isDead = true;
        snap.queen.deathReason = 'drowning';
        addLog('The Queen has drowned! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has drowned.');
      }
    }

    // 11. Worker ants updates: aging and drowning offline — mutates snap.ants
    let antsDiedOldAge = 0;
    let antsDrowned = 0;
    for (let i = snap.ants.length - 1; i >= 0; i--) {
      const ant = snap.ants[i];
      ant.age += duration / 120;

      const col = Math.floor(ant.x / CONFIG.CELL_SIZE);
      const row = Math.floor(ant.y / CONFIG.CELL_SIZE);
      const cell = grid.getCell(col, row);
      const isSubmerged = cell && cell.type === 'Water';

      let died = false;
      if (ant.age >= ant.maxAge) {
        died = true;
        antsDiedOldAge++;
      } else if (isSubmerged) {
        ant.submergedTime += duration;
        if (ant.submergedTime > 5.0) {
          const damage = 2 * 60 * (duration - Math.max(0, 5.0 - (ant.submergedTime - duration)));
          ant.health -= damage;
        }
        if (ant.health <= 0) {
          died = true;
          antsDrowned++;
        }
      } else {
        ant.submergedTime = 0;
        ant.health = Math.min(100, ant.health + 30 * duration);
      }

      if (died) {
        snap.ants.splice(i, 1);
      }
    }
    if (antsDiedOldAge > 0) {
      threatLogs.push(`Threat: ${antsDiedOldAge} worker ants died of old age.`);
      addLog(`${antsDiedOldAge} workers died of old age.`, 'deaths');
    }
    if (antsDrowned > 0) {
      threatLogs.push(`Threat: ${antsDrowned} worker ants drowned in flooded tunnels.`);
      addLog(`${antsDrowned} workers drowned.`, 'deaths');
    }

    // 12. Queen laying eggs / Brood progression offline — mutates snap.queen, snap.broodList, snap.ants
    let eggsLaid = 0;
    let antsBorn = 0;
    const stepSizeSeconds = Math.min(duration, 300);
    const stepsCount = Math.floor(duration / stepSizeSeconds);

    // Measure current stockpile from larder for egg-laying budget
    const getStockpile = (): number => {
      let total = 0;
      for (const box of larderBoxes) {
        for (let c = box.minCol; c <= box.maxCol; c++) {
          for (let r = box.minRow; r <= box.maxRow; r++) {
            const cell = grid.getCell(c, r);
            if (cell && cell.type === 'Food') total += cell.foodAmount;
          }
        }
      }
      return total;
    };

    const consumeFood = (amount: number): boolean => {
      let remaining = amount;
      for (let b = larderBoxes.length - 1; b >= 0; b--) {
        const box = larderBoxes[b];
        for (let c = box.maxCol; c >= box.minCol; c--) {
          for (let r = box.maxRow; r >= box.minRow; r--) {
            if (remaining <= 0) break;
            const cell = grid.getCell(c, r);
            if (cell && cell.type === 'Food') {
              const removed = grid.removeFood(c, r, remaining, 'NestAir');
              remaining -= removed;
            }
          }
        }
      }
      return remaining <= 0;
    };

    if (!snap.queen.isDead) {
      let localEggTimer = snap.queen.eggTimer;
      for (let s = 0; s < stepsCount; s++) {
        let remainingSeconds = stepSizeSeconds;
        while (remainingSeconds > 0) {
          if (localEggTimer <= 0) {
            if (getStockpile() >= 10) {
              consumeFood(10);
              eggsLaid++;

              const rx = snap.queen.x + (Math.random() - 0.5) * 40;
              const ry = snap.queen.y + 12;
              snap.broodList.push({
                id: `brood-${Math.random().toString(36).substr(2, 9)}`,
                type: 'Egg',
                x: rx,
                y: ry,
                progress: 0,
                needsFood: false,
                beingCarried: false,
              });
              localEggTimer = CONFIG.QUEEN_EGG_INTERVAL + Math.random() * 20;
            } else {
              localEggTimer = 0;
              break;
            }
          }
          const dtToNextEgg = Math.max(1, localEggTimer);
          const elapsed = Math.min(remainingSeconds, dtToNextEgg);
          localEggTimer -= elapsed;
          remainingSeconds -= elapsed;
        }
        snap.queen.eggTimer = localEggTimer;

        // Advance brood in-place (minimal inline simulation matching BroodManager.updateOffline)
        advanceBroodOffline(
          snap.broodList,
          stepSizeSeconds,
          nurses,
          consumeFood,
          () => {
            antsBorn++;
            const id = `ant-${Math.random().toString(36).substr(2, 9)}`;

            const totalAntsCount = (foragers + diggers + nurses + soldiers) || 1;
            const fDiff = 0.40 - (foragers / totalAntsCount);
            const dDiff = 0.35 - (diggers / totalAntsCount);
            const nDiff = 0.25 - (nurses / totalAntsCount);

            let role: AntRole = 'Forager';
            if (fDiff >= dDiff && fDiff >= nDiff) {
              role = 'Forager';
              foragers++;
            } else if (dDiff >= nDiff) {
              role = 'Digger';
              diggers++;
            } else {
              role = 'Nurse';
              nurses++;
            }

            const num = snap.nextAntNum++;
            const newAnt = {
              id,
              x: snap.queen.x,
              y: snap.queen.y,
              angle: Math.random() * Math.PI * 2,
              role,
              state: 'Wandering' as const,
              energy: CONFIG.ANT_MAX_ENERGY,
              cargo: 'None' as const,
              num,
              brain: createDefaultBrain(),
              generation: 1,
              collisions: 0,
              deliveries: 0,
              age: 0,
              maxAge: 600 + Math.random() * 300,
              health: 100,
              submergedTime: 0,
            };
            snap.ants.push(newAnt);
          }
        );
      }
    }

    if (antsBorn > 0 || foodGathered > 0 || cellsDug > 0) {
      addLog(`Colony offline progression: gathered +${foodGathered} food, dug +${cellsDug} dirt cells, and welcomed +${antsBorn} new ants!`, 'system');
    }

    // Re-serialise the updated grid into the snapshot so engine.restore() gets the final CA state
    snap.gridStr = OfflineProgression.serializeGrid(grid);
    snap.timestamp = Date.now(); // reset timestamp so next load doesn't re-apply

    const result: OfflineResult = {
      elapsedSeconds: totalSeconds,
      foodGathered,
      foodConsumed,
      antsBorn,
      dirtDug: cellsDug,
      foodDecayed,
      broodLosses,
      dirtCleared,
      threatLogs,
    };

    return { result, updatedSnap: snap };
  }

  public static clearSave() {
    localStorage.removeItem('ant_farm_save_v3');
    localStorage.removeItem('ant_farm_save_v2');
    localStorage.removeItem('ant_farm_save_v1');
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (no Colony / Engine field access)
// ---------------------------------------------------------------------------

interface LarderBox {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * Derives larder bounding boxes from the excavation plan and the current grid.
 * Mirrors ColonyManager.getLarderBoxes() without depending on ColonyManager.
 */
function getLarderBoxesFromPlan(
  excavationPlan: import('./types').ExcavationStep[],
  grid: WorldGrid
): LarderBox[] {
  const boxes: LarderBox[] = [];
  const entranceCol = grid.nestEntranceCol;
  const centerRow = STARTING_CHAMBER_CENTER_ROW;

  // Default right larder in Queen's starting chamber
  boxes.push({
    minCol: entranceCol + 5,
    maxCol: entranceCol + 15,
    minRow: centerRow - 3,
    maxRow: centerRow + 3,
  });

  for (const step of excavationPlan) {
    if (step.name.includes('Chamber') || step.name.includes('Annex')) {
      if (step.name.includes('Right') || step.name.includes('Larder')) {
        let cleared = true;
        outer: for (let c = step.minCol; c <= step.maxCol; c++) {
          for (let r = step.minRow; r <= step.maxRow; r++) {
            if (grid.isValid(c, r)) {
              const type = grid.getCell(c, r)?.type;
              if (type === 'Dirt' || type === 'Rock') {
                cleared = false;
                break outer;
              }
            }
          }
        }
        if (cleared) {
          boxes.push({ minCol: step.minCol, maxCol: step.maxCol, minRow: step.minRow, maxRow: step.maxRow });
        }
      }
    }
  }

  return boxes;
}

/** Check if any cell in the larder box is Water. */
function isLarderFloodedGrid(grid: WorldGrid, box: LarderBox): boolean {
  for (let c = box.minCol; c <= box.maxCol; c++) {
    for (let r = box.minRow; r <= box.maxRow; r++) {
      const cell = grid.getCell(c, r);
      if (cell && cell.type === 'Water') return true;
    }
  }
  return false;
}

/**
 * Inline brood advancement matching BroodManager.updateOffline logic.
 * Mutates the broodList array in-place.
 */
function advanceBroodOffline(
  broodList: import('./types').Brood[],
  stepSizeSeconds: number,
  nurses: number,
  consumeFood: (amount: number) => boolean,
  onHatch: () => void
): void {
  const EGG_HATCH_TIME = CONFIG.EGG_HATCH_TIME;
  const LARVA_GROWTH_TIME = CONFIG.LARVA_GROWTH_TIME;
  const PUPA_HATCH_TIME = CONFIG.PUPA_HATCH_TIME;

  for (let i = broodList.length - 1; i >= 0; i--) {
    const brood = broodList[i];
    if (brood.type === 'Egg') {
      const increment = (stepSizeSeconds / EGG_HATCH_TIME) * 100;
      brood.progress = Math.min(100, brood.progress + increment);
      if (brood.progress >= 100) {
        brood.type = 'Larva';
        brood.progress = 0;
        brood.needsFood = true;
      }
    } else if (brood.type === 'Larva') {
      if (brood.needsFood && nurses > 0) {
        if (consumeFood(1)) {
          brood.needsFood = false;
        }
      }
      if (!brood.needsFood) {
        const increment = (stepSizeSeconds / LARVA_GROWTH_TIME) * 100;
        brood.progress = Math.min(100, brood.progress + increment);
        if (brood.progress >= 100) {
          brood.type = 'Pupa';
          brood.progress = 0;
        }
        brood.needsFood = true;
      }
    } else if (brood.type === 'Pupa') {
      const increment = (stepSizeSeconds / PUPA_HATCH_TIME) * 100;
      brood.progress = Math.min(100, brood.progress + increment);
      if (brood.progress >= 100) {
        broodList.splice(i, 1);
        onHatch();
      }
    }
  }
}
