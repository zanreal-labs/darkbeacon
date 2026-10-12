import type { JumpSpaceData } from '../domain/index.js';

/** The k-space dataset (packages/sde `data/kspace.json`, or an operator's copy in DATA_DIR). */
export interface JumpSpaceSource {
  /** A short hash of the dataset; changes with every new build of it. */
  version: string;
  data: JumpSpaceData;
}
