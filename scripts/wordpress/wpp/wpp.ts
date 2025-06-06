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
import { displayHeader as formatHeader } from "./utils/formatting";
import config from "./config";
import {
  getSiteByName,
  getSiteByIndex,
  getExportSite,
  getImportSite,
  setExportSite,
  setImportSite,
  listSites,
  getMainLanguage,
  getOtherLanguages,
  getImportBaseUrl,
  getExportBaseUrl,
} from "./utils/config-utils";

// Define script paths
const categoryExportScript = path.join(__dirname, "categories/export.ts");
const categoryImportScript = path.join(__dirname, "categories/import.ts");
const categoryDeleteScript = path.join(__dirname, "categories/delete.ts");
const categoryTestScript = path.join(__dirname, "categories/test.ts");

const productExportScript = path.join(__dirname, "products/export.ts");
const productImportScript = path.join(__dirname, "products/import.ts");
const productDeleteScript = path.join(__dirname, "products/delete.ts");
const productTestScript = path.join(__dirname, "products/test.ts");

// Command router scripts
const exportScript = path.join(__dirname, "commands/export.ts");
const importScript = path.join(__dirname, "commands/import.ts");
const deleteScript = path.join(__dirname, "commands/delete.ts");
const testScript = path.join(__dirname, "commands/test.ts");

// Utility scripts
const downloadImagesScript = path.join(__dirname, "utils/download-images.ts");
const convertToWebpScript = path.join(__dirname, "utils/convert-to-webp.ts");

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
    
    // Add the content type to the environment variables
    const env = { 
      ...process.env, 
      CONTENT_TYPE: selectedContentType,
    };
    
    // Add --type argument to explicitly pass the content type, but only for command scripts
    // This ensures the content type is passed to our router scripts but not to the underlying implementation scripts
    const scriptArgs = [...args];
    const isCommandScript = scriptPath.includes("/commands/");
    
    if (isCommandScript && !args.includes("--type")) {
      scriptArgs.push("--type", selectedContentType);
    }
    
    const childProcess = spawn("yarn", ["ts-node", scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
      env
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
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if content-specific script exists
      const contentScript = selectedContentType === "categories" ? categoryExportScript : productExportScript;
      if (!fs.existsSync(contentScript)) {
        console.error(chalk.red(`Export script for ${selectedContentType} not found at: ${contentScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(contentScript)} script first.`));
        process.exit(1);
      }
      
      // Check if command router script exists
      if (!fs.existsSync(exportScript)) {
        console.error(chalk.red(`Export command script not found at: ${exportScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(exportScript)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Exporting ${contentTypeName}`);
      await runScript(exportScript);
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
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if content-specific script exists
      const contentScript = selectedContentType === "categories" ? categoryImportScript : productImportScript;
      if (!fs.existsSync(contentScript)) {
        console.error(chalk.red(`Import script for ${selectedContentType} not found at: ${contentScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(contentScript)} script first.`));
        process.exit(1);
      }
      
      // Check if command router script exists
      if (!fs.existsSync(importScript)) {
        console.error(chalk.red(`Import command script not found at: ${importScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(importScript)} script first.`));
        process.exit(1);
      }
      
      displayHeader(`Importing ${contentTypeName}`);
      
      // Ask for the number of items to import
      const rl = createPrompt();
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan(`How many ${selectedContentType} to import? (number or 'all', default: all): `), resolve);
      });
      rl.close();
      
      // Process the answer
      let importArgs: string[] = [];
      if (answer && answer.trim() !== '' && answer.toLowerCase() !== 'all') {
        const limit = parseInt(answer.trim());
        if (!isNaN(limit) && limit > 0) {
          importArgs = ['--limit', limit.toString()];
          console.log(chalk.yellow(`Will import ${limit} ${selectedContentType} from the main language and their translations`));
        } else {
          console.log(chalk.yellow(`Invalid input. Will import all ${selectedContentType}.`));
        }
      } else {
        console.log(chalk.yellow(`Will import all ${selectedContentType}.`));
      }
      
      await runScript(importScript, importArgs);
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
      const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
      
      // Check if content-specific script exists
      const contentScript = selectedContentType === "categories" ? categoryDeleteScript : productDeleteScript;
      if (!fs.existsSync(contentScript)) {
        console.error(chalk.red(`Delete script for ${selectedContentType} not found at: ${contentScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(contentScript)} script first.`));
        process.exit(1);
      }
      
      // Check if command router script exists
      if (!fs.existsSync(deleteScript)) {
        console.error(chalk.red(`Delete command script not found at: ${deleteScript}`));
        console.log(chalk.yellow(`Please implement the ${path.basename(deleteScript)} script first.`));
        process.exit(1);
      }
      
      const importSite = getImportSite();
      displayHeader(`Deleting ${contentTypeName}`);
      
      // Check if confirmation is needed
      if (!options.confirm) {
        console.log(chalk.yellow.bold(`\nWARNING: This will delete ALL ${selectedContentType} from ${importSite.name} (${importSite.baseUrl}).`));
        console.log(chalk.yellow("This action cannot be undone. Make sure you have a backup if needed."));
        
        const rl = createPrompt();
        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.red.bold(`Are you sure you want to delete all ${selectedContentType}? (yes/no): `), resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== "yes") {
          console.log(chalk.yellow("\nDeletion aborted."));
          return;
        }
        
        console.log(chalk.green("\nConfirmation received. Proceeding with deletion..."));
      } else {
        console.log(chalk.green("Skipping confirmation due to --confirm flag."));
      }
      
      // Add the --confirm flag to pass to the script
      const deleteArgs = options.confirm ? ["--confirm"] : [];
      
      await runScript(deleteScript, deleteArgs);
      console.log(chalk.green.bold(`\n✓ ${contentTypeName} deletion completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("\n✗ Deletion failed:"), error);
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
  
  // Add site management option
  console.log("\n" + chalk.cyan("Other options:\n"));
  console.log(
    chalk.green(`${contentTypes.length + 1}. `) + 
    chalk.bold("Manage sites") + 
    chalk.dim(" - View and manage WordPress sites")
  );
  
  // Get user selection
  const rl = createPrompt();
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan("\nEnter your selection: "), resolve);
  });
  rl.close();
  
  const selectedIndex = parseInt(answer, 10) - 1;
  
  // Check if the user selected the site management option
  if (selectedIndex === contentTypes.length) {
    // Run the sites command
    await manageSites();
    // After managing sites, show the content type selection again
    return await selectContentType();
  }
  
  if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= contentTypes.length) {
    console.log(
      chalk.red(`Invalid selection. Please enter a number between 1 and ${contentTypes.length + 1}`)
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
  
  // Get current sites
  const exportSite = getExportSite();
  const importSite = getImportSite();
  
  // Define available operations
  const operations = [
    { id: "sites", name: "Manage sites", description: "View and manage WordPress sites" },
    { id: "export", name: `Export ${selectedContentType}`, description: `Export ${selectedContentType} from ${chalk.green(exportSite.name)}` },
    { id: "download-images", name: `Download images`, description: `Download all images without importing` },
    { id: "convert-to-webp", name: `Convert images to WebP`, description: `Convert downloaded images to WebP format` },
    { id: "import", name: `Import ${selectedContentType}`, description: `Import ${selectedContentType} to ${chalk.blue(importSite.name)}` },
    { id: "delete", name: `Delete ${selectedContentType}`, description: `Delete all ${selectedContentType} from ${getImportSite().name}` },
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
  
  // Handle image download options
  if (selectedOperation.id === "download-images") {
    // Check if script exists
    if (!fs.existsSync(downloadImagesScript)) {
      console.error(chalk.red(`Download images script not found at: ${downloadImagesScript}`));
      console.log(chalk.yellow(`Please implement the ${path.basename(downloadImagesScript)} script first.`));
      process.exit(1);
    }
    
    const contentTypeFlag = selectedContentType === "categories" ? "--categories" : "--products";
    
    // Ask if user wants to force download
    const rlForce = createPrompt();
    const forceAnswer = await new Promise<string>((resolve) => {
      rlForce.question(chalk.cyan("\nForce download all images (overwrite existing)? (y/N): "), resolve);
    });
    rlForce.close();
    
    const forceFlag = forceAnswer.toLowerCase() === 'y' ? "--force" : "";
    
    displayHeader(`Downloading ${selectedContentType} Images`);
    await runScript(downloadImagesScript, [contentTypeFlag, forceFlag].filter(Boolean));
    console.log(chalk.green.bold(`✓ Image download completed successfully!`));
    
    // Return to the operations menu after completion
    console.log(chalk.blue("\nPress Enter to return to the menu..."));
    const rlContinue = createPrompt();
    await new Promise<void>((resolve) => {
      rlContinue.question("", () => resolve());
    });
    rlContinue.close();
    
    return await showOperationsMenu();
  }
  
  // Handle WebP conversion
  if (selectedOperation.id === "convert-to-webp") {
    // Check if script exists
    if (!fs.existsSync(convertToWebpScript)) {
      console.error(chalk.red(`WebP conversion script not found at: ${convertToWebpScript}`));
      console.log(chalk.yellow(`Please implement the ${path.basename(convertToWebpScript)} script first.`));
      process.exit(1);
    }
    
    const contentTypeFlag = selectedContentType === "categories" ? "--categories" : "--products";
    
    // Ask for quality setting
    const rlQuality = createPrompt();
    const qualityAnswer = await new Promise<string>((resolve) => {
      rlQuality.question(chalk.cyan("\nEnter WebP quality (10-100, default: 80): "), resolve);
    });
    rlQuality.close();
    
    let qualityFlag: string[] = [];
    if (qualityAnswer && !isNaN(parseInt(qualityAnswer))) {
      const quality = parseInt(qualityAnswer);
      if (quality >= 10 && quality <= 100) {
        qualityFlag = ["--quality", quality.toString()];
      }
    }
    
    displayHeader(`Converting Images to WebP`);
    await runScript(convertToWebpScript, [contentTypeFlag, ...qualityFlag].filter(Boolean));
    console.log(chalk.green.bold(`✓ WebP conversion completed successfully!`));
    
    // Return to the operations menu after completion
    console.log(chalk.blue("\nPress Enter to return to the menu..."));
    const rlContinue = createPrompt();
    await new Promise<void>((resolve) => {
      rlContinue.question("", () => resolve());
    });
    rlContinue.close();
    
    return await showOperationsMenu();
  }
  
  // Handle import with limit option
  if (selectedOperation.id === "import") {
    const scriptPath = selectedContentType === "categories" ? categoryImportScript : productImportScript;
    const contentTypeName = selectedContentType === "categories" ? "Categories" : "Products";
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(chalk.red(`Import script for ${selectedContentType} not found at: ${scriptPath}`));
      console.log(chalk.yellow(`Please implement the ${path.basename(scriptPath)} script first.`));
      process.exit(1);
    }
    
    // Ask how many items to import
    const rlLimit = createPrompt();
    const limitAnswer = await new Promise<string>((resolve) => {
      rlLimit.question(chalk.cyan(`\nHow many ${selectedContentType} to import? (Enter a number or 'all', default: all): `), resolve);
    });
    rlLimit.close();
    
    let limitFlag: string[] = [];
    if (limitAnswer && limitAnswer.toLowerCase() !== 'all' && !isNaN(parseInt(limitAnswer))) {
      const limit = parseInt(limitAnswer);
      if (limit > 0) {
        limitFlag = ["--limit", limit.toString()];
      }
    }
    
    displayHeader(`Importing ${contentTypeName}`);
    await runScript(scriptPath, [...limitFlag]);
    console.log(chalk.green.bold(`✓ ${contentTypeName} import completed successfully!`));
    
    // Return to the operations menu after completion
    console.log(chalk.blue("\nPress Enter to return to the menu..."));
    const rlContinue = createPrompt();
    await new Promise<void>((resolve) => {
      rlContinue.question("", () => resolve());
    });
    rlContinue.close();
    
    return await showOperationsMenu();
  }
  
  // Execute the standard operation for other commands
  await program.parseAsync([process.argv[0], process.argv[1], selectedOperation.id]);
  
  // Return to the operations menu after completion (for export, delete, test, etc.)
  if (selectedOperation.id !== "exit" && selectedOperation.id !== "select-type") {
    console.log(chalk.blue("\nPress Enter to return to the menu..."));
    const rlContinue = createPrompt();
    await new Promise<void>((resolve) => {
      rlContinue.question("", () => resolve());
    });
    rlContinue.close();
    
    return await showOperationsMenu();
  }
}

/**
 * Interactive site management menu
 */
async function manageSites(): Promise<void> {
  try {
    displayHeader("Site Management");
    
    // Get current sites
    const sites = listSites();
    const exportSite = getExportSite();
    const importSite = getImportSite();
    
    // Display current settings
    console.log(chalk.cyan("Current settings:"));
    console.log(chalk.green(`Export site: ${chalk.bold(exportSite.name)} (${exportSite.baseUrl})`));
    console.log(chalk.blue(`Import site: ${chalk.bold(importSite.name)} (${importSite.baseUrl})`));
    console.log();
    
    // Define available operations
    const operations = [
      { id: "list", name: "List all sites", description: "View all available WordPress sites" },
      { id: "export", name: "Change export site", description: "Select a different site for export operations" },
      { id: "import", name: "Change import site", description: "Select a different site for import operations" },
      { id: "back", name: "Back to main menu", description: "Return to the main operations menu" },
    ];
    
    // Display menu options
    console.log(chalk.cyan("Site management options:\n"));
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
    
    const selectedIndex = parseInt(answer) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= operations.length) {
      console.error(
        chalk.red(`Invalid selection. Please enter a number between 1 and ${operations.length}`)
      );
      return await manageSites(); // Try again
    }
    
    const selectedOperation = operations[selectedIndex];
    
    // Handle the selected operation
    switch (selectedOperation.id) {
      case "list":
        await program.parseAsync([process.argv[0], process.argv[1], "sites"]);
        await manageSites(); // Return to site management menu
        break;
        
      case "export":
        await selectSite("export");
        await manageSites(); // Return to site management menu
        break;
        
      case "import":
        await selectSite("import");
        await manageSites(); // Return to site management menu
        break;
        
      case "back":
        await showOperationsMenu();
        break;
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Error in site management:"), error);
    process.exit(1);
  }
}

/**
 * Interactive site selection
 */
async function selectSite(type: "export" | "import"): Promise<void> {
  try {
    const sitesList = listSites();
    const currentSite = type === "export" ? getExportSite() : getImportSite();
    
    displayHeader(`Select ${type === "export" ? "Export" : "Import"} Site`);
    console.log(chalk.cyan(`Current ${type} site: ${chalk.bold(currentSite.name)} (${currentSite.baseUrl})\n`));
    
    // Display available sites
    console.log(chalk.cyan("Available sites:\n"));
    sitesList.forEach((siteInfo, index) => {
      const isCurrent = siteInfo.name === currentSite.name;
      const marker = isCurrent ? chalk.green('✓ ') : '  ';
      
      // Get the full site object to access baseUrl
      const site = getSiteByName(siteInfo.name);
      
      // Format the name with proper chalk styling
      let nameDisplay;
      if (isCurrent) {
        nameDisplay = chalk.green.bold(siteInfo.name);
      } else {
        nameDisplay = siteInfo.name;
      }
      
      console.log(
        `${marker}${index + 1}. ${nameDisplay} - ${site ? site.baseUrl : 'unknown'}${siteInfo.description ? ` (${site?.description || ''})` : ''}`
      );
    });
    
    // Get user selection
    const rl = createPrompt();
    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan(`\nEnter the number of the site to use for ${type} operations: `), resolve);
    });
    rl.close();
    
    if (answer.trim() === "") {
      console.log(chalk.blue("No changes made."));
      return;
    }
    
    const selectedIndex = parseInt(answer) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= sitesList.length) {
      console.error(
        chalk.red(`Invalid selection. Please enter a number between 1 and ${sitesList.length}`)
      );
      return await selectSite(type); // Try again
    }
    
    const selectedSiteInfo = sitesList[selectedIndex];
    const selectedSite = getSiteByName(selectedSiteInfo.name);
    
    // Set the selected site
    if (!selectedSite) {
      console.error(chalk.red.bold(`✗ Error: Site '${selectedSiteInfo.name}' not found in configuration`));
      return;
    }
    
    if (type === "export") {
      setExportSite(selectedSiteInfo.name);
      console.log(chalk.green.bold(`✓ Export site set to: `) + chalk.white.bold(selectedSite.name) + ` (${selectedSite.baseUrl})`);
    } else {
      setImportSite(selectedSiteInfo.name);
      console.log(chalk.green.bold(`✓ Import site set to: `) + chalk.white.bold(selectedSite.name) + ` (${selectedSite.baseUrl})`);
    }
  } catch (error) {
    console.error(chalk.red.bold(`✗ Error selecting ${type} site:`), error);
    process.exit(1);
  }
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
  .option("--export-site <name>", "Site to use for export")
  .option("--import-site <name>", "Site to use for import")
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
      
      // Set export/import sites if provided
      if (options.exportSite) {
        const site = setExportSite(options.exportSite);
        if (!site) {
          console.error(chalk.red.bold(`✗ Export site not found: ${options.exportSite}`));
          process.exit(1);
        }
      }
      
      if (options.importSite) {
        const site = setImportSite(options.importSite);
        if (!site) {
          console.error(chalk.red.bold(`✗ Import site not found: ${options.importSite}`));
          process.exit(1);
        }
      }
      
      // Get current sites
      const exportSite = getExportSite();
      const importSite = getImportSite();
      
      // Display configuration summary
      displayHeader("Configuration Summary");
      console.log(chalk.cyan(`Content type: ${chalk.bold(selectedContentType)}`));
      console.log(chalk.cyan(`Export site: ${chalk.bold(exportSite.name)} (${exportSite.baseUrl})`));
      console.log(chalk.cyan(`Import site: ${chalk.bold(importSite.name)} (${importSite.baseUrl})`));
      
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
        
        // Ask how many items to import
        const rlLimit = createPrompt();
        const limitAnswer = await new Promise<string>((resolve) => {
          rlLimit.question(chalk.cyan(`\nHow many ${selectedContentType} to import? (number or 'all', default: all): `), resolve);
        });
        rlLimit.close();
        
        // Process the answer
        let importArgs: string[] = [];
        if (limitAnswer && limitAnswer.trim() !== '' && limitAnswer.toLowerCase() !== 'all') {
          const limit = parseInt(limitAnswer.trim());
          if (!isNaN(limit) && limit > 0) {
            importArgs = ['--limit', limit.toString()];
            console.log(chalk.yellow(`Will import ${limit} ${selectedContentType} from the main language and their translations`));
          } else {
            console.log(chalk.yellow(`Invalid input. Will import all ${selectedContentType}.`));
          }
        } else {
          console.log(chalk.yellow(`Will import all ${selectedContentType}.`));
        }
        
        await runScript(importScriptPath, importArgs);
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

// Sites command - Display available sites
program
  .command("sites")
  .description("Display available sites for import and export")
  .action(() => {
    displaySites();
  });

/**
 * Display available sites for import and export
 */
function displaySites(): void {
  const sites = listSites();
  const exportSite = getExportSite();
  const importSite = getImportSite();
  
  console.log(chalk.bold("\nAvailable sites:"));
  
  sites.forEach(site => {
    let marker = " ";
    const isExport = exportSite && site.name === exportSite.name;
    const isImport = importSite && site.name === importSite.name;
    
    if (isExport && isImport) {
      marker = chalk.magenta("⇄ ");
    } else if (isExport) {
      marker = chalk.green("↑ ");
    } else if (isImport) {
      marker = chalk.blue("↓ ");
    }
    
    let name = site.name;
    if (isExport && isImport) {
      name = chalk.magenta.bold(site.name);
    } else if (isExport) {
      name = chalk.green.bold(site.name);
    } else if (isImport) {
      name = chalk.blue.bold(site.name);
    }
    
    console.log(`${marker}${site.index}: ${name} ${site.description ? `- ${site.description}` : ''}`);
  });
  
  console.log(`\n${chalk.green("↑")} = Export site, ${chalk.blue("↓")} = Import site, ${chalk.magenta("⇄")} = Both`);
  console.log(`Use --export-site=NAME to set export site, --import-site=NAME to set import site`);
}

program
  .command("set-export-site <name>")
  .description("Set the site to use for export operations")
  .action(async (name) => {
    try {
      const site = setExportSite(name);
      if (site) {
        console.log(chalk.green.bold(`✓ Export site set to: ${chalk.white(site.name)} (${site.baseUrl})`));
      } else {
        console.error(chalk.red.bold(`✗ Site not found: ${name}`));
        console.log(chalk.yellow("Available sites:"));
        listSites().forEach(site => {
          console.log(`  - ${site.name}`);
        });
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red.bold("✗ Error setting export site:"), error);
      process.exit(1);
    }
  });

program
  .command("set-import-site <name>")
  .description("Set the site to use for import operations")
  .action(async (name) => {
    try {
      const site = setImportSite(name);
      if (site) {
        console.log(chalk.green.bold(`✓ Import site set to: ${chalk.white(site.name)} (${site.baseUrl})`));
      } else {
        console.error(chalk.red.bold(`✗ Site not found: ${name}`));
        console.log(chalk.yellow("Available sites:"));
        listSites().forEach(site => {
          console.log(`  - ${site.name}`);
        });
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red.bold("✗ Error setting import site:"), error);
      process.exit(1);
    }
  });

const envFilePath = path.join(__dirname, '.env.json');
if (!fs.existsSync(envFilePath)) {
  try {
    const defaultEnv = {
      exportSite: config.sites[0].name,
      importSite: config.sites[0].name,
      contentType: "categories"
    };
    fs.writeFileSync(envFilePath, JSON.stringify(defaultEnv, null, 2));
    console.log(chalk.dim(`Created environment file at ${envFilePath}`));
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Could not create environment file: ${error}`));
  }
}

// Process site selection arguments before parsing other commands
const exportSiteArg = process.argv.find(arg => arg.startsWith('--export-site='));
if (exportSiteArg) {
  const siteValue = exportSiteArg.split('=')[1];
  const siteIndex = parseInt(siteValue);
  
  // If it's a number, use it as an index, otherwise as a name
  const site = setExportSite(isNaN(siteIndex) ? siteValue : siteIndex);
  
  if (site) {
    console.log(`${chalk.green("✓")} Set export site to: ${chalk.bold}${site.name}${chalk.reset}`);
  } else {
    console.log(`${chalk.red("✗")} Site not found: ${siteValue}${chalk.reset}`);
    displaySites();
    process.exit(1);
  }
}

const importSiteArg = process.argv.find(arg => arg.startsWith('--import-site='));
if (importSiteArg) {
  const siteValue = importSiteArg.split('=')[1];
  const siteIndex = parseInt(siteValue);
  
  // If it's a number, use it as an index, otherwise as a name
  const site = setImportSite(isNaN(siteIndex) ? siteValue : siteIndex);
  
  if (site) {
    console.log(`${chalk.green("✓")} Set import site to: ${chalk.bold}${site.name}${chalk.reset}`);
  } else {
    console.log(`${chalk.red("✗")} Site not found: ${siteValue}${chalk.reset}`);
    displaySites();
    process.exit(1);
  }
}

// Main program execution
program.parse(process.argv);
