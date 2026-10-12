# Plugins and themes

First-party packages. They form the catalogue an admin installs from (`catalog:<folder>`), and
each plugin is built against `@darkbeacon/plugin-sdk` only.

| Folder           | What it shows                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `discord-notify` | On by default: a durable consumer, own tables (`db`), the `discord` bot port, HTTP routes for the map Notifications tab, a `Notifier` |
| `sample-widget`  | A web part in the `widget` slot, an HTTP route, an event subscriber with local state                                                  |
| `theme-amarr`    | A theme package: a manifest and token overrides, no code                                                                              |

## Writing a plugin

A plugin is an npm package (or a `.tgz`) with `darkbeacon-plugin.json` at its root:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "sdk": "^1.0",
  "server": "dist/server.js",
  "web": "dist/web.js",
  "ports": ["maps", "clock"],
  "events": ["system.*"],
  "settings": "settings.schema.json",
  "migrations": "migrations"
}
```

- `ports` and `events` are the plugin's permissions: `register(ctx)` receives only those ports,
  and `ctx.on()` refuses event types the manifest does not list. Admins see both before enabling.
- Entries run from `DATA_DIR/plugins/<id>`, where no packages are installed. Bundle your
  dependencies, and import the SDK with `import type` (its helpers are identity functions).
- The server entry's default export has `register(ctx)` and optionally `dispose()`.
- The web entry is loaded by the browser as an ES module. Its default export has
  `register(api)`; render with `api.react.createElement` and the hooks on `api.react`, never a
  React copy of your own.
- `migrations/NNNN_name.js` export `up(db)` (Kysely). Name tables `<id>_<table>` with dashes as
  underscores. Each file runs once and is recorded as `<id>/<file>`.
- Errors are caught by the core. Five failures in a row (handlers, routes, notifiers) or a failing
  `register()` disable the plugin, and the reason shows in the admin panel.
- A new version replaces the files and the plugin is reloaded in place; settings and enablement
  are kept.

## Writing a theme

A theme package has `darkbeacon-theme.json` with `id`, `name`, `version`, `colorScheme`
(`light`/`dark`), `extends` (a built-in theme: `default`, `dark`, `contrast`) and `tokens`, a map of
token names from `@darkbeacon/theme-sdk` to CSS values. No code is loaded.
