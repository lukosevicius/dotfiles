/**
 * Import command router script
 * Routes to the appropriate import script based on content type
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// Define script paths
const categoryImportScript = path.join(__dirname, "../categories/import.ts");
const productImportScript = path.join(__dirname, "../products/import.ts");

/**
 * Run a script with ts-node
 */
async function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running script: ${path.basename(scriptPath)}`);
    const child = spawn("npx", ["ts-node", scriptPath, ...args], {
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    // Check if content type is provided via command line
    const typeIndex = process.argv.indexOf("--type");
    let cmdContentType = "";
    
    // Get the content type but don't include it in the args we pass to the script
    if (typeIndex !== -1 && process.argv[typeIndex + 1]) {
      cmdContentType = process.argv[typeIndex + 1];
    }
    
    // Command line argument takes precedence over environment variable
    const contentType = cmdContentType || process.env.CONTENT_TYPE || "categories";
    
    // Determine which script to run based on content type
    const scriptPath = contentType === "products" ? productImportScript : categoryImportScript;
    
    // Check if the script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(`Import script for ${contentType} not found at: ${scriptPath}`);
      process.exit(1);
    }
    
    // Filter out the --type argument and its value from the args we pass to the script
    const filteredArgs = [];
    const args = process.argv.slice(2);
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--type") {
        // Skip this argument and the next one (the value)
        i++;
        continue;
      }
      filteredArgs.push(args[i]);
    }
    
    // Run the appropriate import script
    await runScript(scriptPath, filteredArgs);
  } catch (error) {
    console.error("❌ Import failed:", error);
    process.exit(1);
  }
}

main();
