import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { moneyToPaise } from "../lib/finance.js";

const router = Router();
router.use(requireAuth);

async function friendshipExists(tx, a, b) {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  return tx.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
}

router.get("/", asyncHandler(async (req, res) => {
  const settlements = await prisma.settlement.findMany({
    where: { OR: [{ payerId: req.userId }, { receiverId: req.userId }] },
    include: {
      payer: { select: { id: true, name: true } },
      receiver: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      approvals: true
    },
    orderBy: { createdAt: "desc" }
  });
  res.json({ settlements });
}));

router.post("/", asyncHandler(async (req, res) => {
  const payerId = String(req.body.payerId || "");
  const receiverId = String(req.body.receiverId || "");
  const amountPaise = moneyToPaise(req.body.amount);
  const note = req.body.note ? String(req.body.note).trim().slice(0, 300) : null;
  if (payerId === receiverId) throw new AppError(400, "Payer and receiver must be different.");
  if (![payerId, receiverId].includes(req.userId)) throw new AppError(403, "You must be the payer or receiver.");
  if (!(await friendshipExists(prisma, payerId, receiverId))) throw new AppError(403, "Settlement is only allowed between accepted friends.");
  const payerEntries = await prisma.ledgerEntry.findMany({
    where: { userId: payerId, counterpartyId: receiverId },
    select: { amountPaise: true }
  });
  const payerNet = payerEntries.reduce((sum, entry) => sum + entry.amountPaise, 0);
  if (payerNet >= 0) throw new AppError(400, "The selected payer does not currently owe this person.");
  if (amountPaise > Math.abs(payerNet)) throw new AppError(400, "Settlement amount cannot exceed the outstanding debt.");
  const settlement = await prisma.settlement.create({
    data: {
      payerId, receiverId, creatorId: req.userId, amountPaise, note,
      status: "PENDING",
      approvals: { create: [{ userId: payerId === req.userId ? receiverId : payerId }] }
    }
  });
  res.status(201).json({ message: "Settlement submitted for confirmation.", settlement });
}));

router.post("/:id/respond", asyncHandler(async (req, res) => {
  const decision = req.body.decision;
  const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 300) : null;
  if (!["APPROVED", "REJECTED"].includes(decision)) throw new AppError(400, "Decision must be APPROVED or REJECTED.");
  const result = await prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
    if (!settlement || settlement.status !== "PENDING") throw new AppError(404, "Pending settlement not found.");
    const approval = settlement.approvals.find((a) => a.userId === req.userId);
    if (!approval || approval.status !== "PENDING") throw new AppError(403, "You cannot respond to this settlement.");
    await tx.settlementApproval.update({ where: { id: approval.id }, data: { status: decision, comment, decidedAt: new Date() } });
    if (decision === "REJECTED") {
      await tx.settlement.update({ where: { id: settlement.id }, data: { status: "REJECTED" } });
      return { status: "REJECTED", message: "Settlement rejected. Balances were not changed." };
    }
    await tx.settlement.update({ where: { id: settlement.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
    await tx.ledgerEntry.createMany({
      data: [
        { userId: settlement.payerId, counterpartyId: settlement.receiverId, amountPaise: settlement.amountPaise, type: "SETTLEMENT", settlementId: settlement.id },
        { userId: settlement.receiverId, counterpartyId: settlement.payerId, amountPaise: -settlement.amountPaise, type: "SETTLEMENT", settlementId: settlement.id }
      ]
    });
    return { status: "CONFIRMED", message: "Settlement confirmed and balances updated." };
  }, { isolationLevel: "Serializable" });
  res.json(result);
}));

export default router;


