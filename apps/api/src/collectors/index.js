import { SOURCE_TYPES } from '@ragingester/shared';
import { httpApiCollector } from './http-api.js';
import { websiteUrlCollector } from './website-url.js';
import { rssFeedCollector } from './rss-feed.js';
import { identifierBasedCollector } from './identifier-based.js';
import { youtubeCollector } from './youtube.js';
import { smartcursorLinkCollector } from './smartcursor-link.js';

const collectors = {
  [SOURCE_TYPES.HTTP_API]: httpApiCollector,
  [SOURCE_TYPES.WEBSITE_URL]: websiteUrlCollector,
  [SOURCE_TYPES.RSS_FEED]: rssFeedCollector,
  [SOURCE_TYPES.IDENTIFIER_BASED]: identifierBasedCollector,
  [SOURCE_TYPES.YOUTUBE]: youtubeCollector,
  [SOURCE_TYPES.SMARTCURSOR_LINK]: smartcursorLinkCollector
};

export function resolveCollector(sourceType) {
  const collector = collectors[sourceType];
  if (!collector) {
    throw new Error(`unsupported source_type: ${sourceType}`);
  }
  return collector;
}
