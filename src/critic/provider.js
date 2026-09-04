import { generateCriticText } from "../antigravity/client.js";

const antigravityProvider = Object.freeze({
  name: "antigravity",
  generate: generateCriticText
});

export function getCriticProvider() {
  return antigravityProvider;
}
