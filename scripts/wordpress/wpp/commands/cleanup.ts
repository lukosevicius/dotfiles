/**
 * Cleanup command router for WPP
 * Routes cleanup commands to the appropriate script based on content type
 */
import chalk from "chalk";
import path from "path";
import { spawn } from "child_process";
import fs from "fs";

/**
 * Get the content type from environment variable or command line argument
 * @returns The content type (categories or products)
 */
function getContentType(): "categories" | "products" {
  // First check environment variable
  const envContentType = process.env.CONTENT_TYPE;
  if (envContentType === "categories" || envContentType === "products") {
    return envContentType;
  }
  
  // Then check command line arguments
  const args = process.argv.slice(2);
  const typeIndex = args.indexOf("--type");
  if (typeIndex !== -1 && typeIndex < args.length - 1) {
    const argType = args[typeIndex + 1];
    if (argType === "categories" || argType === "products") {
      return argType;
    }
  }
  
  // Default to categories
  return "categories";
}

// Get content type from environment variable or command line argument
const contentType = getContentType();

// Define script paths based on content type
const productDeleteScript = path.join(__dirname, "../products/delete.ts");
const productCleanupMediaScript = path.join(__dirname, "../products/cleanup-media.ts");
const categoryDeleteScript = path.join(__dirname, "../categories/delete.ts");

// Pass all arguments to the appropriate script
const args = process.argv.slice(2);

// Extract the cleanup action (first argument after any flags)
const actionArg = args.find(arg => !arg.startsWith("--"));
const action = actionArg || "help";

// Extract flags
const flags = args.filter(arg => arg.startsWith("--"));

// Main execution
(async () => {
  try {
    // Handle common cleanup actions
    switch (action) {
      case "products":
        // Delete all products
        console.log(chalk.cyan("🧹 Cleaning up all products..."));
        await runScript(productDeleteScript, flags);
        break;
        
      case "categories":
        // Delete all categories
        console.log(chalk.cyan("🧹 Cleaning up all categories..."));
        await runScript(categoryDeleteScript, flags);
        break;
        
      case "media":
        // Clean up all media
        console.log(chalk.cyan("🧹 Cleaning up all media..."));
        await runScript(productCleanupMediaScript, ["--all-media", ...flags]);
        break;
        
      case "orphaned-media":
        // Clean up orphaned media (media not attached to any post)
        console.log(chalk.cyan("🧹 Cleaning up orphaned media..."));
        await runScript(productCleanupMediaScript, ["--check-count", ...flags]);
        break;
        
      case "help":
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Cleanup failed:"), error);
    process.exit(1);
  }
})();

/**
 * Run a script with the given arguments
 */
function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(chalk.dim(`Running: ${path.basename(scriptPath)} ${args.join(" ")}`));
    
    const childProcess = spawn("yarn", ["ts-node", scriptPath, ...args], {
      stdio: "inherit",
      cwd: process.cwd()
    });
    
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });
    
    childProcess.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Show help information
 */
function showHelp(): void {
  console.log(chalk.cyan.bold("\n🧹 WPP Cleanup Commands"));
  console.log(chalk.cyan("Usage: wpp cleanup <command> [options]"));
  
  console.log(chalk.yellow("\nAvailable Commands:"));
  console.log(`  ${chalk.green("products")}         Delete all products`);
  console.log(`  ${chalk.green("categories")}       Delete all categories`);
  console.log(`  ${chalk.green("media")}            Delete all media files`);
  console.log(`  ${chalk.green("orphaned-media")}   Check for orphaned media files`);
  
  console.log(chalk.yellow("\nCommon Options:"));
  console.log(`  ${chalk.green("--confirm")}           Skip confirmation prompts`);
  console.log(`  ${chalk.green("--delete-images")}     Also delete associated images (for products)`);
  console.log(`  ${chalk.green("--thorough-cleanup")}  Perform thorough media cleanup after deletion`);
  
  console.log(chalk.yellow("\nExamples:"));
  console.log(`  ${chalk.dim("wpp cleanup products --confirm")}`);
  console.log(`  ${chalk.dim("wpp cleanup media --confirm")}`);
  console.log(`  ${chalk.dim("wpp cleanup categories")}`);
  console.log("");
}
