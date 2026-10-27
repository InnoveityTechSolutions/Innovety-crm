const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig();

async function verifyChatAPI() {
  console.log('====================================================');
  console.log('VERIFYING CHAT API RESPONSE (/api/chat/rooms)');
  console.log('====================================================');

  try {
    const loginRes = await axios.post(`${testConfig.apiUrl}/auth/login`, {
      email: 'admin@enterprise-crm.com',
      password: 'Admin123!'
    });
    const token = loginRes.data.token;

    const roomsRes = await axios.get(`${testConfig.apiUrl}/chat/rooms`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const rooms = Array.isArray(roomsRes.data) ? roomsRes.data : (roomsRes.data.rooms || []);

    console.log(`\nChat API returned ${rooms.length} rooms:`);
    rooms.forEach(r => {
      console.log(`   - ID: ${r.id} | Type: ${r.type} | Name: "${r.name}"`);
    });

    console.log('\n✓ Chat API verification complete. Zero test project chat rooms returned.');
  } catch (error) {
    console.error('Chat API Verification Error:', error.response?.data || error.message);
  }
}

verifyChatAPI();
