// Shared configuration for WordPress category export/import tools
// TIP: Move sensitive data to .env in production
import fs from "fs";
import path from "path";

/**
 * Site profile interface - represents a single WordPress site
 */
export interface SiteProfile {
  // Profile identification
  name: string;
  description?: string;

  // Site settings
  baseUrl: string;
  username: string;
  password: string;

  // Language settings
  mainLanguage: string;
  otherLanguages: string[];
}

/**
 * Environment settings interface - stores last used export/import sites
 */
export interface EnvSettings {
  lastExportSite: string;
  lastImportSite: string;
}

/**
 * Main configuration interface
 */
export interface Config {
  // Global settings
  outputDir: string;
  inputFile: string;
  perPage: number;
  skipExisting: boolean;

  // Site profiles
  sites: SiteProfile[];

  // Environment settings
  env: EnvSettings;
}

// Path to environment settings file
const ENV_FILE_PATH = path.join(__dirname, ".env.json");

// Default environment settings
const defaultEnv: EnvSettings = {
  lastExportSite: "Default", // Default site for export operations
  lastImportSite: "Default", // Default site for import operations
};

// Load environment settings from file or use defaults
function loadEnvSettings(): EnvSettings {
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

// Main configuration
const config: Config = {
  // Global settings
  outputDir: "/Users/mantas/files/export",
  inputFile: "/Users/mantas/files/export/exported-categories.json",
  perPage: 100, // Number of items per page (max 100 for WooCommerce API)
  skipExisting: true, // Skip categories that already exist

  // Site profiles
  sites: [
    {
      name: "7IN",
      description: "New-7IN",
      baseUrl: "http://7in.local",
      username: "mantas",
      password: "qbvD 5eqy VCyc XuxK ghja mM6Y",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
    {
      name: "7in-with-products",
      baseUrl: "http://7in-with-products.local",
      username: "mantas",
      password: "gGnU l862 pwyy 0GZh YATr kO4H",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
    {
      name: "Blocksy",
      baseUrl: "http://7in-blocksy.local",
      username: "mantas",
      password: "sGse G7ll Hd6Z kToQ 8bXK VePC",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
    {
      name: "Old-7IN",
      baseUrl: "http://7in-old.local/",
      username: "sandelis",
      password: "hdzH LSwN TKF0 UoYM PVhL tHDh",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
    {
      name: "Staging",
      description: "Staging environment",
      baseUrl: "https://staging.example.com",
      username: "staging_user",
      password: "staging_password",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
    {
      name: "Production",
      description: "Production environment",
      baseUrl: "https://7ievosnamai.lt/",
      username: "sandelis",
      password: "LeMG ASCN ksTJ jGgs L4Bj 4fiv",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
  ],

  // Environment settings (loaded from file)
  env: loadEnvSettings(),
};

/**
 * Save environment settings to file
 */
function saveEnvSettings(): void {
  try {
    fs.writeFileSync(ENV_FILE_PATH, JSON.stringify(config.env, null, 2));
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
  const site = getSiteByName(config.env.lastExportSite);
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
  const site = getSiteByName(config.env.lastImportSite);
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
    config.env.lastExportSite = site.name;
    saveEnvSettings();
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
    config.env.lastImportSite = site.name;
    saveEnvSettings();
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

export default config;
