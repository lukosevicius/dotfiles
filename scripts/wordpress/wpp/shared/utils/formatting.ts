/**
 * Shared formatting utilities for WordPress scripts
 */

/**
 * Decodes URL-encoded strings for display in terminal
 */
export function decodeSlug(slug: string): string {
  try {
    // First try to decode as URI component
    const decoded = decodeURIComponent(slug);
    return decoded;
  } catch (error) {
    // If decoding fails, return the original string
    return slug;
  }
}

/**
 * Creates a formatted header for console output
 */
export function displayHeader(title: string): void {
  const separator = "=".repeat(title.length + 8);
  console.log("\n" + separator);
  console.log(`    ${title}    `);
  console.log(separator + "\n");
}
