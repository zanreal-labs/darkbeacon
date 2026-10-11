// Use cases: plain classes taking ports in the constructor. Each authorizes the actor,
// changes state through ports and appends events inside one UnitOfWork transaction.
export * from './notifier-registry.js';
export * from './webhook-admin.js';
export * from './webhook-dispatcher.js';
