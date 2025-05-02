// Shared configuration for WordPress category export/import tools
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
  exportBaseUrl: "http://localhost:10009",
  exportUsername: "mantas",
  exportPassword: "SxTp K7LH LVwx 7eUr Y1Mq OSdE",
  outputDir: "/Users/mantas/Downloads/export",
  perPage: 100, // Number of items per page (max 100 for WooCommerce API)
  
  // Import settings
  importBaseUrl: "http://localhost:10038",
  importUsername: "mantas",
  importPassword: "MKe1 Cgcy y40g Bqse 2t60 WAzb",
  inputFile: "/Users/mantas/Downloads/export/exported-categories.json",
  skipExisting: true, // Skip categories that already exist
};

export default config;
