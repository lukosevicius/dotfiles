// Shared configuration for WordPress category/product export/import tools
// TIP: Move sensitive data to .env in production

export interface Config {
  // Common settings
  mainLanguage: string;
  otherLanguages: string[];

  // Export settings
  exportBaseUrl: string;
  exportUsername: string;
  exportPassword: string;
  outputDir: string;
  perPage: number;

  // Import settings
  importBaseUrl: string;
  importUsername: string;
  importPassword: string;
  inputFile: string;
  skipExisting: boolean;
}

const config: Config = {
  // Common settings
  mainLanguage: "lt",
  otherLanguages: ["en", "lv", "ru", "de"],

  // Export settings
  exportBaseUrl: "http://7in-with-products.local",
  exportUsername: "mantas",
  exportPassword: "gGnU l862 pwyy 0GZh YATr kO4H",
  outputDir: "/Users/mantas/Downloads/export",
  perPage: 100, // Number of items per page (max 100 for WooCommerce API)

  // Import settings
  importBaseUrl: "http://7in-blocksy.local",
  importUsername: "mantas",
  importPassword: "sGse G7ll Hd6Z kToQ 8bXK VePC",
  inputFile: "/Users/mantas/Downloads/export/exported-categories.json",
  skipExisting: true, // Skip categories that already exist
};

export default config;
