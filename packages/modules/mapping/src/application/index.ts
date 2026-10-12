// Use cases: plain classes taking ports in the constructor. Each authorizes the actor,
// changes state through ports and appends events inside one UnitOfWork transaction.
export { EventBatch, MappingUseCases, type MappingPorts } from './base.js';
export * from './bookmark-numbers.js';
export * from './connections.js';
export * from './intel.js';
export * from './maps.js';
export * from './passages.js';
export * from './preferences.js';
export * from './signatures.js';
export * from './snapshot.js';
export * from './sweeper.js';
export { SystemUseCases } from './systems.js';
export * from './overlay.js';
export * from './export.js';
export * from './batch.js';
