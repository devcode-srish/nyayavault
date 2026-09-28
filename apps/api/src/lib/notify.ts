import { NotificationType } from "@prisma/client";
import { prisma } from "./prisma";

export async function notifyUsers(
  userIds: string[],
  params: { type: NotificationType; title: string; message: string }
) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, ...params })),
  });
}

/** Admins + Senior Officers assigned to the case: the people who can decide access requests. */
export async function approverIdsForCase(caseId: string): Promise<string[]> {
  const [admins, seniors] = await Promise.all([
    prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
    prisma.caseMember.findMany({
      where: { caseId, user: { role: "SENIOR_OFFICER", isActive: true } },
      select: { userId: true },
    }),
  ]);
  return [...admins.map((a) => a.id), ...seniors.map((s) => s.userId)];
}
