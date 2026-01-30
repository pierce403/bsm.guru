// Vitest runs outside Next.js' module graph, so `import "server-only"` won't
// resolve. This shim keeps unit tests happy without changing runtime behavior.
export {};

