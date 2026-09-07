import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/update.json`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

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
