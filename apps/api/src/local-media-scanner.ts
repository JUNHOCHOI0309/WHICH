import { scanLocalImage, localScanResources } from "./modules/issue-media/local-scan-engine.js";
import {
  incompleteLocalScan,
  LOCAL_SCAN_MAX_BYTES,
  LOCAL_SCAN_VERSION,
} from "./modules/issue-media/local-scan-contract.js";

async function main() {
  if (process.argv[2] === "diagnose") {
    const resources = await localScanResources();
    return {
      detectorVersion: LOCAL_SCAN_VERSION,
      localResourcesAvailable: resources.length === 3,
      languages: ["eng", "kor"],
      externalRequests: false,
      visualSupported: false,
    };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array);
    total += bytes.length;
    if (total > LOCAL_SCAN_MAX_BYTES) return incompleteLocalScan("INPUT_LIMIT");
    chunks.push(bytes);
  }
  return scanLocalImage(Buffer.concat(chunks));
}
main().then(
  (result) => process.stdout.write(JSON.stringify(result)),
  () => {
    process.stdout.write(JSON.stringify(incompleteLocalScan("ENGINE_FAILURE")));
    process.exitCode = 1;
  },
);
