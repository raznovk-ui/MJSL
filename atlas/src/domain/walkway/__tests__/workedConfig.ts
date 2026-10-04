import rawConfig from "../walkway.config.json";
import { validateWalkwayConfig } from "../loadConfig.js";

/**
 * The live config with the three-dimension weights the hand-worked example was
 * calculated with. The real weights are meant to be edited, so the worked numbers
 * (checked by hand in the README) must not depend on them.
 */
const raw = JSON.parse(JSON.stringify(rawConfig));
raw.profiles.wheelchair.weights = { physical: 0.6, sensory: 0.1, economic: 0.3 };
raw.profiles.blind.weights = { physical: 0.3, sensory: 0.5, economic: 0.2 };
export const WORKED_CONFIG = validateWalkwayConfig(raw);
