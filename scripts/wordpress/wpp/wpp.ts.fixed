// Cleanup media command (products only)
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
      
      // Check if script exists
      if (!fs.existsSync(productCleanupMediaScript)) {
        console.error(chalk.red.bold(`✗ Cleanup media script not found: ${productCleanupMediaScript}`));
        process.exit(1);
      }
      
      displayHeader(`Cleaning Up Media for Product: ${productSlug}`);
      
      // Build arguments
      const args = [productSlug];
      if (options.confirm) {
        args.push("--confirm");
      }
      
      await runScript(productCleanupMediaScript, args);
      console.log(chalk.green.bold(`✓ Media cleanup completed successfully!`));
    } catch (error) {
      console.error(chalk.red.bold("✗ Media cleanup failed:"), error);
      process.exit(1);
    }
  });
