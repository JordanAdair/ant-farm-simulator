import { describe, it, expect } from 'vitest';
import { WorldGrid } from './Grid';
import { CONFIG } from './types';

describe('Water Physics CA Rules', () => {
  it('should fall directly downward if there is NestAir or Sky below', () => {
    const grid = new WorldGrid();
    
    // Set a cell to Water and the cell below to NestAir
    const col = 200;
    const row = CONFIG.SKY_HEIGHT + 10;
    
    grid.setCellType(col, row, 'Water');
    grid.setCellType(col, row + 1, 'NestAir');
    
    // Run water update
    grid.updateWater();
    
    // Expect water to have moved down
    expect(grid.getCell(col, row)?.type).toBe('NestAir');
    expect(grid.getCell(col, row + 1)?.type).toBe('Water');
  });

  it('should slide diagonally if directly below is blocked but diagonals are open', () => {
    const grid = new WorldGrid();
    
    const col = 200;
    const row = CONFIG.SKY_HEIGHT + 10;
    
    grid.setCellType(col, row, 'Water');
    grid.setCellType(col, row + 1, 'Dirt'); // Blocked directly below
    grid.setCellType(col - 1, row + 1, 'NestAir'); // Open diagonal left
    grid.setCellType(col + 1, row + 1, 'NestAir'); // Open diagonal right
    
    // Run water update
    grid.updateWater();
    
    // Expect water to have moved to one of the diagonals and left the original cell
    expect(grid.getCell(col, row)?.type).toBe('NestAir');
    const diagLeft = grid.getCell(col - 1, row + 1)?.type === 'Water';
    const diagRight = grid.getCell(col + 1, row + 1)?.type === 'Water';
    expect(diagLeft || diagRight).toBe(true);
  });

  it('should flow laterally if downward and diagonals are blocked', () => {
    const grid = new WorldGrid();
    
    const col = 200;
    const row = CONFIG.SKY_HEIGHT + 10;
    
    grid.setCellType(col, row, 'Water');
    grid.setCellType(col, row + 1, 'Dirt'); // Blocked directly below
    grid.setCellType(col - 1, row + 1, 'Dirt'); // Blocked diag left
    grid.setCellType(col + 1, row + 1, 'Dirt'); // Blocked diag right
    grid.setCellType(col - 1, row, 'NestAir'); // Open left
    grid.setCellType(col + 1, row, 'NestAir'); // Open right
    
    // Run water update
    grid.updateWater();
    
    // Expect water to have flowed to one of the lateral cells
    expect(grid.getCell(col, row)?.type).toBe('NestAir');
    const movedLeft = grid.getCell(col - 1, row)?.type === 'Water';
    const movedRight = grid.getCell(col + 1, row)?.type === 'Water';
    expect(movedLeft || movedRight).toBe(true);
  });
});
