import { defineConfig } from "vitest/config";

// Unit tests for the pure logic (parsing, id generation). Route/integration tests
// via the Workers test pool are a future add — the current pool/vitest combo is unstable.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
