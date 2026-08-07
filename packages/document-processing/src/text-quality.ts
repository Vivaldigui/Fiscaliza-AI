import type { TextQualityResult } from './types';

export interface TextQualityConfig {
  minimumCharacters: number;
  minimumQualityScore: number;
  minimumWords: number;
}

export const defaultTextQualityConfig: TextQualityConfig = {
  minimumCharacters: 80,
  minimumQualityScore: 0.55,
  minimumWords: 8,
};

export class TextQualityAnalyzer {
  constructor(private readonly config: TextQualityConfig = defaultTextQualityConfig) {}

  analyze(input: string | null | undefined): TextQualityResult {
    const text = (input ?? '').replace(/\s+/g, ' ').trim();
    const characters = [...text];
    const characterCount = characters.length;
    const printable = characters.filter((character) => /[\p{L}\p{N}\p{P}\p{S}\s]/u.test(character));
    const printableRatio = characterCount === 0 ? 0 : printable.length / characterCount;
    const words = text.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    const tinyTokens = text.split(/\s+/).filter((token) => token.length === 1).length;
    const tokenCount = Math.max(1, text.split(/\s+/).filter(Boolean).length);
    const fragmentationScore = Math.max(0, 1 - tinyTokens / tokenCount);
    const lengthScore = Math.min(1, characterCount / Math.max(1, this.config.minimumCharacters));
    const wordScore = Math.min(1, words.length / Math.max(1, this.config.minimumWords));
    const qualityScore = clamp(
      lengthScore * 0.35 + printableRatio * 0.25 + wordScore * 0.25 + fragmentationScore * 0.15,
    );

    const reasons: string[] = [];
    if (characterCount < this.config.minimumCharacters) reasons.push('poucos caracteres');
    if (printableRatio < 0.85) reasons.push('muitos caracteres não reconhecíveis');
    if (words.length < this.config.minimumWords) reasons.push('poucas palavras reconhecíveis');
    if (fragmentationScore < 0.65) reasons.push('texto fragmentado');
    if (qualityScore < this.config.minimumQualityScore) reasons.push('qualidade abaixo do limiar');
    const requiresOcr =
      characterCount < this.config.minimumCharacters ||
      words.length < this.config.minimumWords ||
      qualityScore < this.config.minimumQualityScore;

    return {
      characterCount,
      printableRatio: round(printableRatio),
      wordCount: words.length,
      qualityScore: round(qualityScore),
      requiresOcr,
      reason: reasons.length ? reasons.join('; ') : 'texto digital suficiente',
    };
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
