import { GroveManager } from '../services/groveManager';

export async function refreshGroves(groveManager: GroveManager): Promise<void> {
  await groveManager.refresh();
}
