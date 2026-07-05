import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CommonJS server-side code (not part of the Next bundle):
    "server.js",
    "lib/game.js",
    "lib/bot.js",
  ]),
  {
    rules: {
      // This is a real-time game: state is synced from socket events and
      // transient visual state (snap rings, timers, confetti) is derived in
      // effects on purpose. The compiler-strict variants of these rules flag
      // those patterns, so keep them off here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
