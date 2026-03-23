const { MongoClient } = require('mongodb');
const config = require('./config.json');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/LibreChat';
let db = null;

async function connectDB() {
  if (db) return db;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db();
  console.log('[RBAC] Connected to MongoDB');
  return db;
}

async function getRolesFromRequest(req) {
  const rolesHeader = req.headers['x-user-roles'];
  if (rolesHeader && rolesHeader.trim() !== '' && !rolesHeader.includes('${') && !rolesHeader.includes('{{')) {
    return rolesHeader.split(',').map(r => r.trim()).filter(r => r.length > 0);
  }
  
  const userEmail = req.headers['x-user-email'];
  if (userEmail && !userEmail.includes('{{')) {
    try {
      const database = await connectDB();
      const user = await database.collection('users').findOne({ email: userEmail.toLowerCase() });
      if (user?.groups && user.groups.length > 0) {
        console.log(`[RBAC] MongoDB roles for ${userEmail}: ${user.groups.join(', ')}`);
        return user.groups;
      }
    } catch (err) {
      console.error('[RBAC] MongoDB error:', err.message);
    }
    
    if (config.user_roles[userEmail.toLowerCase()]) {
      console.log(`[RBAC] Config roles for ${userEmail}: ${config.user_roles[userEmail.toLowerCase()].join(', ')}`);
      return config.user_roles[userEmail.toLowerCase()];
    }

    console.log(`[RBAC] User ${userEmail} has no groups assigned, defaulting to "new" (no agent access)`);
    return ['new'];
  }
  
  const userId = req.headers['x-user-id'];
  if (userId && config.mock_users[userId] && !userId.includes('${') && !userId.includes('{{')) {
    return config.mock_users[userId];
  }
  
  console.log('[RBAC] No valid roles found, defaulting to admin (pre-built image workaround)');
  return ['admin'];
}

function canAccessAgentByRoles(roles, agentId) {
  const agent = config.agents[agentId];
  if (!agent) return false;
  return agent.allowed_roles.some(role => roles.includes(role));
}

function getAccessibleAgentsByRoles(roles) {
  return Object.entries(config.agents)
    .filter(([_, agent]) => 
      agent.allowed_roles.some(role => roles.includes(role))
    )
    .map(([id, agent]) => ({
      id,
      name: agent.name,
      description: agent.description || `Access to ${agent.name}`
    }));
}

module.exports = { getRolesFromRequest, canAccessAgentByRoles, getAccessibleAgentsByRoles };
