const config = require('./config.json');

async function routeToAgent(agentId, mcpRequest, apiKey) {
  const agent = config.agents[agentId];
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const response = await fetch(agent.mcp_url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mcpRequest)
  });

  return response.json();
}

module.exports = { routeToAgent };
