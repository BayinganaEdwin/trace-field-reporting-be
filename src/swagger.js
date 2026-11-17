/**
 * OpenAPI 3 spec for SiteLog Backend
 * Served at GET /api-docs by swagger-ui-express
 */

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Trace API',
    version: '1.0.0',
    description:
      'REST API for the SiteLog construction-reporting platform. ' +
      'All protected endpoints require a Bearer token obtained from POST /users/login.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
    {
      url: 'https://sitelog-backend-fkqs.onrender.com',
      description: 'Production (Render)',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'user-abc12345' },
          name: { type: 'string', example: 'Amara Diallo' },
          email: { type: 'string', example: 'amara@sitelog.app' },
          role: { type: 'string', enum: ['worker', 'manager', 'owner'] },
        },
      },
      Site: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'site-abc12345' },
          name: { type: 'string', example: 'Kigali Heights Phase 2' },
          location: { type: 'string', example: 'Kigali, Rwanda' },
          description: { type: 'string' },
          created_by: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Report: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'report-abc12345' },
          site_id: { type: 'string' },
          site_name: { type: 'string' },
          submitted_by_id: { type: 'string' },
          submitted_by_name: { type: 'string', example: 'Amara Diallo' },
          reported_stage: {
            type: 'string',
            enum: [
              'formwork_erected',
              'reinforcement_placed',
              'concrete_poured',
              'structure_complete',
            ],
          },
          ai_detected_stage: { type: 'string', nullable: true },
          ai_confidence: { type: 'number', example: 0.97 },
          ai_all_scores: { type: 'object', nullable: true },
          status: {
            type: 'string',
            enum: ['pending', 'verified', 'approved', 'rejected', 'flagged'],
          },
          notes: { type: 'string' },
          photo_urls: { type: 'array', items: { type: 'string' } },
          progress_delta: { type: 'number', nullable: true },
          progress_label: { type: 'string', nullable: true },
          progress_stagnant: { type: 'boolean' },
          submitted_at: { type: 'string', format: 'date-time' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          user_id: { type: 'string' },
          message: { type: 'string' },
          is_read: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Unauthorized' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Health ─────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'API health check',
        security: [],
        responses: {
          200: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    time: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Users ──────────────────────────────────────────────────────────
    '/users/register': {
      post: {
        tags: ['Users'],
        summary: 'Register a new user account',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password', 'role'],
                properties: {
                  name: { type: 'string', example: 'Amara Diallo' },
                  email: { type: 'string', example: 'amara@sitelog.app' },
                  password: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: ['worker', 'manager', 'owner'],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/users/login': {
      post: {
        tags: ['Users'],
        summary: 'Login and obtain a Bearer token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful — returns token + user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Get the authenticated user profile',
        responses: {
          200: {
            description: 'Current user',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update the authenticated user profile',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated user',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get a user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'User',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },

    // ── Sites ──────────────────────────────────────────────────────────
    '/sites': {
      get: {
        tags: ['Sites'],
        summary: 'List all sites accessible to the authenticated user',
        responses: {
          200: {
            description: 'Array of sites',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Site' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Sites'],
        summary: 'Create a new site (Manager / Owner)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  location: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Site created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Site' },
              },
            },
          },
        },
      },
    },
    '/sites/{id}': {
      get: {
        tags: ['Sites'],
        summary: 'Get a single site by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Site',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Site' },
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
      patch: {
        tags: ['Sites'],
        summary: 'Update a site (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  location: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated site' },
        },
      },
      delete: {
        tags: ['Sites'],
        summary: 'Delete a site (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/sites/{id}/workers': {
      get: {
        tags: ['Sites'],
        summary: 'List workers assigned to a site (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Array of workers',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Sites'],
        summary: 'Assign a worker to a site (Manager)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['workerId'],
                properties: { workerId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Worker assigned' },
        },
      },
    },
    '/sites/{id}/workers/{workerId}': {
      delete: {
        tags: ['Sites'],
        summary: 'Remove a worker from a site (Manager)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'workerId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Worker removed' },
        },
      },
    },
    '/sites/{id}/available-workers': {
      get: {
        tags: ['Sites'],
        summary: 'List workers not yet assigned to this site (Manager)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Array of available workers' },
        },
      },
    },

    // ── Reports ────────────────────────────────────────────────────────
    '/reports': {
      get: {
        tags: ['Reports'],
        summary:
          'List reports (filtered by role; supports ?siteId, ?status, ?workerId)',
        parameters: [
          { name: 'siteId', in: 'query', schema: { type: 'string' } },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['pending', 'verified', 'approved', 'rejected', 'flagged'],
            },
          },
          { name: 'workerId', in: 'query', schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          200: {
            description: 'Array of reports',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Report' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Reports'],
        summary: 'Submit a new report with optional site photo (Worker)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['site_id', 'reported_stage'],
                properties: {
                  site_id: { type: 'string' },
                  reported_stage: {
                    type: 'string',
                    enum: [
                      'formwork_erected',
                      'reinforcement_placed',
                      'concrete_poured',
                      'structure_complete',
                    ],
                  },
                  notes: { type: 'string' },
                  photo: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description:
              'Report submitted — AI classification runs asynchronously',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
        },
      },
    },
    '/reports/{id}': {
      get: {
        tags: ['Reports'],
        summary: 'Get a single report by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Report',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Report' },
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },
    '/reports/{id}/approve': {
      post: {
        tags: ['Reports'],
        summary: 'Approve a report (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { comment: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Report approved' },
          409: { description: 'Invalid status transition' },
        },
      },
    },
    '/reports/{id}/reject': {
      post: {
        tags: ['Reports'],
        summary: 'Reject a report with a required comment (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['comment'],
                properties: { comment: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Report rejected' },
          400: { description: 'Comment required' },
        },
      },
    },
    '/reports/{id}/flag': {
      post: {
        tags: ['Reports'],
        summary: 'Flag a report for follow-up (Manager / Owner)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { comment: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Report flagged' },
        },
      },
    },

    // ── Notifications ──────────────────────────────────────────────────
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Get notifications for the authenticated user',
        responses: {
          200: {
            description: 'Array of notifications',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Notification' },
                },
              },
            },
          },
        },
      },
    },
    '/notifications/{id}/read': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark a notification as read',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Marked as read' },
        },
      },
    },
    '/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        responses: {
          200: { description: 'All marked as read' },
        },
      },
    },

    // ── Analytics ──────────────────────────────────────────────────────
    '/analytics/summary': {
      get: {
        tags: ['Analytics'],
        summary: 'Get dashboard summary statistics (Manager / Owner)',
        responses: {
          200: {
            description: 'Summary counts and stage distribution',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalReports: { type: 'integer' },
                    pendingReports: { type: 'integer' },
                    approvedReports: { type: 'integer' },
                    flaggedReports: { type: 'integer' },
                    stageBreakdown: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
