const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log('Organizations:', orgs);

  const teams = await prisma.team.findMany({
    include: {
      leader: { select: { id: true, name: true, role: true } },
      members: { include: { user: { select: { id: true, name: true, role: true } } } }
    }
  });
  console.log('Teams count:', teams.length);
  for (const t of teams) {
    console.log(`Team: ${t.name} (id: ${t.id}, org: ${t.organizationId})`);
    console.log(`  Leader: ${t.leader ? `${t.leader.name} (${t.leader.role})` : 'None'}`);
    console.log(`  Members: ${t.members.map(m => `${m.user.name} (${m.user.role})`).join(', ')}`);
  }

  const usersByRole = {
    ADMIN: await prisma.user.count({ where: { role: 'ADMIN' } }),
    TEAM_LEADER: await prisma.user.count({ where: { role: 'TEAM_LEADER' } }),
    EMPLOYEE: await prisma.user.count({ where: { role: 'EMPLOYEE' } }),
    INTERN: await prisma.user.count({ where: { role: 'INTERN' } })
  };
  console.log('User counts by role:', usersByRole);

  await prisma.$disconnect();
}

inspect().catch(console.error);
