const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/LibreChat';

const GROUPS_TO_CREATE = [
  { name: 'farming_user', description: 'Access to Farming Agent' },
  { name: 'grdt_user', description: 'Access to GRDT Agent' },
  { name: 'bi_user', description: 'Access to BI Agent' },
  { name: 'admin', description: 'Full admin access to all agents' }
];

async function setupGroups() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const groupsCollection = db.collection('groups');
    
    for (const group of GROUPS_TO_CREATE) {
      const existing = await groupsCollection.findOne({ name: group.name });
      if (existing) {
        console.log(`Group '${group.name}' already exists`);
      } else {
        await groupsCollection.insertOne({
          name: group.name,
          description: group.description,
          members: [],
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log(`Created group '${group.name}'`);
      }
    }
    
    console.log('\nGroups setup complete!');
    console.log('\nTo assign users to groups, use the LibreChat Admin Panel or run:');
    console.log('db.users.updateOne({ email: "user@example.com" }, { $addToSet: { groups: "farming_user" } })');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

setupGroups();
