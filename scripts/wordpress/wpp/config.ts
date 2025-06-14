// Shared configuration for WordPress category export/import tools
// TIP: Move sensitive data to .env in production
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

// Environment settings are now defined in utils/config-utils.ts

/**
 * Main configuration interface
 */
export interface Config {
  // Global settings
  perPage: number;
  skipExisting: boolean;

  // Site profiles
  sites: SiteProfile[];
}

// Main configuration
const config: Config = {
  // Global settings
  perPage: 100, // Number of items per page (max 100 for WooCommerce API)
  skipExisting: true, // Skip categories that already exist

  // Site profiles
  sites: [
    {
      name: "new",
      baseUrl: "http://wpml-woo-mnt-blocksy.local",
      username: "mantas",
      password: "3AMD VxIA FKiY p9Su LVpr 4hUo",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
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
      password: "jKNg FC8o Cd0y 4M5g FXuR SbqY",
      mainLanguage: "lt",
      otherLanguages: ["en", "lv", "ru", "de"],
    },
  ],
};

export default config;
