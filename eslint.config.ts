import { defineConfig, globalIgnores } from "eslint/config";
import jsPlugin from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import typeScriptPlugin from "typescript-eslint";

export default defineConfig([
  globalIgnores([".next/", "docs/", "vendor/"]),
  jsPlugin.configs.recommended,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat["jsx-runtime"],
  reactHooksPlugin.configs.flat.recommended,
  typeScriptPlugin.configs.recommended,
  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/prop-types": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: "^",
        },
      ],
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
    },
  },
]);
