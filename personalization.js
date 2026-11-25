/**
 * MNB Omni Caller — Universal Enterprise Personalisation Engine
 * 
 * Implements the 4-Level Configuration Hierarchy:
 *   Level 1: Organization configuration (org defaults & enabled modules)
 *   Level 2: Workspace configuration (department / team preset)
 *   Level 3: Individual user configuration (custom widgets, order, shortcuts, hidden tools)
 *   Level 4: Subscription & permission enforcement (role permissions & minute quotas)
 */

const PERSONAS = {
  sales_leader: {
    id: 'sales_leader',
    name: 'Sales & Growth Leadership',
    roleTitle: 'Sales Director / Growth Head',
    description: 'Prioritizes outbound campaigns, lead qualification, conversion velocity, and AI objection coaching.',
    recommendedWidgets: ['w_kpi_ribbon', 'w_quick_actions', 'w_campaign_progress', 'w_reminders_tasks', 'w_recent_calls', 'w_ai_coaching'],
    recommendedPinned: ['overview', 'tools', 'call', 'campaigns', 'contacts', 'reminders', 'trends', 'coaching', 'logs'],
    essentialCategories: ['calling', 'campaigns', 'insights']
  },
  call_center_mgr: {
    id: 'call_center_mgr',
    name: 'Call Center & Support Operations',
    roleTitle: 'Call Center / Operations Manager',
    description: 'Prioritizes real-time live calls, queue visibility, agent leaderboard rankings, and customer sentiment.',
    recommendedWidgets: ['w_kpi_ribbon', 'w_live_monitor', 'w_recent_calls', 'w_agent_performance', 'w_reminders_tasks', 'w_dnc_safety'],
    recommendedPinned: ['overview', 'tools', 'live', 'logs', 'lookup', 'leaderboard', 'reminders', 'blocklist', 'studio'],
    essentialCategories: ['calling', 'agents', 'insights']
  },
  executive: {
    id: 'executive',
    name: 'Executive & Strategic Command',
    roleTitle: 'CEO / Founder / Managing Director',
    description: 'Focuses on strategic business health, calling runway, high-level campaign conversion, and agent quality.',
    recommendedWidgets: ['w_kpi_ribbon', 'w_quick_actions', 'w_agent_performance', 'w_campaign_progress', 'w_recent_calls'],
    recommendedPinned: ['overview', 'tools', 'live', 'analytics', 'trends', 'campaigns', 'plan', 'billing'],
    essentialCategories: ['calling', 'insights', 'numbers']
  },
  smb_founder: {
    id: 'smb_founder',
    name: 'Small Business & Lean Operator',
    roleTitle: 'Small Business Owner / Founder',
    description: 'Streamlined, straightforward workflow for instant calling, automatic follow-ups, and prepaid minute tracking.',
    recommendedWidgets: ['w_quick_actions', 'w_kpi_ribbon', 'w_recent_calls', 'w_reminders_tasks'],
    recommendedPinned: ['overview', 'tools', 'getstarted', 'call', 'logs', 'contacts', 'plan', 'studio'],
    essentialCategories: ['calling', 'campaigns']
  },
  agency_admin: {
    id: 'agency_admin',
    name: 'Agency & Multi-Client Consultant',
    roleTitle: 'Agency Partner / Lead Gen Consultant',
    description: 'Focuses on multi-agent deployment, white-labeled voice widgets, number provisioning, and data export.',
    recommendedWidgets: ['w_kpi_ribbon', 'w_quick_actions', 'w_agent_performance', 'w_campaign_progress', 'w_recent_calls'],
    recommendedPinned: ['overview', 'tools', 'studio', 'templates', 'voicewidget', 'campaigns', 'export', 'numbers', 'billing'],
    essentialCategories: ['agents', 'campaigns', 'numbers']
  },
  tech_dev: {
    id: 'tech_dev',
    name: 'Developer & Technical Integrator',
    roleTitle: 'Full-Stack Engineer / Integrator',
    description: 'Focuses on REST API integration, webhook endpoints, event logging, and embeddable Web Voice SDK.',
    recommendedWidgets: ['w_kpi_ribbon', 'w_quick_actions', 'w_api_health', 'w_live_monitor', 'w_recent_calls'],
    recommendedPinned: ['overview', 'tools', 'apikeys', 'integrations', 'voicewidget', 'testing', 'logs'],
    essentialCategories: ['agents', 'settings']
  }
};

const WIDGETS_CATALOG = {
  w_kpi_ribbon: {
    id: 'w_kpi_ribbon',
    title: 'Executive KPI Metrics',
    description: 'Wallet minutes remaining, total calls made, connect rate percentage, average duration, and customer sentiment index.',
    category: 'metrics',
    size: 'full',
    defaultEnabled: true
  },
  w_quick_actions: {
    id: 'w_quick_actions',
    title: 'Quick Dispatch & Actions',
    description: 'One-click shortcuts: place instant call, create new agent, launch campaign, test voice widget, or reload wallet.',
    category: 'actions',
    size: 'half',
    defaultEnabled: true
  },
  w_live_monitor: {
    id: 'w_live_monitor',
    title: 'Live Concurrent Calls',
    description: 'Real-time ticker showing active ongoing calls, active duration timers, and live dispatch state.',
    category: 'operations',
    size: 'half',
    defaultEnabled: false
  },
  w_recent_calls: {
    id: 'w_recent_calls',
    title: 'Recent Calls & Recordings',
    description: 'Interactive call feed with one-click audio playback, sentiment indicators, outcome chips, and transcript inspection.',
    category: 'feed',
    size: 'full',
    defaultEnabled: true
  },
  w_agent_performance: {
    id: 'w_agent_performance',
    title: 'AI Agent Performance',
    description: 'Comparative overview of deployed voice bots, total call counts, connect rates, and average sentiment.',
    category: 'analytics',
    size: 'half',
    defaultEnabled: true
  },
  w_campaign_progress: {
    id: 'w_campaign_progress',
    title: 'Outbound Campaigns Tracker',
    description: 'Progress bars for active outbound campaigns, connected leads, voicemails, and completion status.',
    category: 'operations',
    size: 'half',
    defaultEnabled: false
  },
  w_ai_coaching: {
    id: 'w_ai_coaching',
    title: 'AI Coaching & Objection Feed',
    description: 'Automated intelligence analyzing recent call transcripts to identify friction points and recommended talking points.',
    category: 'intelligence',
    size: 'half',
    defaultEnabled: false
  },
  w_reminders_tasks: {
    id: 'w_reminders_tasks',
    title: 'Pending Reminders & Callbacks',
    description: 'Scheduled callbacks and customer follow-up tasks with instant one-click redialing.',
    category: 'operations',
    size: 'half',
    defaultEnabled: false
  },
  w_dnc_safety: {
    id: 'w_dnc_safety',
    title: 'Compliance & DNC Guard',
    description: 'Do-Not-Call safeguard status, active blocked numbers count, and compliance health.',
    category: 'compliance',
    size: 'half',
    defaultEnabled: false
  },
  w_api_health: {
    id: 'w_api_health',
    title: 'API & Webhook Integration Health',
    description: 'Status of active API keys, recent API calls, webhook delivery health, and OpenAPI specification.',
    category: 'developer',
    size: 'half',
    defaultEnabled: false
  }
};

const MODULES_REGISTRY = [
  // --- Category: Core & Home ---
  {
    id: 'overview',
    name: 'Personal Command Center',
    shortName: 'Overview',
    description: 'Configurable personal dashboard displaying role-tailored KPIs, recent activity, and workflow widgets.',
    category: 'home',
    categoryLabel: 'Home & Core',
    icon: '&#9703;',
    badge: 'Core',
    route: 'overview',
    targetRoles: ['executive', 'sales_leader', 'call_center_mgr', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: true
  },
  {
    id: 'getstarted',
    name: 'Intelligent Onboarding Wizard',
    shortName: 'Get Started',
    description: 'Guided discovery flow to personalize your workspace, configure voice agents, and launch your first live call.',
    category: 'home',
    categoryLabel: 'Home & Core',
    icon: '&#128640;',
    badge: 'Setup',
    route: 'getstarted',
    targetRoles: ['executive', 'sales_leader', 'call_center_mgr', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: true
  },
  {
    id: 'tools',
    name: 'Tools & Capabilities Directory',
    shortName: 'Tools Directory',
    description: 'Central registry of all enterprise capabilities, searchable by category and role, with custom pinning controls.',
    category: 'home',
    categoryLabel: 'Home & Core',
    icon: '&#8862;',
    badge: 'Directory',
    route: 'tools',
    targetRoles: ['executive', 'sales_leader', 'call_center_mgr', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: true
  },

  // --- Category: Calling & Telephony ---
  {
    id: 'call',
    name: 'Place a Call (Direct Dispatcher)',
    shortName: 'Place a Call',
    description: 'Interactive dialer to dispatch ad-hoc AI voice calls with custom parameters, notes, and dynamic caller ID.',
    category: 'calling',
    categoryLabel: 'Calling & Telephony',
    icon: '&#9990;',
    badge: 'Telephony',
    route: 'call',
    targetRoles: ['sales_leader', 'call_center_mgr', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_quick_actions',
    defaultVisible: true
  },
  {
    id: 'live',
    name: 'Live Calls Monitor',
    shortName: 'Live Monitor',
    description: 'Real-time observation of active in-progress calls, concurrent connection volume, and live connection timers.',
    category: 'calling',
    categoryLabel: 'Calling & Telephony',
    icon: '&#9673;',
    badge: 'Real-Time',
    route: 'live',
    targetRoles: ['call_center_mgr', 'executive', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_live_monitor',
    defaultVisible: true
  },
  {
    id: 'logs',
    name: 'Call History, Transcripts & Audio',
    shortName: 'Call Logs',
    description: 'Searchable call repository with verbatim transcripts, AI conversation summaries, sentiment analysis, and playable recordings.',
    category: 'calling',
    categoryLabel: 'Calling & Telephony',
    icon: '&#8801;',
    badge: 'Intelligence',
    route: 'logs',
    targetRoles: ['sales_leader', 'call_center_mgr', 'executive', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_recent_calls',
    defaultVisible: true
  },
  {
    id: 'blocklist',
    name: 'Do-Not-Call (DNC) Compliance Guard',
    shortName: 'DNC Blocklist',
    description: 'Managed suppression list preventing calls to opted-out numbers, ensuring regulatory compliance across campaigns.',
    category: 'calling',
    categoryLabel: 'Calling & Telephony',
    icon: '&#128683;',
    badge: 'Compliance',
    route: 'blocklist',
    targetRoles: ['call_center_mgr', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_dnc_safety',
    defaultVisible: false
  },

  // --- Category: Agent Studio & AI ---
  {
    id: 'studio',
    name: 'Agent Studio & Prompt Designer',
    shortName: 'Agent Studio',
    description: 'Design and configure conversational voice agents: system instructions, welcome greetings, voice timbre, and LLM behavior.',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#9998;',
    badge: 'Voice AI',
    route: 'studio',
    targetRoles: ['sales_leader', 'call_center_mgr', 'agency_admin', 'smb_founder', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_agent_performance',
    defaultVisible: true
  },
  {
    id: 'templates',
    name: 'Vertical Agent Blueprints Gallery',
    shortName: 'Agent Templates',
    description: 'Pre-built, field-tested voice agent templates for real estate, healthcare appointments, e-commerce, and loan follow-ups.',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#128218;',
    badge: 'Templates',
    route: 'templates',
    targetRoles: ['sales_leader', 'agency_admin', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'knowledge',
    name: 'Multi-Format Knowledge Base',
    shortName: 'Knowledge Base',
    description: 'Upload PDF documentation, FAQs, and URLs to equip your voice agents with accurate, hallucination-free business knowledge.',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#9636;',
    badge: 'RAG',
    route: 'knowledge',
    targetRoles: ['agency_admin', 'call_center_mgr', 'tech_dev', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: true
  },
  {
    id: 'testing',
    name: 'Agent Simulations & Prompt Tuning',
    shortName: 'Agent Testing',
    description: 'Test conversational flows in the browser, simulate complex buyer objections, and receive automated AI prompt improvements.',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#129514;',
    badge: 'QA / Lab',
    route: 'testing',
    targetRoles: ['agency_admin', 'tech_dev', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'versions',
    name: 'Agent Version Control & Rollback',
    shortName: 'Version History',
    description: 'Save named snapshots of agent instructions and configurations, inspect diffs, and restore previous iterations instantly.',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#128220;',
    badge: 'DevOps',
    route: 'versions',
    targetRoles: ['tech_dev', 'agency_admin', 'call_center_mgr'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'voicewidget',
    name: 'Web Voice Assistant & Embed SDK',
    shortName: 'Voice Widget',
    description: 'Deploy real-time interactive voice agents directly on your website via a lightweight embed script (omni-widget.js).',
    category: 'agents',
    categoryLabel: 'Agent Studio & AI',
    icon: '&#127908;',
    badge: 'Web SDK',
    route: 'voicewidget',
    targetRoles: ['tech_dev', 'agency_admin', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },

  // --- Category: Campaigns & Leads ---
  {
    id: 'campaigns',
    name: 'Autonomous Bulk Outbound Campaigns',
    shortName: 'Campaigns',
    description: 'Upload customer contact lists, configure scheduling, and automate high-scale voice outreach with live progress metrics.',
    category: 'campaigns',
    categoryLabel: 'Campaigns & Leads',
    icon: '&#8694;',
    badge: 'Outreach',
    route: 'campaigns',
    targetRoles: ['sales_leader', 'executive', 'agency_admin'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_campaign_progress',
    defaultVisible: true
  },
  {
    id: 'contacts',
    name: 'Contact Relationship Manager (CRM)',
    shortName: 'Contacts CRM',
    description: 'Directory of called leads and contacts, historical interaction logs, customized tags, notes, and quick redialing.',
    category: 'campaigns',
    categoryLabel: 'Campaigns & Leads',
    icon: '&#128101;',
    badge: 'CRM',
    route: 'contacts',
    targetRoles: ['sales_leader', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'followups',
    name: 'Scheduled Follow-Ups & Cadences',
    shortName: 'Follow-ups',
    description: 'Automated follow-up queue for prospects requiring subsequent contact after initial qualification.',
    category: 'campaigns',
    categoryLabel: 'Campaigns & Leads',
    icon: '&#8635;',
    badge: 'Automation',
    route: 'followups',
    targetRoles: ['sales_leader', 'call_center_mgr'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'reminders',
    name: 'Callback Reminders Hub',
    shortName: 'Reminders',
    description: 'Time-sensitive callback alerts and scheduled tasks with direct one-click dialer integration.',
    category: 'campaigns',
    categoryLabel: 'Campaigns & Leads',
    icon: '&#9200;',
    badge: 'Tasks',
    route: 'reminders',
    targetRoles: ['sales_leader', 'call_center_mgr', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_reminders_tasks',
    defaultVisible: false
  },
  {
    id: 'lookup',
    name: 'Contact 360 & Number Intelligence',
    shortName: 'Number Lookup',
    description: 'Lookup any phone number to view lifetime calling history, aggregate sentiment trajectory, and automated profile summaries.',
    category: 'campaigns',
    categoryLabel: 'Campaigns & Leads',
    icon: '&#128269;',
    badge: 'Intelligence',
    route: 'lookup',
    targetRoles: ['call_center_mgr', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },

  // --- Category: Insights & Analytics ---
  {
    id: 'analytics',
    name: 'Conversational Intelligence & Analytics',
    shortName: 'Analytics',
    description: 'Deep analytical breakdown of call volumes, sentiment breakdown, conversion rates, and hourly activity peaks.',
    category: 'insights',
    categoryLabel: 'Insights & Analytics',
    icon: '&#9680;',
    badge: 'Analytics',
    route: 'analytics',
    targetRoles: ['executive', 'sales_leader', 'call_center_mgr'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_kpi_ribbon',
    defaultVisible: false
  },
  {
    id: 'trends',
    name: 'Performance Trends & Trajectory',
    shortName: 'Trends',
    description: 'Historical multi-day line charts visualizing call volume, connection rates, and customer sentiment over time.',
    category: 'insights',
    categoryLabel: 'Insights & Analytics',
    icon: '&#128200;',
    badge: 'Trends',
    route: 'trends',
    targetRoles: ['executive', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'coaching',
    name: 'AI Coaching Inbox & Friction Analysis',
    shortName: 'AI Coaching',
    description: 'Automated extraction of recurrent customer objections, competitive mentions, and actionable agent coaching recommendations.',
    category: 'insights',
    categoryLabel: 'Insights & Analytics',
    icon: '&#129302;',
    badge: 'AI Insights',
    route: 'coaching',
    targetRoles: ['sales_leader', 'call_center_mgr', 'executive'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_ai_coaching',
    defaultVisible: false
  },
  {
    id: 'leaderboard',
    name: 'Voice Agent Performance Leaderboard',
    shortName: 'Leaderboard',
    description: 'Rank your deployed voice bots by connect rate, conversion percentage, call duration, and customer satisfaction.',
    category: 'insights',
    categoryLabel: 'Insights & Analytics',
    icon: '&#127942;',
    badge: 'Ranking',
    route: 'leaderboard',
    targetRoles: ['call_center_mgr', 'sales_leader', 'executive'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_agent_performance',
    defaultVisible: false
  },
  {
    id: 'export',
    name: 'Enterprise Data Export Center',
    shortName: 'Export Center',
    description: 'Secure batch export of call transcripts, operational logs, CRM contacts, and financial records in CSV and JSON formats.',
    category: 'insights',
    categoryLabel: 'Insights & Analytics',
    icon: '&#128190;',
    badge: 'Data',
    route: 'export',
    targetRoles: ['executive', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },

  // --- Category: Numbers & Telephony ---
  {
    id: 'numbers',
    name: 'Virtual Numbers & Carrier Trunks',
    shortName: 'Phone Numbers',
    description: 'Manage virtual caller IDs, attach numbers to agents, or connect your existing Twilio, Exotel, or SIP trunks.',
    category: 'numbers',
    categoryLabel: 'Numbers & Telephony',
    icon: '&#9742;',
    badge: 'Telephony',
    route: 'numbers',
    targetRoles: ['executive', 'agency_admin', 'tech_dev', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: true
  },
  {
    id: 'plan',
    name: 'Calling Minutes Wallet & Usage Quota',
    shortName: 'Plan & Usage',
    description: 'Prepaid calling minute balance, per-minute pricing (Rs12/min), consumption history, and refill triggers.',
    category: 'numbers',
    categoryLabel: 'Numbers & Telephony',
    icon: '&#9672;',
    badge: 'Billing',
    route: 'plan',
    targetRoles: ['executive', 'smb_founder', 'agency_admin'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_kpi_ribbon',
    defaultVisible: true
  },
  {
    id: 'billing',
    name: 'Secure Cashfree Wallet Recharge',
    shortName: 'Billing & Top Up',
    description: 'Instant prepaid wallet top-up via UPI, Cards, or NetBanking with automated tax invoices and payment history.',
    category: 'numbers',
    categoryLabel: 'Numbers & Telephony',
    icon: '&#128179;',
    badge: 'Payments',
    route: 'billing',
    targetRoles: ['executive', 'smb_founder'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },

  // --- Category: Settings & Enterprise ---
  {
    id: 'account',
    name: 'Organization Profile & Security Settings',
    shortName: 'Account & Security',
    description: 'Update company profile, change passwords, select business industry, and review security audit trail.',
    category: 'settings',
    categoryLabel: 'Settings & Enterprise',
    icon: '&#128100;',
    badge: 'Security',
    route: 'account',
    targetRoles: ['executive', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'apikeys',
    name: 'Developer REST API & Token Management',
    shortName: 'API Keys',
    description: 'Generate, rotate, and manage scoped 256-bit API keys with overlap windows for seamless CRM and backend integration.',
    category: 'settings',
    categoryLabel: 'Settings & Enterprise',
    icon: '&#128273;',
    badge: 'Developer',
    route: 'apikeys',
    targetRoles: ['tech_dev', 'agency_admin'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_api_health',
    defaultVisible: false
  },
  {
    id: 'integrations',
    name: 'Enterprise Webhooks & WhatsApp Connect',
    shortName: 'Integrations',
    description: 'Real-time webhook notifications for call events, WhatsApp summary delivery via Cloud API, and Slack alerts.',
    category: 'settings',
    categoryLabel: 'Settings & Enterprise',
    icon: '&#128279;',
    badge: 'Integrations',
    route: 'integrations',
    targetRoles: ['tech_dev', 'sales_leader'],
    requiredPermissions: ['authenticated'],
    hasWidget: true,
    widgetId: 'w_api_health',
    defaultVisible: false
  },
  {
    id: 'help',
    name: 'Help Center, Documentation & Updates',
    shortName: 'Help & Docs',
    description: 'Comprehensive platform documentation, quick shortcuts guide, FAQs, and product changelog.',
    category: 'settings',
    categoryLabel: 'Settings & Enterprise',
    icon: '&#10067;',
    badge: 'Support',
    route: 'help',
    targetRoles: ['executive', 'sales_leader', 'call_center_mgr', 'smb_founder', 'agency_admin', 'tech_dev'],
    requiredPermissions: ['authenticated'],
    hasWidget: false,
    defaultVisible: false
  },
  {
    id: 'admin',
    name: 'Super-Admin Governance & Provisioning',
    shortName: 'Admin Control',
    description: 'Enterprise tenant governance: manage organization accounts, allocate calling minutes, rotate master keys, and system backups.',
    category: 'settings',
    categoryLabel: 'Settings & Enterprise',
    icon: '&#9881;',
    badge: 'SuperAdmin',
    route: 'admin',
    targetRoles: ['executive'],
    requiredPermissions: ['admin'],
    hasWidget: false,
    defaultVisible: false
  }
];

/**
 * Returns default personalization object for a given role and user
 */
function getDefaultPersonalization(role = 'sales_leader', user = {}) {
  const persona = PERSONAS[role] || PERSONAS.sales_leader;
  const isAdmin = user && user.role === 'admin';
  
  const pinned = [...persona.recommendedPinned];
  if (isAdmin && !pinned.includes('admin')) {
    pinned.push('admin');
  }

  return {
    version: 2,
    role: persona.id,
    industry: (user && user.businessType) || 'general',
    primaryObjective: 'lead_qualification',
    layoutPreset: persona.id,
    widgets: [...persona.recommendedWidgets],
    pinnedTools: pinned,
    hiddenModules: [],
    favorites: ['call', 'logs', 'studio'],
    density: 'comfortable',
    onboardingCompleted: true,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Evaluates the 4 states for every module in MODULES_REGISTRY:
 *   Available: exists in codebase
 *   Enabled: org admin has not disabled it
 *   Visible: user has selected it for their personal navigation/dashboard
 *   Permitted: user meets role/permission requirements
 */
function calculateModuleStates(user, orgSettings = {}, userPrefs = null) {
  const isAdmin = user && user.role === 'admin';
  const orgModules = orgSettings.modules || {};
  const prefs = userPrefs || getDefaultPersonalization(user && user.role === 'admin' ? 'executive' : 'sales_leader', user);
  const pinnedSet = new Set(prefs.pinnedTools || []);
  const hiddenSet = new Set(prefs.hiddenModules || []);
  const favSet = new Set(prefs.favorites || []);
  const widgetSet = new Set(prefs.widgets || []);

  return MODULES_REGISTRY.map((mod) => {
    // 1. Available: module exists in platform registry
    const available = true;

    // 2. Enabled: org-level admin switch (Level 1)
    const enabled = orgModules[mod.id] !== false;

    // 3. Permitted: user role / permission check (Level 4)
    let permitted = true;
    if (mod.requiredPermissions.includes('admin') && !isAdmin) {
      permitted = false;
    }

    // 4. Visible: user has chosen to display it (Level 3)
    const isExplicitlyPinned = pinnedSet.has(mod.id);
    const isExplicitlyHidden = hiddenSet.has(mod.id);
    const visible = isExplicitlyPinned || (mod.defaultVisible && !isExplicitlyHidden);

    return {
      id: mod.id,
      name: mod.name,
      shortName: mod.shortName,
      description: mod.description,
      category: mod.category,
      categoryLabel: mod.categoryLabel,
      icon: mod.icon,
      badge: mod.badge,
      route: mod.route,
      targetRoles: mod.targetRoles,
      requiredPermissions: mod.requiredPermissions,
      hasWidget: mod.hasWidget,
      widgetId: mod.widgetId,
      isFavorite: favSet.has(mod.id),
      hasActiveWidget: mod.widgetId ? widgetSet.has(mod.widgetId) : false,
      // The 4 distinct states:
      available,
      enabled,
      visible,
      permitted
    };
  });
}

/**
 * Validates and sanitizes incoming personalization update payload
 */
function sanitizePersonalization(payload, existing = null, user = {}) {
  const current = existing || getDefaultPersonalization('sales_leader', user);
  const validRole = (payload.role && PERSONAS[payload.role]) ? payload.role : current.role;
  const validWidgetsCatalog = Object.keys(WIDGETS_CATALOG);
  const validModuleIds = new Set(MODULES_REGISTRY.map((m) => m.id));

  // Sanitize widgets list
  let widgets = current.widgets;
  if (Array.isArray(payload.widgets)) {
    widgets = payload.widgets
      .filter((w) => typeof w === 'string' && validWidgetsCatalog.includes(w))
      .slice(0, 20);
    if (!widgets.length) widgets = PERSONAS[validRole].recommendedWidgets;
  }

  // Sanitize pinned tools
  let pinnedTools = current.pinnedTools;
  if (Array.isArray(payload.pinnedTools)) {
    pinnedTools = payload.pinnedTools
      .filter((id) => typeof id === 'string' && validModuleIds.has(id))
      .slice(0, 35);
  }

  // Sanitize hidden modules
  let hiddenModules = current.hiddenModules || [];
  if (Array.isArray(payload.hiddenModules)) {
    hiddenModules = payload.hiddenModules
      .filter((id) => typeof id === 'string' && validModuleIds.has(id))
      .slice(0, 35);
  }

  // Sanitize favorites
  let favorites = current.favorites || [];
  if (Array.isArray(payload.favorites)) {
    favorites = payload.favorites
      .filter((id) => typeof id === 'string' && validModuleIds.has(id))
      .slice(0, 20);
  }

  return {
    version: 2,
    role: validRole,
    industry: String(payload.industry || current.industry || 'general').slice(0, 50),
    primaryObjective: String(payload.primaryObjective || current.primaryObjective || 'lead_qualification').slice(0, 60),
    layoutPreset: String(payload.layoutPreset || validRole).slice(0, 30),
    widgets: widgets,
    pinnedTools: pinnedTools,
    hiddenModules: hiddenModules,
    favorites: favorites,
    density: payload.density === 'compact' ? 'compact' : 'comfortable',
    onboardingCompleted: payload.onboardingCompleted !== undefined ? Boolean(payload.onboardingCompleted) : current.onboardingCompleted,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  PERSONAS,
  WIDGETS_CATALOG,
  MODULES_REGISTRY,
  getDefaultPersonalization,
  calculateModuleStates,
  sanitizePersonalization
};
