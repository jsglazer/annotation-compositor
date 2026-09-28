import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/update.json`,
  // Releases here are tagged with the bare version (e.g. `1.0.11`, no `v`),
  // so the update manifest's download link must match or Zotero's update 404s.
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        bundle: true,
        // Zotero 7 ships Firefox 115 ESR; native ESM and async/await only.
        target: "firefox115",
        format: "iife",
        outfile: `build/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
  },
});
