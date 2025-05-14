/**
 * Utility functions for language handling in WordPress scripts
 */

/**
 * Get flag emoji for language code
 * Uses both emoji and text fallback for better compatibility
 */
export function getFlagEmoji(langCode: string): string {
  // Map of language codes to flag emojis and country names
  const flagMap: Record<string, { emoji: string; name: string }> = {
    lt: { emoji: "🇱🇹", name: "LT" }, // Lithuania
    en: { emoji: "🇬🇧", name: "EN" }, // United Kingdom
    lv: { emoji: "🇱🇻", name: "LV" }, // Latvia
    ru: { emoji: "🇷🇺", name: "RU" }, // Russia
    de: { emoji: "🇩🇪", name: "DE" }, // Germany
    // Add more as needed
  };

  const flagInfo = flagMap[langCode];
  if (!flagInfo) return langCode.toUpperCase();

  // Return both emoji and text code for better compatibility
  return `${flagInfo.emoji} `;
}
