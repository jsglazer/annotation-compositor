/**
 * Bundle entry point. `bootstrap.js` loads the built script into the plugin
 * sandbox and calls these hooks; nothing here runs at import time.
 */
import {
  getAddon,
  onMainWindowLoad,
  onMainWindowUnload,
  onRestoreFromPrefs,
  onShutdown,
  onStartup,
} from "./hooks.js";

const instance = {
  hooks: {
    onStartup,
    onShutdown,
    onMainWindowLoad,
    onMainWindowUnload,
    onRestoreFromPrefs,
  },
  getAddon,
};

// Published on the Zotero object so bootstrap.js (plain JS, no bundler) and
// Tools -> Developer -> Run JavaScript can reach the plugin.
(Zotero as unknown as Record<string, unknown>).AnnotationCompositor = instance;

export default instance;
export { onStartup, onShutdown, onMainWindowLoad, onMainWindowUnload, getAddon };
