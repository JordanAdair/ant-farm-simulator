import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { ExcavationStep } from './types';

/**
 * Calculates the horizontal center column of the shaft at a given row depth,
 * using a sine wave to create a wavy, organic structure.
 */
export function getShaftCenterCol(row: number, entranceCol: number): number {
  if (row < CONFIG.SKY_HEIGHT) {
    return entranceCol;
  }
  // Wave parameters: amplitude of 6 cells, wavelength of 75 cells
  const amplitude = 6;
  const period = 75;
  const offset = amplitude * Math.sin(((row - CONFIG.SKY_HEIGHT) / period) * 2 * Math.PI);
  return Math.round(entranceCol + offset);
}

/**
 * Calculates the vertical row position of a horizontal corridor at a given column,
 * using a sine wave to wiggle the passage vertically.
 */
export function getPassageRow(col: number, pRow: number, entranceCol: number): number {
  const amplitude = 2.0; // 2 rows amplitude
  const period = 25; // 25 columns period
  const shaftCenter = getShaftCenterCol(pRow, entranceCol);
  const dist = Math.abs(col - shaftCenter);
  // Fade out wiggle close to the shaft connection to prevent step discontinuities
  const fade = Math.min(1.0, Math.max(0.0, (dist - 3) / 6));
  const offset = amplitude * Math.sin(((col - shaftCenter) / period) * 2 * Math.PI) * fade;
  return Math.round(pRow + offset);
}

/**
 * Evaluates whether a given grid cell (c, r) lies inside the boundaries of an excavation step,
 * incorporating wavy shaft and wiggling passage shapes.
 */
export function isCellInsidePlanStep(step: ExcavationStep, c: number, r: number): boolean {
  if (c < step.minCol || c > step.maxCol || r < step.minRow || r > step.maxRow) {
    return false;
  }

  const entranceCol = step.entranceCol !== undefined ? step.entranceCol : Math.floor(CONFIG.COLS / 2);

  // Shaft check: must be inside the wavy boundaries at row r
  if (step.name.includes('Shaft')) {
    const centerCol = getShaftCenterCol(r, entranceCol);
    if (c < centerCol - 2 || c > centerCol + 1) {
      return false;
    }
    return true;
  }

  // Passage or Link check: must be inside the wiggling boundaries at column c
  if (step.name.includes('Passage') || step.name.includes('Link')) {
    const baselineRow = step.baselineRow !== undefined ? step.baselineRow : Math.round((step.minRow + step.maxRow) / 2);
    const centerRow = getPassageRow(c, baselineRow, entranceCol);
    if (r < centerRow - 1 || r > centerRow + 1) {
      return false;
    }
    return true;
  }

  // Chamber or Annex check: round corners to make organic cavern shapes
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

/**
 * Procedurally generates a wavy, tiered excavation structure with organic corridors
 * and aligned chambers.
 */
export function generateProceduralNestPlan(entranceCol: number): ExcavationStep[] {
  const plan: ExcavationStep[] = [];
  let currentRow = STARTING_CHAMBER_CENTER_ROW + 4; // Start below the starting Queen's chamber
  
  // We procedurally generate 8 levels (tiers) of construction
  for (let L = 1; L <= 8; L++) {
    const startRow = currentRow;
    const endRow = Math.min(CONFIG.ROWS - 5, currentRow + 20);
    currentRow = endRow;
    
    // 1. Calculate enclosing bounding box for the wavy shaft segment
    let shaftMinCol = Infinity;
    let shaftMaxCol = -Infinity;
    for (let r = startRow; r <= endRow; r++) {
      const center = getShaftCenterCol(r, entranceCol);
      if (center - 2 < shaftMinCol) shaftMinCol = center - 2;
      if (center + 1 > shaftMaxCol) shaftMaxCol = center + 1;
    }

    plan.push({
      name: `Extend Shaft (Tier ${L})`,
      minCol: shaftMinCol,
      maxCol: shaftMaxCol,
      minRow: startRow,
      maxRow: endRow,
      entranceCol
    });
    
    // 2. Decide branching (0: Left only, 1: Right only, 2: Both sides)
    const layout = Math.floor(Math.random() * 3);
    const hasLeft = layout === 0 || layout === 2;
    const hasRight = layout === 1 || layout === 2;
    
    // Center the horizontal elements vertically inside the tier height
    const pRow = startRow + 10;
    const shaftCenter = getShaftCenterCol(pRow, entranceCol);
    
    if (hasLeft) {
      // Create left passage (3 cells high) wiggling vertically
      const pLen = 15 + Math.floor(Math.random() * 5); // passage length 15 to 19 cells
      const passMinC = Math.max(5, shaftCenter - pLen);
      const passMaxC = shaftCenter - 3;
      
      // Calculate enclosing bounding box for the wiggling passage
      let passMinRow = Infinity;
      let passMaxRow = -Infinity;
      for (let c = passMinC; c <= passMaxC; c++) {
        const rowCenter = getPassageRow(c, pRow, entranceCol);
        if (rowCenter - 1 < passMinRow) passMinRow = rowCenter - 1;
        if (rowCenter + 1 > passMaxRow) passMaxRow = rowCenter + 1;
      }

      plan.push({
        name: `Left Passage (Tier ${L})`,
        minCol: passMinC,
        maxCol: passMaxC,
        minRow: passMinRow,
        maxRow: passMaxRow,
        entranceCol,
        baselineRow: pRow
      });
      
      // Create left chamber (Nursery, aligned vertically to the end of the passage)
      const wiggledRow = getPassageRow(passMinC, pRow, entranceCol);
      const cWidth = 14 + Math.floor(Math.random() * 6);
      const cHeight = 7 + Math.floor(Math.random() * 2); // 7 or 8 cells high
      const chamMinC = Math.max(5, passMinC - cWidth);
      const chamMaxC = passMinC;
      const chamMinR = wiggledRow - Math.floor(cHeight / 2);
      const chamMaxR = chamMinR + cHeight - 1;
      
      plan.push({
        name: `Left Nursery Chamber (Tier ${L})`,
        minCol: chamMinC,
        maxCol: chamMaxC,
        minRow: chamMinR,
        maxRow: chamMaxR,
        entranceCol
      });
      
      // Chain a second chamber (Annex)? (40% chance)
      if (Math.random() < 0.40 && chamMinC > 30) {
        const chainPLen = 10 + Math.floor(Math.random() * 5);
        const chainMinC = Math.max(5, chamMinC - chainPLen);
        const chainMaxC = chamMinC - 1;
        
        // Calculate enclosing bounding box for the wiggling link corridor
        let linkMinRow = Infinity;
        let linkMaxRow = -Infinity;
        for (let c = chainMinC; c <= chainMaxC; c++) {
          const rowCenter = getPassageRow(c, wiggledRow, entranceCol);
          if (rowCenter - 1 < linkMinRow) linkMinRow = rowCenter - 1;
          if (rowCenter + 1 > linkMaxRow) linkMaxRow = rowCenter + 1;
        }

        plan.push({
          name: `Left Nursery Link (Tier ${L})`,
          minCol: chainMinC,
          maxCol: chainMaxC,
          minRow: linkMinRow,
          maxRow: linkMaxRow,
          entranceCol,
          baselineRow: wiggledRow
        });
        
        const wiggledAnnexRow = getPassageRow(chainMinC, wiggledRow, entranceCol);
        const chainCW = 12 + Math.floor(Math.random() * 5);
        const chainCH = 6 + Math.floor(Math.random() * 3);
        const chainChamMinC = Math.max(5, chainMinC - chainCW);
        const chainChamMaxC = chainMinC;
        const chainMinR = wiggledAnnexRow - Math.floor(chainCH / 2);
        const chainMaxR = chainMinR + chainCH - 1;
        
        plan.push({
          name: `Left Nursery Annex (Tier ${L})`,
          minCol: chainChamMinC,
          maxCol: chainChamMaxC,
          minRow: chainMinR,
          maxRow: chainMaxR,
          entranceCol
        });
      }
    }
    
    if (hasRight) {
      // Create right passage (3 cells high) wiggling vertically
      const pLen = 15 + Math.floor(Math.random() * 5);
      const passMinC = shaftCenter + 2;
      const passMaxC = Math.min(CONFIG.COLS - 6, shaftCenter + pLen);
      
      // Calculate enclosing bounding box for the wiggling passage
      let passMinRow = Infinity;
      let passMaxRow = -Infinity;
      for (let c = passMinC; c <= passMaxC; c++) {
        const rowCenter = getPassageRow(c, pRow, entranceCol);
        if (rowCenter - 1 < passMinRow) passMinRow = rowCenter - 1;
        if (rowCenter + 1 > passMaxRow) passMaxRow = rowCenter + 1;
      }

      plan.push({
        name: `Right Passage (Tier ${L})`,
        minCol: passMinC,
        maxCol: passMaxC,
        minRow: passMinRow,
        maxRow: passMaxRow,
        entranceCol,
        baselineRow: pRow
      });
      
      // Create right chamber (Larder, aligned vertically to the end of the passage)
      const wiggledRightRow = getPassageRow(passMaxC, pRow, entranceCol);
      const cWidth = 14 + Math.floor(Math.random() * 6);
      const cHeight = 7 + Math.floor(Math.random() * 2);
      const chamMinC = passMaxC;
      const chamMaxC = Math.min(CONFIG.COLS - 6, passMaxC + cWidth);
      const chamMinR = wiggledRightRow - Math.floor(cHeight / 2);
      const chamMaxR = chamMinR + cHeight - 1;
      
      plan.push({
        name: `Right Larder Chamber (Tier ${L})`,
        minCol: chamMinC,
        maxCol: chamMaxC,
        minRow: chamMinR,
        maxRow: chamMaxR,
        entranceCol
      });
      
      // Chain a second chamber (Annex)? (40% chance)
      if (Math.random() < 0.40 && chamMaxC < CONFIG.COLS - 30) {
        const chainPLen = 10 + Math.floor(Math.random() * 5);
        const chainMinC = chamMaxC + 1;
        const chainMaxC = Math.min(CONFIG.COLS - 6, chamMaxC + chainPLen);
        
        // Calculate enclosing bounding box for the wiggling link corridor
        let linkMinRow = Infinity;
        let linkMaxRow = -Infinity;
        for (let c = chainMinC; c <= chainMaxC; c++) {
          const rowCenter = getPassageRow(c, wiggledRightRow, entranceCol);
          if (rowCenter - 1 < linkMinRow) linkMinRow = rowCenter - 1;
          if (rowCenter + 1 > linkMaxRow) linkMaxRow = rowCenter + 1;
        }

        plan.push({
          name: `Right Larder Link (Tier ${L})`,
          minCol: chainMinC,
          maxCol: chainMaxC,
          minRow: linkMinRow,
          maxRow: linkMaxRow,
          entranceCol,
          baselineRow: wiggledRightRow
        });
        
        const wiggledRightAnnexRow = getPassageRow(chainMinC, wiggledRightRow, entranceCol);
        const chainCW = 12 + Math.floor(Math.random() * 5);
        const chainCH = 6 + Math.floor(Math.random() * 3);
        const chainChamMinC = chainMaxC;
        const chainChamMaxC = Math.min(CONFIG.COLS - 6, chainMaxC + chainCW);
        const chainMinR = wiggledRightAnnexRow - Math.floor(chainCH / 2);
        const chainMaxR = chainMinR + chainCH - 1;
        
        plan.push({
          name: `Right Larder Annex (Tier ${L})`,
          minCol: chainChamMinC,
          maxCol: chainChamMaxC,
          minRow: chainMinR,
          maxRow: chainMaxR,
          entranceCol
        });
      }
    }
  }
  
  return plan;
}
