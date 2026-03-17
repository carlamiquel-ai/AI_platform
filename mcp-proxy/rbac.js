const config = require('./config.json');

function getRolesFromRequest(req) {
  const rolesHeader = req.headers['x-user-roles'];
  if (rolesHeader && !rolesHeader.includes('${')) {
    return rolesHeader.split(',').map(r => r.trim());
  }
  const userId = req.headers['x-user-id'];
  if (userId && config.mock_users[userId] && !userId.includes('${')) {
    return config.mock_users[userId];
  }
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
