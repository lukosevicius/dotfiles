// Add this to the script paths section
const cleanupMediaScript = path.join(__dirname, "commands/cleanup-media.ts");

// Add this command definition after the other commands
program
  .command("cleanup-media <product-slug>")
  .description("Clean up all media items for a specific product (products only)")
  .option("--confirm", "Skip confirmation prompt")
  .action(async (productSlug, options) => {
    try {
      // This command only works for products
      if (selectedContentType !== "products") {
        console.error(chalk.red.bold("✗ The cleanup-media command is only available for products."));
        console.log(chalk.yellow("Please use --type products or select Products from the menu."));
        process.exit(1);
      }
      
      displayHeader(`Cleaning Up Media for Product: ${productSlug}`);
      
      // Build arguments
      const args = [productSlug];
      if (options.confirm) {
        args.push("--confirm");
      }
      
      await runScript(cleanupMediaScript, args);
      console.log(chalk.green.bold(`✓ Media cleanup completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Media cleanup failed:"), error);
      process.exit(1);
    }
  });
