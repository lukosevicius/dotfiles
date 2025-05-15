#!/usr/bin/env ts-node
/**
 * WordPress Products & Categories Management Tool (wpp)
 * A global script to manage WordPress products and categories across multiple sites
 * Enhanced with Commander for CLI structure and Chalk for colorful output
 */
import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import { spawn } from "child_process";
import readline from "readline";
import fs from "fs";
import { displayHeader as formatHeader } from "./shared/utils/formatting";

// Define script paths
const categoryExportScript = path.join(__dirname, "categories/export.ts");
const categoryImportScript = path.join(__dirname, "categories/import.ts");
const categoryDeleteScript = path.join(__dirname, "categories/delete.ts");
const categoryTestScript = path.join(__dirname, "categories/test.ts");

const productExportScript = path.join(__dirname, "products/export.ts");
const productImportScript = path.join(__dirname, "products/import.ts");
const productDeleteScript = path.join(__dirname, "products/delete.ts");
const productTestScript = path.join(__dirname, "products/test.ts");

// Define content types
type ContentType = "categories" | "products";
let selectedContentType: ContentType = "categories"; // Default

// Create Commander program
const program = new Command();

// Configure the program
program
  .name("wpp")
  .description(chalk.bold("WordPress Products & Categories Management Tool"))
  .version("1.0.0")
  .option("-t, --type <type>", "Content type to manage: categories or products", (value) => {
    if (value === "categories" || value === "products") {
      selectedContentType = value;
      return value;
    }
    console.error(chalk.red(`Invalid content type: ${value}. Using default: categories`));
    return "categories";
  });

/**
 * Helper function to run a script using yarn ts-node
 */
const runScript = (scriptPath: string, args: string[] = []): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Script not found: ${scriptPath}`));
      return;
    }
    
    console.log(chalk.dim(`Running script: ${path.basename(scriptPath)}`));
    
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
};

/**
 * Create a readline interface for user input
 */
const createPrompt = (): readline.Interface => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

/**
 * Display a header with a title
 */
const displayHeader = (title: string): void => {
  formatHeader(title);
};

// Export command
program
  .command("export")
  .description("Export content from a WordPress site")
  .action(async () => {
    try {
      const scriptPath = selectedContentType === "categories" ? categoryExportScript : productExportScript;
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        console.error(chalk.red(`Export script for ${selectedContentType} not found at: ${scriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(scriptPath)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Exporting ${contentTypeName}`);
      await runScript(scriptPath);
      console.log(chalk.green.bold(`✓ ${contentTypeName} export completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Export failed:"), error);
      process.exit(1);
    }
  });

// Import command
program
  .command("import")
  .description("Import content to a WordPress site")
  .action(async () => {
    try {
      const scriptPath = selectedContentType === "categories" ? categoryImportScript : productImportScript;
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        console.error(chalk.red(`Import script for ${selectedContentType} not found at: ${scriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(scriptPath)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Importing ${contentTypeName}`);
      await runScript(scriptPath);
      console.log(chalk.green.bold(`✓ ${contentTypeName} import completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Import failed:"), error);
      process.exit(1);
    }
  });

// Delete command
program
  .command("delete")
  .description("Delete content from a WordPress site")
  .option("--confirm", "Skip confirmation prompt")
  .action(async (options) => {
    try {
      const scriptPath = selectedContentType === "categories" ? categoryDeleteScript : productDeleteScript;
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        console.error(chalk.red(`Delete script for ${selectedContentType} not found at: ${scriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(scriptPath)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Deleting ${contentTypeName}`);
      
      // Check if confirmation is needed
      if (!options.confirm) {
        console.log(
          chalk.yellow.bold("⚠️  WARNING: ") + 
          chalk.yellow(`This will delete ALL ${selectedContentType} from the WordPress site.`)
        );
        console.log(
          chalk.yellow("This action cannot be undone. Make sure you have a backup if needed.")
        );
        
        const rl = createPrompt();
        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow.bold("Are you sure you want to proceed? (yes/no): "), resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== "yes") {
          console.log(chalk.blue("Operation cancelled."));
          return;
        }
      }
      
      // Run the delete script with the confirm flag
      await runScript(scriptPath, ["--confirm"]);
      console.log(chalk.green.bold(`✓ ${contentTypeName} deletion completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Deletion failed:"), error);
      process.exit(1);
    }
  });

// Content type selection command
program
  .command("select-type")
  .description("Select content type to manage (categories or products)")
  .action(async () => {
    try {
      displayHeader("Select Content Type");
      
      // Define available content types
      const contentTypes = [
        { id: "categories", name: "Product Categories", description: "Manage product categories" },
        { id: "products", name: "Products", description: "Manage products" },
      ];
      
      // Display content type options
      console.log(chalk.cyan("Available content types:\n"));
      contentTypes.forEach((type, index) => {
        console.log(
          chalk.green(`${index + 1}. `) + 
          chalk.bold(type.name) + 
          chalk.dim(` - ${type.description}`)
        );
      });
      
      // Get user selection
      const rl = createPrompt();
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan("\nEnter the number of the content type you want to manage: "), resolve);
      });
      rl.close();
      
      const selectedIndex = parseInt(answer, 10) - 1;
      
      if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= contentTypes.length) {
        console.log(
          chalk.red(`Invalid selection. Please enter a number between 1 and ${contentTypes.length}`)
        );
        return;
      }
      
      const selectedType = contentTypes[selectedIndex];
      selectedContentType = selectedType.id as ContentType;
      
      console.log(chalk.green(`\nSelected content type: ${chalk.bold(selectedType.name)}`));
      
      // Show operations menu for the selected content type
      await program.parseAsync([process.argv[0], process.argv[1], "menu"]);
    } catch (error) {
      console.error(chalk.red.bold("An error occurred:"), error);
      process.exit(1);
    }
  });

// Interactive menu command (default when no command is specified)
program
  .command("menu", { isDefault: true })
  .description("Show interactive menu")
  .action(async () => {
    try {
      // Always start with content type selection
      await selectContentType();
      
      // Then show operations for the selected content type
      await showOperationsMenu();
    } catch (error) {
      console.error(chalk.red.bold("An error occurred:"), error);
      process.exit(1);
    }
  });

/**
 * Select content type interactively
 */
async function selectContentType(): Promise<void> {
  displayHeader("Select Content Type");
  
  // Define available content types
  const contentTypes = [
    { id: "categories", name: "Product Categories", description: "Manage product categories" },
    { id: "products", name: "Products", description: "Manage products" },
  ];
  
  // Display content type options
  console.log(chalk.cyan("Available content types:\n"));
  contentTypes.forEach((type, index) => {
    console.log(
      chalk.green(`${index + 1}. `) + 
      chalk.bold(type.name) + 
      chalk.dim(` - ${type.description}`)
    );
  });
  
  // Get user selection
  const rl = createPrompt();
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan("\nEnter the number of the content type you want to manage: "), resolve);
  });
  rl.close();
  
  const selectedIndex = parseInt(answer, 10) - 1;
  
  if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= contentTypes.length) {
    console.log(
      chalk.red(`Invalid selection. Please enter a number between 1 and ${contentTypes.length}`)
    );
    process.exit(1);
  }
  
  const selectedType = contentTypes[selectedIndex];
  selectedContentType = selectedType.id as ContentType;
  
  console.log(chalk.green(`\nSelected content type: ${chalk.bold(selectedType.name)}`));
}

/**
 * Show operations menu for the selected content type
 */
async function showOperationsMenu(): Promise<void> {
  const contentTypeName = selectedContentType === "categories" ? "Product Categories" : "Products";
  displayHeader(`WordPress ${contentTypeName} Management Tool`);
  
  // Define available operations
  const operations = [
    { id: "export", name: `Export ${selectedContentType}`, description: `Export ${selectedContentType} from a WordPress site` },
    { id: "import", name: `Import ${selectedContentType}`, description: `Import ${selectedContentType} to a WordPress site` },
    { id: "delete", name: `Delete ${selectedContentType}`, description: `Delete all ${selectedContentType} from a WordPress site` },
    { id: "test", name: `Test ${selectedContentType} data`, description: `Analyze and test the exported ${selectedContentType} data` },
    { id: "complete", name: "Complete workflow", description: "Run the complete export-test-import workflow" },
    { id: "select-type", name: "Change content type", description: "Select a different content type to manage" },
    { id: "exit", name: "Exit", description: "Exit the program" },
  ];
  
  // Display menu options
  console.log(chalk.cyan(`Managing: ${chalk.bold(contentTypeName)}\n`));
  console.log(chalk.cyan("Available operations:\n"));
  operations.forEach((op, index) => {
    console.log(
      chalk.green(`${index + 1}. `) + 
      chalk.bold(op.name) + 
      chalk.dim(` - ${op.description}`)
    );
  });
  
  // Get user selection
  const rl = createPrompt();
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan("\nEnter the number of the operation you want to perform: "), resolve);
  });
  rl.close();
  
  const selectedIndex = parseInt(answer, 10) - 1;
  
  if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= operations.length) {
    console.log(
      chalk.red(`Invalid selection. Please enter a number between 1 and ${operations.length}`)
    );
    return;
  }
  
  const selectedOperation = operations[selectedIndex];
  
  if (selectedOperation.id === "exit") {
    console.log(chalk.blue("Exiting..."));
    return;
  }
  
  if (selectedOperation.id === "select-type") {
    // If user wants to change content type, restart the process
    await selectContentType();
    await showOperationsMenu();
    return;
  }
  
  // Execute the selected operation
  await program.parseAsync([process.argv[0], process.argv[1], selectedOperation.id]);
}

// Test command
program
  .command("test")
  .description("Analyze and test the exported data")
  .action(async () => {
    try {
      const scriptPath = selectedContentType === "categories" ? categoryTestScript : productTestScript;
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        console.error(chalk.red(`Test script for ${selectedContentType} not found at: ${scriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(scriptPath)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Testing ${contentTypeName} Data`);
      await runScript(scriptPath);
      console.log(chalk.green.bold(`✓ ${contentTypeName} test completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Test failed:"), error);
      process.exit(1);
    }
  });

// Complete workflow command
program
  .command("complete")
  .description("Run the complete workflow: export, test, and import")
  .option("--skip-export", "Skip the export step")
  .option("--skip-test", "Skip the test step")
  .option("--skip-import", "Skip the import step")
  .option("--force-import", "Force import without confirmation")
  .action(async (options) => {
    try {
      const exportScriptPath = selectedContentType === "categories" ? categoryExportScript : productExportScript;
      const importScriptPath = selectedContentType === "categories" ? categoryImportScript : productImportScript;
      const testScriptPath = selectedContentType === "categories" ? categoryTestScript : productTestScript;
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if scripts exist
      if (!fs.existsSync(exportScriptPath) && !options.skipExport) {
        console.error(chalk.red(`Export script for ${selectedContentType} not found at: ${exportScriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(exportScriptPath)} script first.`));
        process.exit(1);
      }
      
      if (!fs.existsSync(importScriptPath) && !options.skipImport) {
        console.error(chalk.red(`Import script for ${selectedContentType} not found at: ${importScriptPath}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(importScriptPath)} script first.`));
        process.exit(1);
      }
      
      // Display configuration summary
      displayHeader("Configuration Summary");
      console.log(chalk.cyan(`Content type: ${chalk.bold(selectedContentType)}`));
      console.log(chalk.cyan(`Export from: ${chalk.bold(path.basename(exportScriptPath))}`));
      console.log(chalk.cyan(`Import to: ${chalk.bold(path.basename(importScriptPath))}`));
      
      // Step 1: Export
      if (!options.skipExport) {
        displayHeader(`Step 1: Export ${contentTypeName}`);
        await runScript(exportScriptPath);
        console.log(chalk.green.bold(`✓ ${contentTypeName} export completed successfully!`));
      } else {
        console.log(chalk.yellow("Export step skipped."));
      }
      
      // Step 2: Test (if available)
      if (!options.skipTest) {
        if (fs.existsSync(testScriptPath)) {
          displayHeader(`Step 2: Test ${contentTypeName} Data`);
          await runScript(testScriptPath);
          console.log(chalk.green.bold(`✓ ${contentTypeName} test completed successfully!`));
        } else {
          console.log(chalk.yellow(`Test script for ${selectedContentType} not found. Skipping test step.`));
        }
      } else {
        console.log(chalk.yellow("Test step skipped."));
      }
      
      // Step 3: Import
      if (!options.skipImport) {
        displayHeader(`Step 3: Import ${contentTypeName}`);
        
        // Ask for confirmation unless force-import is specified
        if (!options.forceImport) {
          console.log(chalk.yellow(`This will import all ${selectedContentType} to the target WordPress site.`));
          
          const rl = createPrompt();
          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow.bold("Do you want to proceed with the import? (yes/no): "), resolve);
          });
          rl.close();
          
          if (answer.toLowerCase() !== "yes") {
            console.log(chalk.blue("Import cancelled."));
            return;
          }
        }
        
        await runScript(importScriptPath);
        console.log(chalk.green.bold(`✓ ${contentTypeName} import completed successfully!`));
      } else {
        console.log(chalk.yellow("Import step skipped."));
      }
      
      console.log(chalk.green.bold(`\n✓ Complete ${selectedContentType} workflow finished successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Workflow failed:"), error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
