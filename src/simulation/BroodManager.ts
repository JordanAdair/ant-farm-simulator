import { CONFIG } from './types';
import type { Brood, Position } from './types';

export class BroodManager {
  public broodList: Brood[] = [];
  public nurseryCapacity: number = 15;

  constructor() {}

  public update(
    dt: number,
    hatchAnt: (x: number, y: number) => void,
    addLog: (msg: string, cat: 'system' | 'births' | 'deaths') => void
  ): void {
    for (let i = this.broodList.length - 1; i >= 0; i--) {
      const brood = this.broodList[i];
      
      if (brood.type === 'Egg') {
        brood.progress += (100 / CONFIG.EGG_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          brood.type = 'Larva';
          brood.progress = 0;
          brood.needsFood = true;
          addLog('An egg hatched into a hungry larva.', 'births');
        }
      } else if (brood.type === 'Larva') {
        if (!brood.needsFood) {
          brood.progress += (100 / CONFIG.LARVA_GROWTH_TIME / 60) * dt;
          if (brood.progress >= 100) {
            brood.type = 'Pupa';
            brood.progress = 0;
            addLog('A larva spun a silk cocoon and entered pupation.', 'births');
          }
          if (Math.random() < 0.002 * dt) {
            brood.needsFood = true;
          }
        }
      } else if (brood.type === 'Pupa') {
        brood.progress += (100 / CONFIG.PUPA_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          hatchAnt(brood.x, brood.y);
          this.broodList.splice(i, 1);
          continue;
        }
      }
    }
  }

  public getNurseryOccupancy(nursery: Position): number {
    return this.broodList.filter(b => {
      if (b.beingCarried) return false;
      const dx = b.x - nursery.x;
      const dy = b.y - nursery.y;
      return Math.sqrt(dx * dx + dy * dy) < 40; // nursery chamber radius is 40px
    }).length;
  }

  public isNurseryFull(nursery: Position): boolean {
    return this.getNurseryOccupancy(nursery) >= this.nurseryCapacity;
  }

  public isNurseryCrowded(nursery: Position): boolean {
    return this.getNurseryOccupancy(nursery) >= Math.floor(this.nurseryCapacity * 0.8);
  }

  public getAvailableNursery(nurseries: Position[]): Position | null {
    const valid = nurseries.filter(n => !this.isNurseryFull(n));
    if (valid.length === 0) return null;
    return valid.sort((a, b) => this.getNurseryOccupancy(a) - this.getNurseryOccupancy(b))[0];
  }
}
