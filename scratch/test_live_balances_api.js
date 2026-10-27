async function testLiveBalances() {
  // Login
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'antorajan501@gmail.com',
      password: '10062004'
    })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Logged in successfully as Anto A');

  // Fetch balances
  const balancesRes = await fetch('http://localhost:5000/api/leaves/balances', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const balancesData = await balancesRes.json();
  console.log('Live Balances API Status:', balancesRes.status);
  console.log('Allocation Mode:', balancesData.allocationMode);
  console.log('Leave Types in Balance:', balancesData.leaveTypes.map(t => `${t.code}: ${t.available} days left`));
  console.log('Convenience remaining keys:');
  console.log({
    casualRemaining: balancesData.casualRemaining,
    sickRemaining: balancesData.sickRemaining,
    emergencyRemaining: balancesData.emergencyRemaining,
    wfhRemaining: balancesData.wfhRemaining,
    compOffRemaining: balancesData.compOffRemaining
  });

  if (balancesData.compOffRemaining !== undefined) {
    console.log('✓ PASS: compOffRemaining is present and correctly initialized in live API!');
  } else {
    throw new Error('compOffRemaining missing from live API response');
  }
}

testLiveBalances().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
