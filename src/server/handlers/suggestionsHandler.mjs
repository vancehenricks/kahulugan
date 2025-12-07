import { log, warn } from '../../logs.mjs';
import { generateSuggestions } from '../../suggestions/suggestions.mjs';

export async function serveSuggestions(_req, res) {
  try {
    log('Processing suggestions request');

    const suggestions = await generateSuggestions();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(suggestions));
  } catch (error) {
    warn('Suggestions request failed:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Failed to generate suggestions',
        message: error.message,
      })
    );
  }
}
