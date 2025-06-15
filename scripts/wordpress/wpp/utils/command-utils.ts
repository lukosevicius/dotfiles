/**
 * Command utilities for WPP
 * Helper functions for command scripts
 */
import { Command } from "commander";

/**
 * Get the content type from environment variable or command line argument
 * @returns The content type (categories or products)
 */
export function getContentType(): "categories" | "products" {
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

/**
 * Parse command line arguments with Commander
 * @param options Configuration options
 * @returns Parsed command object
 */
export function parseCommandArgs(options: {
  name: string;
  description: string;
  version?: string;
}) {
  const program = new Command();
  
  program
    .name(options.name)
    .description(options.description);
    
  if (options.version) {
    program.version(options.version);
  }
  
  return program;
}
