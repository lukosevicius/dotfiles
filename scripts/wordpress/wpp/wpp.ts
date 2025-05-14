#!/usr/bin/env ts-node
/**
 * WordPress Product Categories Management Tool (wpp)
 * A global script to manage WordPress product categories across multiple sites
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import readline from "readline";

// Import operations
import { displayHeader } from "./utils/formatting";
import { getFlagEmoji } from "./utils/language";

// We'll need to run these directly since they're not exported as modules
const exportScript = path.join(__dirname, "export.ts");
const importScript = path.join(__dirname, "import.ts");
const deleteScript = path.join(__dirname, "delete.ts");

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Available operations
const operations = [
  {
    id: "export",
    name: "Export categories",
    description: "Export product categories from a WordPress site",
  },
  {
    id: "import",
    name: "Import categories",
    description: "Import product categories to a WordPress site",
  },
  {
    id: "delete",
    name: "Delete categories",
    description: "Delete all product categories from a WordPress site",
  },
  { id: "exit", name: "Exit", description: "Exit the program" },
];

/**
 * Display the main menu
 */
function displayMenu(): void {
  displayHeader("WordPress Product Categories Management Tool");

  console.log("Available operations:\n");
  operations.forEach((op, index) => {
    console.log(`${index + 1}. ${op.name} - ${op.description}`);
  });

  console.log("\nEnter the number of the operation you want to perform:");
}

/**
 * Execute the selected operation
 */
async function executeOperation(operationId: string): Promise<void> {
  // Helper function to run a script using yarn ts-node
  const runScript = (scriptPath: string, args: string[] = []): Promise<void> => {
    return new Promise((resolve, reject) => {
      console.log(`Running: ${scriptPath}`);
      
      const childProcess = spawn('yarn', ['ts-node', scriptPath, ...args], {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Script exited with code ${code}`));
        }
      });
      
      childProcess.on('error', (err) => {
        reject(err);
      });
    });
  };
  
  switch (operationId) {
    case "export":
      displayHeader("Exporting Categories");
      await runScript(exportScript);
      break;
      
    case "import":
      displayHeader("Importing Categories");
      await runScript(importScript);
      break;
      
    case "delete":
      displayHeader("Deleting Categories");
      // Check if --confirm flag is present
      const hasConfirmFlag = process.argv.includes("--confirm");
      
      if (!hasConfirmFlag) {
        console.log(
          "⚠️  WARNING: This will delete ALL product categories from the WordPress site."
        );
        console.log(
          "This action cannot be undone. Make sure you have a backup if needed."
        );

        const answer = await new Promise<string>((resolve) => {
          rl.question("Are you sure you want to proceed? (yes/no): ", resolve);
        });

        if (answer.toLowerCase() !== "yes") {
          console.log("Operation cancelled.");
          return;
        }
      }
      
      // Run the delete script with the confirm flag
      await runScript(deleteScript, ["--confirm"]);
      break;
      
    case "exit":
      console.log("Exiting...");
      break;
      
    default:
      console.log(`Unknown operation: ${operationId}`);
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Check if operation was provided as command-line argument
    const providedOperation = process.argv[2];

    if (
      providedOperation &&
      operations.some((op) => op.id === providedOperation)
    ) {
      await executeOperation(providedOperation);
      rl.close();
      return;
    }

    // If no valid operation was provided, display menu
    displayMenu();

    const answer = await new Promise<string>((resolve) => {
      rl.question("> ", resolve);
    });

    const selectedIndex = parseInt(answer, 10) - 1;

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= operations.length
    ) {
      console.log(
        "Invalid selection. Please enter a number between 1 and " +
          operations.length
      );
    } else {
      const selectedOperation = operations[selectedIndex];
      await executeOperation(selectedOperation.id);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    rl.close();
  }
}

// Run the main function
main();
