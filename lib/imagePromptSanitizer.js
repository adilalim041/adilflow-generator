function sanitizeBrainImagePrompt(prompt) {
    return String(prompt || '')
        .replace(/\b(?:glowing\s+)?AI\s+data\s+streams?\b/giu, 'subtle abstract brand-color lighting')
        .replace(/\bgeneric\s+data\s+streams?\b/giu, 'subtle abstract lighting')
        .replace(/\bcyberpunk\s+palette\b/giu, 'natural editorial color palette')
        .replace(/\bneon\s+blue\b/giu, 'natural cool light')
        .replace(/\bblue-orange\b/giu, 'natural editorial')
        .replace(/\b(?:AI\s+)?model\s+(?:figurine|mascot|humanoid|robot)\b/giu, 'abstract sealed model container');
}

module.exports = {
    sanitizeBrainImagePrompt
};
