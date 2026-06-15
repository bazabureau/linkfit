import path from "path";
import { fileURLToPath } from "url";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (phase) => {
  const isBuild = phase === PHASE_PRODUCTION_BUILD;
  return {
    basePath: "/owner",
    assetPrefix: "/owner",
    reactStrictMode: true,
    env: {
      IS_BUILD_PHASE: isBuild ? "true" : "false",
    },
  };
};

