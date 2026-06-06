import { describe, it, expect } from 'vitest';
import { generateProceduralNestPlan, isCellInsidePlanStep, getShaftCenterCol, getPassageRow } from './NestPlanner';
import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';

describe('NestPlanner', () => {
  const entranceCol = Math.floor(CONFIG.COLS / 2);

  describe('getShaftCenterCol', () => {
    it('should return entranceCol at surface height', () => {
      const col = getShaftCenterCol(CONFIG.SKY_HEIGHT, entranceCol);
      expect(col).toBe(entranceCol);
    });

    it('should return value within amplitude limit below surface', () => {
      for (let r = CONFIG.SKY_HEIGHT; r < CONFIG.ROWS; r += 5) {
        const col = getShaftCenterCol(r, entranceCol);
        expect(col).toBeGreaterThanOrEqual(entranceCol - 6);
        expect(col).toBeLessThanOrEqual(entranceCol + 6);
      }
    });

    it('should weave left and right', () => {
      const values = Array.from({ length: 80 }, (_, i) => 
        getShaftCenterCol(CONFIG.SKY_HEIGHT + i, entranceCol)
      );
      const uniqueValues = new Set(values);
      // It must have multiple values indicating waviness
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe('getPassageRow', () => {
    it('should not wiggle close to the shaft connection', () => {
      const pRow = CONFIG.SKY_HEIGHT + 35;
      const shaftCenter = getShaftCenterCol(pRow, entranceCol);
      
      // Right next to the shaft, fade-out should make offset 0
      const rowAdjacent = getPassageRow(shaftCenter - 3, pRow, entranceCol);
      expect(rowAdjacent).toBe(pRow);
    });

    it('should wiggle within limits farther away from the shaft', () => {
      const pRow = CONFIG.SKY_HEIGHT + 35;
      const shaftCenter = getShaftCenterCol(pRow, entranceCol);
      const rowFar = getPassageRow(shaftCenter - 20, pRow, entranceCol);
      expect(rowFar).toBeGreaterThanOrEqual(pRow - 2);
      expect(rowFar).toBeLessThanOrEqual(pRow + 2);
    });
  });

  describe('generateProceduralNestPlan', () => {
    it('should generate multiple steps including shafts, passages and chambers', () => {
      const plan = generateProceduralNestPlan(entranceCol);
      expect(plan.length).toBeGreaterThan(0);
      
      const stepNames = plan.map(s => s.name);
      expect(stepNames.some(name => name.includes('Shaft'))).toBe(true);
      expect(stepNames.some(name => name.includes('Passage'))).toBe(true);
      expect(stepNames.some(name => name.includes('Chamber'))).toBe(true);
    });

    it('should include entranceCol and baselineRow where appropriate', () => {
      const plan = generateProceduralNestPlan(entranceCol);
      for (const step of plan) {
        expect(step.entranceCol).toBe(entranceCol);
        if (step.name.includes('Passage') || step.name.includes('Link')) {
          expect(step.baselineRow).toBeDefined();
        }
      }
    });
  });

  describe('isCellInsidePlanStep', () => {
    it('should check wavy shaft cells correctly', () => {
      const step = {
        name: 'Extend Shaft (Tier 1)',
        minCol: entranceCol - 8,
        maxCol: entranceCol + 8,
        minRow: STARTING_CHAMBER_CENTER_ROW + 7,
        maxRow: STARTING_CHAMBER_CENTER_ROW + 27,
        entranceCol
      };

      const testRow = STARTING_CHAMBER_CENTER_ROW + 17;
      const center = getShaftCenterCol(testRow, entranceCol);

      // Center cells should be inside
      expect(isCellInsidePlanStep(step, center, testRow)).toBe(true);
      expect(isCellInsidePlanStep(step, center - 2, testRow)).toBe(true);
      expect(isCellInsidePlanStep(step, center + 1, testRow)).toBe(true);

      // Cells outside wavy width should be outside
      expect(isCellInsidePlanStep(step, center - 3, testRow)).toBe(false);
      expect(isCellInsidePlanStep(step, center + 2, testRow)).toBe(false);
    });
  });
});
