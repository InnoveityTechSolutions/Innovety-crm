const axios = require('../backend/node_modules/axios');

async function main() {
  for (const pw of ['SuperAdmin123!', 'Admin123!', 'password123', 'admin123']) {
    try {
      const res = await axios.post('http://localhost:5000/api/auth/login', {
        userId: 'superadmin@enterprise-crm.com',
        password: pw
      });
      console.log('Login successful with password:', pw);
      return;
    } catch (err) {
      console.log('Failed with:', pw, err.response?.data?.message);
    }
  }
}
main();
