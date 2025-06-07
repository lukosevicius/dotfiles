// Utility functions for working with configuration
import fs from "fs";
import path from "path";
import config, { SiteProfile } from "../config";

// Define environment settings interface
export interface EnvSettings {
  lastExportSite: string;
  lastImportSite: string;
}

// Path to environment settings file
const ENV_FILE_PATH = path.join(__dirname, "..", ".env.json");

// Default environment settings
const defaultEnv: EnvSettings = {
  lastExportSite: "Default", // Default site for export operations
  lastImportSite: "Default", // Default site for import operations
};

/**
 * Load environment settings from file or use defaults
 */
export function loadEnvSettings(): EnvSettings {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const envData = fs.readFileSync(ENV_FILE_PATH, "utf8");
      return JSON.parse(envData);
    }
  } catch (error) {
    console.warn("Error loading environment settings:", error);
  }
  return defaultEnv;
}

/**
 * Save environment settings to file
 */
export function saveEnvSettings(env: EnvSettings): void {
  try {
    fs.writeFileSync(ENV_FILE_PATH, JSON.stringify(env, null, 2));
  } catch (error) {
    console.warn("Error saving environment settings:", error);
  }
}

/**
 * Get a site profile by name
 * @param name - Site profile name
 * @returns The site profile or undefined if not found
 */
export function getSiteByName(name: string): SiteProfile | undefined {
  return config.sites.find(
    (site) => site.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get a site profile by index
 * @param index - Site profile index
 * @returns The site profile or undefined if not found
 */
export function getSiteByIndex(index: number): SiteProfile | undefined {
  return config.sites[index];
}

/**
 * Get the export site profile
 * @returns The export site profile
 */
export function getExportSite(): SiteProfile {
  const env = loadEnvSettings();
  const site = getSiteByName(env.lastExportSite);
  if (!site) {
    // Fallback to first site if the saved one doesn't exist
    return config.sites[0];
  }
  return site;
}

/**
 * Get the import site profile
 * @returns The import site profile
 */
export function getImportSite(): SiteProfile {
  const env = loadEnvSettings();
  const site = getSiteByName(env.lastImportSite);
  if (!site) {
    // Fallback to first site if the saved one doesn't exist
    return config.sites[0];
  }
  return site;
}

/**
 * Set the export site by name or index
 * @param nameOrIndex - Site name (string) or index (number)
 * @returns The newly set export site or undefined if not found
 */
export function setExportSite(
  nameOrIndex: string | number
): SiteProfile | undefined {
  let site: SiteProfile | undefined;

  if (typeof nameOrIndex === "number") {
    site = getSiteByIndex(nameOrIndex);
  } else {
    site = getSiteByName(nameOrIndex);
  }

  if (site) {
    const env = loadEnvSettings();
    env.lastExportSite = site.name;
    saveEnvSettings(env);
    return site;
  }

  return undefined;
}

/**
 * Set the import site by name or index
 * @param nameOrIndex - Site name (string) or index (number)
 * @returns The newly set import site or undefined if not found
 */
export function setImportSite(
  nameOrIndex: string | number
): SiteProfile | undefined {
  let site: SiteProfile | undefined;

  if (typeof nameOrIndex === "number") {
    site = getSiteByIndex(nameOrIndex);
  } else {
    site = getSiteByName(nameOrIndex);
  }

  if (site) {
    const env = loadEnvSettings();
    env.lastImportSite = site.name;
    saveEnvSettings(env);
    return site;
  }

  return undefined;
}

/**
 * List all available sites
 * @returns Array of site information
 */
export function listSites(): {
  index: number;
  name: string;
  description?: string;
}[] {
  return config.sites.map((site, index) => ({
    index,
    name: site.name,
    description: site.description,
  }));
}

// Helper functions to access site properties

export function getMainLanguage(): string {
  return getExportSite().mainLanguage;
}

export function getOtherLanguages(): string[] {
  return getExportSite().otherLanguages;
}

export function getExportBaseUrl(): string {
  return getExportSite().baseUrl;
}

export function getExportCredentials(): { username: string; password: string } {
  const site = getExportSite();
  return {
    username: site.username,
    password: site.password,
  };
}

export function getImportBaseUrl(): string {
  return getImportSite().baseUrl;
}

export function getImportCredentials(): { username: string; password: string } {
  const site = getImportSite();
  return {
    username: site.username,
    password: site.password,
  };
}
