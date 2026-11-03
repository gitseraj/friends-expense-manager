import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { equalShares, expenseLedgerRows, moneyToPaise, validateShares } from "../lib/finance.js";

const router = Router();
router.use(requireAuth);

async function areFriends(tx, userId, otherId) {
  const [a, b] = userId < otherId ? [userId, otherId] : [otherId, userId];
  return tx.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
}

router.get("/", asyncHandler(async (req, res) => {
  const expenses = await prisma.expense.findMany({
    where: { OR: [{ creatorId: req.userId }, { participants: { some: { userId: req.userId } } }] },
    include: {
      creator: { select: { id: true, name: true } },
      payer: { select: { id: true, name: true } },
      participants: { include: { user: { select: { id: true, name: true } } } },
      approvals: { include: { user: { select: { id: true, name: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json({ expenses });
}));

router.get("/approvals", asyncHandler(async (req, res) => {
  const approvals = await prisma.expenseApproval.findMany({
    where: { userId: req.userId, status: "PENDING", expense: { status: "PENDING" } },
    include: {
      expense: {
        include: {
          creator: { select: { id: true, name: true } },
          payer: { select: { id: true, name: true } },
          participants: { include: { user: { select: { id: true, name: true } } } }
        }
      }
    },
    orderBy: { expense: { createdAt: "desc" } }
  });
  res.json({ approvals });
}));

router.post("/", asyncHandler(async (req, res) => {
  const description = String(req.body.description || "").trim();
  const notes = req.body.notes ? String(req.body.notes).trim().slice(0, 500) : null;
  const payerId = String(req.body.payerId || "");
  const splitMethod = req.body.splitMethod;
  if (description.length < 2 || description.length > 100) throw new AppError(400, "Description must be between 2 and 100 characters.");
  if (!["EQUAL", "CUSTOM"].includes(splitMethod)) throw new AppError(400, "Choose EQUAL or CUSTOM split.");
  const totalPaise = moneyToPaise(req.body.amount);
  const rawIds = Array.isArray(req.body.participantIds) ? req.body.participantIds.map(String) : [];
  const participantIds = [...new Set([req.userId, ...rawIds])];
  if (participantIds.length !== rawIds.length + (rawIds.includes(req.userId) ? 0 : 1)) {
    throw new AppError(400, "Duplicate participants are not allowed.");
  }
  if (!participantIds.includes(payerId)) throw new AppError(400, "The payer must be included as a participant.");
  if (participantIds.length > 30) throw new AppError(400, "An expense can have at most 30 participants.");
  for (const id of participantIds) {
    if (id !== req.userId && !(await areFriends(prisma, req.userId, id))) {
      throw new AppError(403, "You can only create expenses with accepted friends.");
    }
  }
  const participants = splitMethod === "EQUAL"
    ? equalShares(totalPaise, participantIds)
    : (Array.isArray(req.body.shares) ? req.body.shares.map((s) => ({ userId: String(s.userId), sharePaise: Number(s.sharePaise) })) : []);
  if (participants.length !== participantIds.length || participants.some((p) => !participantIds.includes(p.userId))) {
    throw new AppError(400, "Custom shares must include every participant exactly once.");
  }
  validateShares(totalPaise, participants);

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        description, notes, totalPaise, splitMethod,
        creatorId: req.userId, payerId,
        status: participantIds.length === 1 ? "CONFIRMED" : "PENDING",
        confirmedAt: participantIds.length === 1 ? new Date() : null,
        participants: { create: participants },
        approvals: { create: participantIds.filter((id) => id !== req.userId).map((userId) => ({ userId })) }
      }
    });
    return created;
  });
  // A one-person expense has no debt between users, so it correctly creates no ledger rows.
  res.status(201).json({ message: expense.status === "CONFIRMED" ? "Expense confirmed." : "Expense submitted for approval.", expense });
}));

router.post("/:id/approve", asyncHandler(async (req, res) => {
  const decision = req.body.decision;
  const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 300) : null;
  if (!["APPROVED", "REJECTED"].includes(decision)) throw new AppError(400, "Decision must be APPROVED or REJECTED.");
  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({
      where: { id: req.params.id },
      include: { participants: true, approvals: true }
    });
    if (!expense || expense.status !== "PENDING") throw new AppError(404, "Pending expense not found.");
    const participant = expense.participants.some((p) => p.userId === req.userId);
    if (!participant || expense.creatorId === req.userId) throw new AppError(403, "You are not required to approve this expense.");
    const approval = expense.approvals.find((a) => a.userId === req.userId);
    if (!approval || approval.status !== "PENDING") throw new AppError(409, "You have already responded to this expense.");
    await tx.expenseApproval.update({
      where: { id: approval.id },
      data: { status: decision, comment, decidedAt: new Date() }
    });
    if (decision === "REJECTED") {
      await tx.expense.update({ where: { id: expense.id }, data: { status: "REJECTED" } });
      return { status: "REJECTED", message: "Expense rejected. No balances were changed." };
    }
    const remaining = await tx.expenseApproval.count({ where: { expenseId: expense.id, status: "PENDING" } });
    if (remaining === 0) {
      const updated = await tx.expense.update({
        where: { id: expense.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() }
      });
      const rows = expenseLedgerRows(expense.id, expense.payerId, expense.participants, expense.totalPaise);
      if (rows.length) await tx.ledgerEntry.createMany({ data: rows });
      return { status: "CONFIRMED", message: "Everyone approved. Expense confirmed and balances updated.", expense: updated };
    }
    return { status: "PENDING", message: "Approval saved. Waiting for other participants." };
  }, { isolationLevel: "Serializable" });
  res.json(result);
}));

router.get("/balances", asyncHandler(async (req, res) => {
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId: req.userId },
    include: { counterparty: { select: { id: true, publicId: true, name: true } } }
  });
  const map = new Map();
  for (const entry of entries) {
    const id = entry.counterpartyId;
    const current = map.get(id) || { user: entry.counterparty, amountPaise: 0 };
    current.amountPaise += entry.amountPaise;
    map.set(id, current);
  }
  const friends = [...map.values()].filter((x) => x.amountPaise !== 0);
  const netPaise = friends.reduce((sum, x) => sum + x.amountPaise, 0);
  res.json({ netPaise, youAreOwedPaise: friends.filter((x) => x.amountPaise > 0).reduce((s, x) => s + x.amountPaise, 0), youOwePaise: friends.filter((x) => x.amountPaise < 0).reduce((s, x) => s - x.amountPaise, 0), friends });
}));

export default router;

