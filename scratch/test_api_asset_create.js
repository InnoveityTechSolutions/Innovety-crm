async function testHttpApi() {
  console.log('=== TEST 2: Testing HTTP API POST /api/assets ===\n');

  // 1. Login to get token
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'admin@enterprise-crm.com',
      password: 'Admin123!'
    })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  const orgId = loginData.user.organizationId || loginData.user.organization?.id;
  console.log('Logged in as Admin. Org ID:', orgId);

  // Test A: Predefined Category (LAPTOP)
  console.log('\n--- Request A: Predefined Category (LAPTOP) ---');
  const formA = new FormData();
  formA.append('name', 'Dell Latitude 7420');
  formA.append('category', 'LAPTOP');
  formA.append('quantity', '1');
  formA.append('brand', 'Dell');
  formA.append('model', '7420');
  formA.append('status', 'AVAILABLE');
  if (orgId) formA.append('organizationId', orgId);

  console.log('Payload entries for Request A:');
  for (const [key, value] of formA.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  const resA = await fetch('http://localhost:5000/api/assets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formA
  });
  const dataA = await resA.json();
  console.log('Response Status A:', resA.status);
  console.log('Response Body A:', JSON.stringify(dataA, null, 2));

  // If created, delete it to keep clean
  if (dataA.id) {
    await fetch(`http://localhost:5000/api/assets/${dataA.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Cleaned up test asset A.');
  }

  // Test B: Custom Category (CAMERA)
  console.log('\n--- Request B: Custom Category (CAMERA) ---');
  const formB = new FormData();
  formB.append('name', 'Sony Alpha 7IV Camera');
  formB.append('category', 'CAMERA');
  formB.append('quantity', '1');
  formB.append('brand', 'Sony');
  formB.append('model', 'A7IV');
  formB.append('status', 'AVAILABLE');
  if (orgId) formB.append('organizationId', orgId);

  console.log('Payload entries for Request B:');
  for (const [key, value] of formB.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  const resB = await fetch('http://localhost:5000/api/assets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formB
  });
  const dataB = await resB.json();
  console.log('Response Status B:', resB.status);
  console.log('Response Body B:', JSON.stringify(dataB, null, 2));

  console.log('\n=== HTTP API TEST COMPLETE ===');
}

testHttpApi().catch(console.error);
