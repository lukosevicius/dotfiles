#!/usr/bin/env ts-node
/**
 * WordPress Product Media Cleanup Command
 * Cleans up all media items for a specific product
 * Enhanced with retry logic and thorough cleanup capabilities
 */
import path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import fs from "fs";

// Parse command line arguments
const args = process.argv.slice(2);
const productSlug = args[0];

// Extract flags
const confirmFlag = args.includes("--confirm");
const thoroughFlag = args.includes("--thorough");
const maxRetriesFlag = args.includes("--max-retries");

// Extract max retries value if provided
let maxRetries = 3; // Default value
if (maxRetriesFlag) {
  const maxRetriesIndex = args.indexOf("--max-retries");
  if (maxRetriesIndex !== -1 && args[maxRetriesIndex + 1]) {
    const parsedValue = parseInt(args[maxRetriesIndex + 1]);
    if (!isNaN(parsedValue) && parsedValue > 0) {
      maxRetries = parsedValue;
    }
  }
}

// Build the arguments to pass to the cleanup script
const scriptArgs = [productSlug];
if (confirmFlag) scriptArgs.push("--confirm");
if (thoroughFlag) scriptArgs.push("--thorough");
scriptArgs.push("--max-retries", maxRetries.toString());

// Check if a product slug is provided
if (!productSlug) {
  console.error(chalk.red("❌ Error: Product slug is required"));
  console.log(chalk.yellow("Usage: cleanup-media <product-slug> [--confirm] [--thorough] [--max-retries <number>]"));
  console.log(chalk.blue("Options:"));
  console.log(chalk.blue("  --confirm       Skip confirmation prompts"));
  console.log(chalk.blue("  --thorough      Perform thorough cleanup of all related files"));
  console.log(chalk.blue("  --max-retries   Maximum number of API call retries (default: 3)"));
  process.exit(1);
}

// Get the script path
const scriptPath = path.join(__dirname, "../products/cleanup-media.ts");

// Check if the cleanup script exists
if (!fs.existsSync(scriptPath)) {
  console.error(chalk.red(`❌ Error: Cleanup media script not found at: ${scriptPath}`));
  console.log(chalk.yellow("Make sure the products/cleanup-media.ts script exists."));
  process.exit(1);
}

console.log(chalk.cyan(`🔍 Cleaning up media for product: ${chalk.bold(productSlug)}`));
if (thoroughFlag) {
  console.log(chalk.blue("Using thorough cleanup mode for more comprehensive media removal"));
}
if (maxRetries !== 3) {
  console.log(chalk.blue(`API call retry limit set to: ${maxRetries}`));
}

// Run the script with retry logic
let attempts = 0;
let success = false;

function runCleanupScript(): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    console.log(chalk.blue(`Running cleanup script (attempt ${attempts + 1} of ${maxRetries + 1})...`));
    
    const childProcess = spawn("yarn", ["ts-node", scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: process.cwd()
    });
    
    childProcess.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green("✓ Cleanup completed successfully!"));
        resolve(true);
      } else {
        console.log(chalk.yellow(`⚠️ Cleanup script exited with code ${code}`));
        resolve(false);
      }
    });
    
    childProcess.on("error", (err) => {
      console.error(chalk.red(`❌ Error running cleanup script: ${err.message}`));
      resolve(false);
    });
  });
}

async function executeWithRetry() {
  while (attempts <= maxRetries) {
    success = await runCleanupScript();
    if (success) break;
    
    attempts++;
    if (attempts <= maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000); // Exponential backoff with max 10s
      console.log(chalk.yellow(`Retrying in ${delay/1000} seconds...`));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  if (!success) {
    console.error(chalk.red(`❌ Failed to clean up media after ${attempts} attempts`));
    process.exit(1);
  }
}

executeWithRetry().catch(error => {
  console.error(chalk.red(`❌ Fatal error: ${error.message || error}`));
  process.exit(1);
});

