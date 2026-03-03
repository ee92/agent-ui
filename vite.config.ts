import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

type TestConfig = {
  test: {
    environment: "node";
    setupFiles: string[];
    exclude: string[];
  };
};

const config = {
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173 },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  }
} satisfies UserConfig & TestConfig;

export default defineConfig(config);
