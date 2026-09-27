import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

// DEMO / SYNTHETIC DATA ONLY — no real case, person, or document data.
const DEMO_PASSWORD = "Demo@1234";

async function upsertUser(email: string, name: string, role: Role) {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  console.log("Seeding NyayaVault demo data (synthetic)...");

  const admin = await upsertUser("admin@nyayavault.demo", "Admin User", "ADMIN");
  const officer = await upsertUser("officer@nyayavault.demo", "Investigating Officer Rao", "INVESTIGATING_OFFICER");
  const senior = await upsertUser("senior@nyayavault.demo", "Senior Officer Mehta", "SENIOR_OFFICER");
  const forensic = await upsertUser("forensic@nyayavault.demo", "Forensic Officer Iyer", "FORENSIC_OFFICER");
  const legal = await upsertUser("legal@nyayavault.demo", "Legal Officer Singh", "LEGAL_OFFICER");

  const caseData = [
    {
      caseNumber: "CASE-2026-0142",
      title: "Digital Fraud Investigation",
      description: "DEMO/SYNTHETIC: Suspected online payment fraud ring.",
    },
    {
      caseNumber: "CASE-2026-0143",
      title: "Cyber Extortion Complaint",
      description: "DEMO/SYNTHETIC: Ransom demand following data breach claim.",
    },
    {
      caseNumber: "CASE-2026-0144",
      title: "Corporate Document Forgery",
      description: "DEMO/SYNTHETIC: Alleged forged signatures on contracts.",
    },
    {
      caseNumber: "CASE-2026-0145",
      title: "Identity Theft Ring",
      description: "DEMO/SYNTHETIC: Multiple victims of synthetic identity fraud.",
    },
  ];

  const cases = [];
  for (const c of caseData) {
    const created = await prisma.case.upsert({
      where: { caseNumber: c.caseNumber },
      update: {},
      create: { ...c, isSynthetic: true },
    });
    cases.push(created);
  }

  // Assign officer/senior/forensic/legal to the first two cases so their
  // dashboards have something real to show in Phase 1.
  const memberAssignments: Array<{ userId: string; roleInCase: string }> = [
    { userId: officer.id, roleInCase: "LEAD_INVESTIGATOR" },
    { userId: senior.id, roleInCase: "SUPERVISOR" },
    { userId: legal.id, roleInCase: "LEGAL_REVIEWER" },
  ];

  for (const c of cases.slice(0, 2)) {
    for (const m of memberAssignments) {
      await prisma.caseMember.upsert({
        where: { caseId_userId: { caseId: c.id, userId: m.userId } },
        update: {},
        create: { caseId: c.id, userId: m.userId, roleInCase: m.roleInCase },
      });
    }
  }

  // A sample evidence item assigned to the forensic officer.
  const evidence = await prisma.evidenceItem.findFirst({
    where: { caseId: cases[0].id, name: "Seized Laptop - Exhibit A" },
  });
  if (!evidence) {
    await prisma.evidenceItem.create({
      data: {
        caseId: cases[0].id,
        name: "Seized Laptop - Exhibit A",
        description: "DEMO/SYNTHETIC: Laptop seized from suspect's residence.",
        status: "IN_ANALYSIS",
        currentCustodianId: forensic.id,
      },
    });
  }

  console.log("Seed complete.");
  console.log("Demo login password for all accounts:", DEMO_PASSWORD);
  console.log({
    admin: admin.email,
    officer: officer.email,
    senior: senior.email,
    forensic: forensic.email,
    legal: legal.email,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
