import { helloWorld } from "./hello-world";
import { expireCredits } from "./expire-credits";
import { statementExtract } from "./statement-extract";
import { statementInterpret } from "./statement-interpret";
import { scanOrchestrator } from "./scan-orchestrator";
import { scanRetry } from "./scan-retry";

// TIP: Add your functions here, failing this will result in function not being registered
export const functions = [
  helloWorld,
  expireCredits,
  statementExtract,
  statementInterpret,
  scanOrchestrator,
  scanRetry,
];
