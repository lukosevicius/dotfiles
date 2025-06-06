// Shared configuration for WordPress category export/import tools
// TIP: Move sensitive data to .env in production

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
      baseUrl: "http://localhost:10023",
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
      baseUrl: "http://localhost:10018",
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

  // Environment settings (default values)
  env: {
    lastExportSite: "Old-7IN",
    lastImportSite: "7IN",
  },
};

export default config;
