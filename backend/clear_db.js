import prisma from './prismaClient.js';

async function main() {
  const deletedConversations = await prisma.conversation.deleteMany({});
  console.log(`Deleted ${deletedConversations.count} conversations.`);

  const deletedLeads = await prisma.lead.deleteMany({});
  console.log(`Deleted ${deletedLeads.count} leads.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
