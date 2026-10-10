/** Exact Redis surface; these are serialized lease fields, never PostgreSQL columns. */
export const messagingTypingPrivacyDeclaration = {
  storage: 'redis',
  owner: 'MSG-3.4',
  purpose: 'Current authorized ephemeral channel typing projection',
  lawfulBasis: { status: 'pending', decision: 'jc0qcdvpkmqzrelpaesi3pah' },
  retention: { status: 'pending', decision: 'njiorsf64z4iqjm2dbfa3zuu' },
  erasure: 'delete',
  key: {
    pattern: '<namespace>:v1:messaging-typing:<actorId>:<channelId>',
    category: 'personal',
    visibility: 'private',
    exportable: false,
  },
  fields: {
    version: { category: 'none', exportable: true },
    actorId: { category: 'personal', visibility: 'private', exportable: true },
    channelId: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    authorityRevision: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    relationshipRevision: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    accountRevision: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    ageRevision: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    policyRevision: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
    expiresAt: {
      category: 'personal',
      visibility: 'private',
      exportable: true,
    },
  },
} as const;
