export const HIGH_CONFIDENCE_MERCHANTS: {
  aliases: string[];
  displayName: string;
}[] = [
  { aliases: ["ANTHROPIC", "CLAUDE"], displayName: "Claude" },
  { aliases: ["SPOTIFY"], displayName: "Spotify" },
  { aliases: ["AWS", "AMAZON WEB SERVICES"], displayName: "AWS" },
  { aliases: ["AMAZON"], displayName: "Amazon" },
  { aliases: ["NETFLIX"], displayName: "Netflix" },
  { aliases: ["GOOGLE"], displayName: "Google" },
  { aliases: ["MICROSOFT"], displayName: "Microsoft" },
  { aliases: ["ADOBE"], displayName: "Adobe" },
  { aliases: ["SLACK"], displayName: "Slack" },
  { aliases: ["ZOOM"], displayName: "Zoom" },
  { aliases: ["GITHUB"], displayName: "GitHub" },
  { aliases: ["VERCEL"], displayName: "Vercel" },
  { aliases: ["NOTION"], displayName: "Notion" },
  { aliases: ["FIGMA"], displayName: "Figma" },
  { aliases: ["OPENAI", "CHATGPT"], displayName: "OpenAI" },
  { aliases: ["APPLE"], displayName: "Apple" },
  { aliases: ["SWIGGY"], displayName: "Swiggy" },
  { aliases: ["ZOMATO"], displayName: "Zomato" },
  { aliases: ["UBER"], displayName: "Uber" },
  { aliases: ["OLA"], displayName: "Ola" },
  { aliases: ["JIO"], displayName: "Jio" },
  { aliases: ["AIRTEL"], displayName: "Airtel" },
];

function wordsOf(payeeKey: string): string[] {
  return payeeKey.split(/\s+/).filter(Boolean);
}

export function matchMerchant(
  payeeKey: string,
): { displayName: string } | null {
  const words = wordsOf(payeeKey);
  for (const m of HIGH_CONFIDENCE_MERCHANTS) {
    for (const alias of m.aliases) {
      if (payeeKey === alias) return { displayName: m.displayName };
      const aliasWords = wordsOf(alias);
      if (aliasWords.length > 1 && payeeKey.includes(alias)) {
        return { displayName: m.displayName };
      }
      if (aliasWords.length === 1 && words.includes(alias)) {
        return { displayName: m.displayName };
      }
    }
  }
  return null;
}
