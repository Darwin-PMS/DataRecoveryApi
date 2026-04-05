import { FastifyInstance, FastifyPluginOptions } from 'fastify';

const plans = [
  {
    id: 'free',
    name: 'Free',
    tier: 'FREE',
    description: 'For individuals getting started',
    price: { monthly: 0, annual: 0, currency: 'USD' },
    features: [
      { name: '5 scans per month', description: 'Basic scanning', included: true },
      { name: '1 GB storage', description: 'Cloud storage', included: true },
      { name: 'Basic recovery', description: 'Standard file types', included: true },
      { name: 'Community support', description: 'Forum help', included: true },
    ],
    limits: {
      storage: 1073741824,
      users: 1,
      scansPerMonth: 5,
      jobsPerMonth: 10,
      apiCalls: 100,
      retentionDays: 7,
      support: 'community',
      features: ['quick_scan', 'basic_recovery'],
    },
    available: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    tier: 'PRO',
    description: 'For professionals and small teams',
    price: { monthly: 49, annual: 470, currency: 'USD' },
    popular: true,
    features: [
      { name: 'Unlimited scans', description: 'No limits', included: true },
      { name: '100 GB storage', description: 'Ample space', included: true },
      { name: 'RAID recovery', description: 'Complex arrays', included: true },
      { name: 'AI recommendations', description: 'Smart suggestions', included: true },
      { name: 'Priority support', description: 'Email help', included: true },
    ],
    limits: {
      storage: 107374182400,
      users: 5,
      scansPerMonth: -1,
      jobsPerMonth: -1,
      apiCalls: 10000,
      retentionDays: 30,
      support: 'email',
      features: ['quick_scan', 'deep_scan', 'raid_recovery', 'carving', 'ai_recommendations'],
    },
    available: true,
  },
  {
    id: 'business',
    name: 'Business',
    tier: 'BUSINESS',
    description: 'For growing businesses',
    price: { monthly: 149, annual: 1430, currency: 'USD' },
    features: [
      { name: 'Everything in Pro', description: '', included: true },
      { name: '1 TB storage', description: 'Large capacity', included: true },
      { name: 'Team collaboration', description: 'Multi-user access', included: true },
      { name: 'Cloud connectors', description: 'M365, Google', included: true },
      { name: 'Ransomware protection', description: 'Immutable backups', included: true },
      { name: 'Dedicated support', description: '24/7 help', included: true },
    ],
    limits: {
      storage: 1099511627776,
      users: 25,
      scansPerMonth: -1,
      jobsPerMonth: -1,
      apiCalls: 100000,
      retentionDays: 90,
      support: 'priority',
      features: ['quick_scan', 'deep_scan', 'raid_recovery', 'carving', 'ai_recommendations', 'cloud_connectors', 'ransomware_protection', 'team_management'],
    },
    available: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tier: 'ENTERPRISE',
    description: 'For large organizations',
    price: { monthly: 0, annual: 0, currency: 'USD' },
    features: [
      { name: 'Everything in Business', description: '', included: true },
      { name: 'Unlimited storage', description: 'No limits', included: true },
      { name: 'Digital forensics', description: 'Investigation tools', included: true },
      { name: 'SSO & SAML', description: 'Enterprise auth', included: true },
      { name: 'Custom SLA', description: 'Guaranteed uptime', included: true },
      { name: 'White-label', description: 'Custom branding', included: true },
    ],
    limits: {
      storage: -1,
      users: -1,
      scansPerMonth: -1,
      jobsPerMonth: -1,
      apiCalls: -1,
      retentionDays: -1,
      support: 'dedicated',
      features: ['*'],
    },
    available: true,
  },
];

export async function billingRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions
) {
  app.get('/plans', async (request, reply) => {
    return reply.send({ plans });
  });

  app.get('/usage', async (request, reply) => {
    return reply.send({
      usage: {
        storage: { used: 0, limit: 107374182400, percentage: 0 },
        users: { count: 1, limit: 5 },
        scans: { thisMonth: 0, lastMonth: 0, limit: -1 },
        jobs: { total: 0, active: 0, completed: 0, failed: 0 },
      },
    });
  });

  app.get('/invoices', async (request, reply) => {
    return reply.send({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  app.post('/subscribe', async (request, reply) => {
    return reply.status(201).send({
      subscription: {
        id: '1',
        planId: 'pro',
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
  });

  app.post('/portal', async (request, reply) => {
    return reply.send({ url: 'https://billing.stripe.com/session/test' });
  });
}
