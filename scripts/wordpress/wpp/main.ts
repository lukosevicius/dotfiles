import { spawn } from "child_process";
import config, {
  getSiteByName,
  getSiteByIndex,
  getExportSite,
  getImportSite,
  setExportSite,
  setImportSite,
  listSites,
  getMainLanguage,
  getOtherLanguages,
  getExportBaseUrl,
  getImportBaseUrl
} from "./config";

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
 * Display available sites
 */
function displaySites(): void {
  const sites = listSites();
  const exportSite = getExportSite();
  const importSite = getImportSite();
  
  displayHeader("Available Sites");
  
  sites.forEach(site => {
    const isExport = site.name === exportSite.name;
    const isImport = site.name === importSite.name;
    let marker = '  ';
    
    if (isExport && isImport) {
      marker = `${colors.fg.magenta}⇄ `;
    } else if (isExport) {
      marker = `${colors.fg.green}↑ `;
    } else if (isImport) {
      marker = `${colors.fg.blue}↓ `;
    }
    
    const name = (isExport || isImport) ? 
      `${colors.bright}${isExport ? colors.fg.green : colors.fg.blue}${site.name}${colors.reset}` : 
      site.name;
    
    console.log(`${marker}${site.index}: ${name}${colors.reset} ${site.description ? `- ${site.description}` : ''}`);
  });
  
  console.log(`\n${colors.fg.green}↑${colors.reset} = Export site, ${colors.fg.blue}↓${colors.reset} = Import site, ${colors.fg.magenta}⇄${colors.reset} = Both`);
  console.log(`Use --export-site=NAME to set export site, --import-site=NAME to set import site`);
}

/**
 * Main function to run the complete workflow
 */
async function main(): Promise<void> {
  try {
    // Check if export site selection is requested
    const exportSiteArg = process.argv.find(arg => arg.startsWith('--export-site='));
    if (exportSiteArg) {
      const siteValue = exportSiteArg.split('=')[1];
      const siteIndex = parseInt(siteValue);
      
      // If it's a number, use it as an index, otherwise as a name
      const site = setExportSite(isNaN(siteIndex) ? siteValue : siteIndex);
      
      if (site) {
        console.log(`${colors.fg.green}✓ Set export site to: ${colors.bright}${site.name}${colors.reset}`);
      } else {
        console.log(`${colors.fg.red}✗ Site not found: ${siteValue}${colors.reset}`);
        displaySites();
        process.exit(1);
      }
    }
    
    // Check if import site selection is requested
    const importSiteArg = process.argv.find(arg => arg.startsWith('--import-site='));
    if (importSiteArg) {
      const siteValue = importSiteArg.split('=')[1];
      const siteIndex = parseInt(siteValue);
      
      // If it's a number, use it as an index, otherwise as a name
      const site = setImportSite(isNaN(siteIndex) ? siteValue : siteIndex);
      
      if (site) {
        console.log(`${colors.fg.green}✓ Set import site to: ${colors.bright}${site.name}${colors.reset}`);
      } else {
        console.log(`${colors.fg.red}✗ Site not found: ${siteValue}${colors.reset}`);
        displaySites();
        process.exit(1);
      }
    }
    
    // Check if list sites is requested
    if (process.argv.includes('--list-sites') || process.argv.includes('-l')) {
      displaySites();
      return;
    }
    
    // Display configuration summary
    const exportSite = getExportSite();
    const importSite = getImportSite();
    
    displayHeader("Configuration Summary");
    console.log(`Export site: ${colors.bright}${colors.fg.green}${exportSite.name}${colors.reset} ${exportSite.description ? `(${exportSite.description})` : ''}`);
    console.log(`Export URL: ${getExportBaseUrl()}`);
    console.log(`Import site: ${colors.bright}${colors.fg.blue}${importSite.name}${colors.reset} ${importSite.description ? `(${importSite.description})` : ''}`);
    console.log(`Import URL: ${getImportBaseUrl()}`);
    console.log(`Main language: ${getMainLanguage()}`);
    console.log(`Other languages: ${getOtherLanguages().join(", ")}`);
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
      
      if (getExportBaseUrl() === getImportBaseUrl() && !forceImport) {
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
