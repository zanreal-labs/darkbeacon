// import-in-the-middle ships `register-hooks.d.ts` next to `register-hooks.mjs`, which NodeNext
// resolution does not pick up for an `.mjs` specifier (it looks for `.d.mts`).
declare module 'import-in-the-middle/register-hooks.mjs' {
  export interface RegisterHooksOptions {
    include?: Array<string | RegExp>;
    exclude?: Array<string | RegExp>;
    disableCjsSourceStripping?: boolean;
  }
  /** In-thread loader hooks through `module.registerHooks()`. */
  export function register(options?: RegisterHooksOptions): void;
  export function supportsSyncHooks(): boolean;
}
