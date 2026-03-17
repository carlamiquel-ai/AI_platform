require('dotenv').config({ path: '../.env' });
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/LibreChat';

const globalAgents = [
  {
    name: 'Farming Assistant',
    description: 'Query mortality data, create alerts, and generate farming reports. Use this agent for all farming-related questions.',
    instructions: `You are the Farming Assistant. You have access to the mortality_agent tool.

IMPORTANT: Always use the mortality_agent tool to answer questions. Never generate code or fabricate answers.

When a user asks about:
- Mortality data → Use mortality_agent
- Alerts or notifications → Use mortality_agent  
- Farming reports → Use mortality_agent

Always call the tool first, then summarize the response for the user.`,
    model: 'claude-sonnet-4-5',
    tools: ['platform-agents'],
    provider: 'Snowflake',
    isGlobal: true,
    shareLevel: 'global',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'GRDT Assistant',
    description: 'Query GRDT data and generate reports. Use this agent for all GRDT-related questions.',
    instructions: `You are the GRDT Assistant. You have access to the grdt-agent tool.

IMPORTANT: Always use the grdt-agent tool to answer questions. Never generate code or fabricate answers.

When a user asks about:
- GRDT data → Use grdt-agent
- GRDT reports → Use grdt-agent

Always call the tool first, then summarize the response for the user.`,
    model: 'claude-sonnet-4-5',
    tools: ['platform-agents'],
    provider: 'Snowflake',
    isGlobal: true,
    shareLevel: 'global',
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function seedAgents() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const collection = db.collection('agents');

    for (const agent of globalAgents) {
      const existing = await collection.findOne({ name: agent.name, isGlobal: true });
      
      if (existing) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: { ...agent, updatedAt: new Date() } }
        );
        console.log(`Updated agent: ${agent.name}`);
      } else {
        await collection.insertOne(agent);
        console.log(`Created agent: ${agent.name}`);
      }
    }
    
    console.log('\nGlobal agents seeded successfully!');
    console.log('These agents will be visible to ALL users in LibreChat.');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.close();
  }
}

seedAgents();
