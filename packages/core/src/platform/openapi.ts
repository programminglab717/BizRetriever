import { z } from 'zod';

import { timeRangeSchema } from '../ask/interpretation';
import { API_RATE_PER_MINUTE } from './keys';
import { apiAskSchema, apiQuerySchema } from './api';
import { SERVER_INFO } from './mcp';

/** The public API's OpenAPI 3.1 description (M16), served at `/api/v1/openapi.json`. */

const schema = (s: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown>;
  return rest;
};

const table = {
  type: 'object',
  properties: {
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          kind: { type: 'string', enum: ['dimension', 'metric', 'previous'] },
          format: { type: 'string' },
        },
        required: ['key', 'label', 'kind'],
      },
    },
    rows: {
      type: 'array',
      description: 'Values keyed by column; money and decimals are exact strings.',
      items: { type: 'object', additionalProperties: { type: ['string', 'number', 'null'] } },
    },
    text: {
      type: 'array',
      description: 'The same values formatted as the app shows them.',
      items: { type: 'object', additionalProperties: { type: 'string' } },
    },
    totalRows: { type: 'integer' },
    truncated: { type: 'boolean' },
  },
  required: ['columns', 'rows', 'text', 'totalRows', 'truncated'],
};

const error = {
  description: 'Refused',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' } },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
};

const errors = {
  '401': { ...error, description: 'Missing, unknown or revoked key' },
  '429': { ...error, description: `More than ${API_RATE_PER_MINUTE} requests in a minute` },
};

const ok = (description: string, s: Record<string, unknown> = { type: 'object' }) => ({
  description,
  content: { 'application/json': { schema: s } },
});

export function openApiDocument(baseUrl: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BizRetriever API',
      version: SERVER_INFO.version,
      description:
        'Read-only access to one business’s numbers. Every number is worked out by BizRetriever from the business’s records; nothing can be changed through this API. Create a key under Settings → Connect other apps.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'A key starting with bzr_' },
      },
    },
    paths: {
      '/business': {
        get: {
          summary: 'The business the key belongs to',
          responses: {
            '200': ok('Name, industry, currency, time zone and today’s date', {
              type: 'object',
              properties: {
                name: { type: 'string' },
                industry: { type: 'string' },
                currency: { type: 'string' },
                timezone: { type: 'string' },
                today: { type: 'string', format: 'date' },
                link: { type: 'string', format: 'uri' },
              },
            }),
            ...errors,
          },
        },
      },
      '/measures': {
        get: {
          summary: 'What can be measured, and what by',
          responses: { '200': ok('Measures and the details to break them down by'), ...errors },
        },
      },
      '/query': {
        post: {
          summary: 'Work out numbers',
          description:
            'Measures (keys from /measures), optionally broken down by a detail (`product.category`) or a time grain, filtered, for a period. Defaults to all time.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(apiQuerySchema) } },
          },
          responses: {
            '200': ok('The result', {
              allOf: [
                table,
                {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    period: {
                      type: ['object', 'null'],
                      properties: {
                        from: { type: 'string' },
                        to: { type: 'string' },
                        label: { type: 'string' },
                      },
                    },
                    assumptions: { type: 'array', items: { type: 'string' } },
                  },
                },
              ],
            }),
            '400': { ...error, description: 'Not a valid query' },
            '422': { ...error, description: 'A measure or detail this business doesn’t have' },
            ...errors,
          },
        },
      },
      '/ask': {
        post: {
          summary: 'Ask a question in plain words',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(apiAskSchema) } },
          },
          responses: {
            '200': ok('The answer: a sentence, the table behind it, the assumptions made'),
            '400': { ...error, description: 'No question' },
            ...errors,
          },
        },
      },
      '/insights': {
        get: {
          summary: 'Things worth knowing, most important first',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: { '200': ok('Insights'), ...errors },
        },
      },
      '/dashboard': {
        get: {
          summary: 'The dashboard’s tiles',
          parameters: [
            {
              name: 'period',
              in: 'query',
              description: `A period preset (${(timeRangeSchema.options[0].shape.preset.options as readonly string[]).join(', ')}) or from..to (YYYY-MM-DD..YYYY-MM-DD)`,
              schema: { type: 'string' },
            },
            { name: 'compare', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': ok('Each tile’s numbers or table, formatted'), ...errors },
        },
      },
    },
  };
}
