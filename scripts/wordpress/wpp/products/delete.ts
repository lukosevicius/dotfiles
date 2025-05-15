import fetch from "node-fetch";
import config from "../shared/config";
import chalk from "chalk";
import { fetchJSON } from "../shared/utils/api";

// Check if --confirm flag is provided
const shouldConfirm = !process.argv.includes("--confirm");

async function deleteAllProducts(): Promise<void> {
  if (shouldConfirm) {
    console.log(chalk.red.bold("⚠️ WARNING: This will delete ALL products from the WordPress site!"));
    console.log(chalk.yellow("Run with --confirm flag to skip this confirmation."));
    console.log(chalk.yellow("Press Ctrl+C to cancel or wait 5 seconds to continue..."));
    
    // Wait for 5 seconds to allow cancellation
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log(chalk.cyan(`🔄 Connecting to: ${config.importBaseUrl}`));
  
  try {
    // First, get all products
    console.log(chalk.cyan("📋 Fetching product list..."));
    
    const products = await fetchAllProducts();
    
    if (products.length === 0) {
      console.log(chalk.yellow("No products found to delete."));
      return;
    }
    
    console.log(chalk.yellow(`Found ${products.length} products to delete.`));
    
    // Delete each product
    let deleted = 0;
    let failed = 0;
    
    for (const product of products) {
      try {
        await deleteProduct(product.id);
        console.log(chalk.green(`✓ Deleted product: ${product.name} (ID: ${product.id})`));
        deleted++;
      } catch (error) {
        console.error(chalk.red(`✗ Failed to delete product: ${product.name} (ID: ${product.id})`), error);
        failed++;
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(chalk.green.bold(`\n✓ Deletion complete!`));
    console.log(chalk.cyan(`Total products processed: ${products.length}`));
    console.log(chalk.green(`Successfully deleted: ${deleted}`));
    
    if (failed > 0) {
      console.log(chalk.red(`Failed to delete: ${failed}`));
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Error during product deletion:"), error);
    process.exit(1);
  }
}

async function fetchAllProducts(): Promise<any[]> {
  let page = 1;
  let allProducts: any[] = [];
  let hasMorePages = true;
  
  while (hasMorePages) {
    const url = `${config.importBaseUrl}/wp-json/wc/v3/products?per_page=${config.perPage}&page=${page}`;
    
    try {
      const products = await fetchJSON(url);
      
      if (products.length === 0) {
        hasMorePages = false;
      } else {
        allProducts = [...allProducts, ...products];
        console.log(chalk.dim(`Fetched page ${page} (${products.length} products)`));
        page++;
      }
    } catch (error) {
      console.error(chalk.red(`Error fetching products page ${page}:`), error);
      hasMorePages = false;
    }
  }
  
  return allProducts;
}

async function deleteProduct(id: number): Promise<void> {
  const url = `${config.importBaseUrl}/wp-json/wc/v3/products/${id}?force=true`;
  
  await fetchJSON(url, {
    method: "DELETE"
  });
}

// Run the script
deleteAllProducts().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
