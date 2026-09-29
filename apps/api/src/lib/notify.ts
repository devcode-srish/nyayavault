import { NotificationPriority, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface NotifyParams {
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  category?: string;
  actionUrl?: string;
}

export async function notifyUsers(
  userIds: string[],
  params: NotifyParams,
  tx?: Prisma.TransactionClient
) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;

  const db = tx || prisma;
  await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      priority: params.priority || "INFO",
      category: params.category || "SYSTEM",
      actionUrl: params.actionUrl || null,
    })),
  });
}

/** Admins + Senior Officers assigned to the case: the people who can decide access requests. */
export async function approverIdsForCase(caseId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
  const db = tx || prisma;
  const [admins, seniors] = await Promise.all([
    db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
    db.caseMember.findMany({
      where: { caseId, user: { role: "SENIOR_OFFICER", isActive: true } },
      select: { userId: true },
    }),
  ]);
  return [...admins.map((a) => a.id), ...seniors.map((s) => s.userId)];
}
