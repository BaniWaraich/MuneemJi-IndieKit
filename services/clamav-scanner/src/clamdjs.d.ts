// Ambient types for clamdjs (no @types package published).
// Only the surface we actually use is declared — keep this in sync with
// scanner.ts. clamdjs ships as CommonJS; esModuleInterop is on, so a
// default import works.

declare module "clamdjs" {
  import type { Readable } from "node:stream";

  export interface Scanner {
    scanStream(stream: Readable, timeoutMs: number): Promise<string>;
    scanBuffer(buffer: Buffer, timeoutMs: number): Promise<string>;
  }

  export function createScanner(host: string, port: number): Scanner;
  export function ping(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<boolean>;
  export function isCleanReply(reply: string): boolean;
  export function isInfectedReply(reply: string): boolean;

  const _default: {
    createScanner: typeof createScanner;
    ping: typeof ping;
    isCleanReply: typeof isCleanReply;
    isInfectedReply: typeof isInfectedReply;
  };
  export default _default;
}
