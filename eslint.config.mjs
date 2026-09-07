import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["build/**", "node_modules/**", "NewBuild/**", ".scaffold/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.ts"],
    rules: {
      // The pure core and the adapters are typed end to end; `any` is banned by
      // the standing conventions, and unused symbols are build noise.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // bootstrap.js and prefs.js are loaded by Zotero, not imported: their
    // top-level functions and pref() globals only look unused from here.
    files: ["addon/**/*.js"],
    languageOptions: { sourceType: "script" },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
