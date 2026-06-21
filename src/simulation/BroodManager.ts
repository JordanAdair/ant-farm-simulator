import { CONFIG } from './types';
import type { Brood } from './types';

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
}
