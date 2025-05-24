import fetch from "node-fetch";
import config from "../config";
import chalk from "chalk";
import { fetchJSON, getSiteName } from "../utils/api";
import readline from "readline";

// Check if --confirm flag is provided
const shouldConfirm = !process.argv.includes("--confirm");

async function deleteAllProducts(): Promise<void> {
  // Get site name first
  console.log(chalk.cyan(`🔄 Connecting to: ${config.importBaseUrl}`));
  
  try {
    const siteName = await getSiteName(config.importBaseUrl);
    
    if (shouldConfirm) {
      console.log(chalk.red.bold(`⚠️ WARNING: This will delete ALL products from: ${chalk.white.bgRed(` ${siteName} (${config.importBaseUrl}) `)}!`));
      console.log(chalk.yellow("Run with --confirm flag to skip this confirmation."));
      
      // Ask for explicit confirmation
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.red.bold('\nAre you sure you want to delete all products? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Deletion cancelled."));
        return;
      }
    }
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
