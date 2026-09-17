import { readFile, readdir } from "node:fs/promises";

const profilesDirectory = new URL("./", import.meta.url);
const profileIdPattern = /^[a-z][a-z0-9-]{1,31}$/;
const cache = new Map();

function validateProfileConfig(config, requestedId) {
  if (!config || typeof config !== "object") throw new Error(`Perfil visual inválido: ${requestedId}.`);
  if (config.id !== requestedId) throw new Error(`O perfil '${requestedId}' possui um identificador divergente.`);
  if (typeof config.displayName !== "string" || !config.displayName.trim()) throw new Error(`Nome ausente no perfil '${requestedId}'.`);
  if (!config.brand || typeof config.brand !== "object") throw new Error(`Paleta ausente no perfil '${requestedId}'.`);
  for (const color of ["primary", "secondary", "background", "surface", "text"]) {
    if (!/^#[0-9a-f]{6}$/i.test(config.brand[color] || "")) throw new Error(`Cor '${color}' inválida no perfil '${requestedId}'.`);
  }
}

export async function loadDocumentProfile(id) {
  const profileId = typeof id === "string" ? id.trim().toLowerCase() : "";
  if (!profileIdPattern.test(profileId)) throw new Error("Identificador de perfil visual inválido.");
  if (cache.has(profileId)) return cache.get(profileId);

  const directory = new URL(`${profileId}/`, profilesDirectory);
  try {
    const [configText, css, logoSvg] = await Promise.all([
      readFile(new URL("profile.json", directory), "utf8"),
      readFile(new URL("styles.css", directory), "utf8"),
      readFile(new URL("assets/logo.svg", directory), "utf8"),
    ]);
    const config = JSON.parse(configText);
    validateProfileConfig(config, profileId);
    const profile = Object.freeze({ ...config, css, logoSvg });
    cache.set(profileId, profile);
    return profile;
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Perfil visual não cadastrado: ${profileId}.`);
    throw error;
  }
}

export async function documentProfileCatalog() {
  const entries = await readdir(profilesDirectory, { withFileTypes: true });
  const profiles = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory() && profileIdPattern.test(candidate.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const profile = await loadDocumentProfile(entry.name);
    profiles.push({ id: profile.id, displayName: profile.displayName, version: profile.version || "1.0.0" });
  }
  return profiles;
}
