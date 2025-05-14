import { spawn } from "child_process";
import config from "./config";

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m"
  },
  
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m"
  }
};

/**
 * Runs a command and returns a promise that resolves when the command completes
 */
function runCommand(command: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`\n${colors.bright}${colors.fg.cyan}▶ Running: ${command} ${args.join(' ')}${colors.reset}\n`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Displays a section header in the console
 */
function displayHeader(title: string): void {
  const line = "=".repeat(title.length + 10);
  console.log(`\n${colors.bright}${colors.fg.yellow}${line}${colors.reset}`);
  console.log(`${colors.bright}${colors.fg.yellow}===  ${title}  ===${colors.reset}`);
  console.log(`${colors.bright}${colors.fg.yellow}${line}${colors.reset}\n`);
}

/**
 * Main function to run the complete workflow
 */
async function main(): Promise<void> {
  try {
    // Display configuration summary
    displayHeader("Configuration Summary");
    console.log(`Export from: ${config.exportBaseUrl}`);
    console.log(`Import to: ${config.importBaseUrl}`);
    console.log(`Main language: ${config.mainLanguage}`);
    console.log(`Other languages: ${config.otherLanguages.join(", ")}`);
    console.log(`Output directory: ${config.outputDir}`);
    console.log(`Output file: ${config.inputFile}`);
    
    // Check if --skip-export flag is present
    const skipExport = process.argv.includes("--skip-export");
    const skipTest = process.argv.includes("--skip-test");
    const skipImport = process.argv.includes("--skip-import");
    const forceImport = process.argv.includes("--force-import");
    
    // Step 1: Export
    if (!skipExport) {
      displayHeader("Step 1: Export Categories");
      await runCommand("yarn", ["export"]);
    } else {
      console.log(`${colors.fg.yellow}Skipping export step (--skip-export flag detected)${colors.reset}`);
    }
    
    // Step 2: Test
    if (!skipTest) {
      displayHeader("Step 2: Test Export Data");
      await runCommand("yarn", ["test"]);
    } else {
      console.log(`${colors.fg.yellow}Skipping test step (--skip-test flag detected)${colors.reset}`);
    }
    
    // Step 3: Import
    if (!skipImport) {
      displayHeader("Step 3: Import Categories");
      
      if (config.exportBaseUrl === config.importBaseUrl && !forceImport) {
        console.log(`${colors.fg.red}⚠️  WARNING: Export and import URLs are the same!${colors.reset}`);
        console.log(`${colors.fg.red}This might overwrite or duplicate your categories.${colors.reset}`);
        console.log(`${colors.fg.red}Use --force-import flag to proceed anyway.${colors.reset}`);
      } else {
        await runCommand("yarn", ["import-wp"]);
      }
    } else {
      console.log(`${colors.fg.yellow}Skipping import step (--skip-import flag detected)${colors.reset}`);
    }
    
    // Complete
    displayHeader("Workflow Complete");
    console.log(`${colors.fg.green}✅ All steps completed successfully${colors.reset}`);
    
  } catch (error) {
    console.error(`\n${colors.fg.red}❌ Error in workflow:${colors.reset}`, error);
    process.exit(1);
  }
}

// Run the main function
main();
