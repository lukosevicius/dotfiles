import path from 'path';

// Define default paths
export const DEFAULT_PATHS = {
  outputDir: path.join(__dirname, '..', 'export'),
  categoriesFile: 'exported-categories.json',
  productsFile: 'exported-products.json',
  tempImagesDir: 'temp_images',
  webpImagesDir: 'webp_images',
};
