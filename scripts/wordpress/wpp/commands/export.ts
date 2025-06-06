import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// Determine which content type is selected based on environment variables or command line arguments
const selectedContentType = process.env.CONTENT_TYPE || "categories";

// Define script paths
const categoryExportScript = path.join(__dirname, "../categories/export.ts");
const productExportScript = path.join(__dirname, "../products/export.ts");

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
    const contentType = cmdContentType || selectedContentType;
    
    // Determine which script to run based on content type
    const scriptPath = contentType === "products" ? productExportScript : categoryExportScript;
    
    // Check if the script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(`Export script for ${contentType} not found at: ${scriptPath}`);
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
    
    // Run the appropriate export script
    await runScript(scriptPath, filteredArgs);
  } catch (error) {
    console.error("❌ Export failed:", error);
    process.exit(1);
  }
}

main();
