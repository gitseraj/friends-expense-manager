import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

router.get("/", asyncHandler(async (req, res) => {
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ userAId: req.userId }, { userBId: req.userId }] },
    include: { userA: true, userB: true },
    orderBy: { createdAt: "desc" }
  });
  res.json({ friends: friendships.map((f) => {
    const u = f.userAId === req.userId ? f.userB : f.userA;
    return { id: u.id, publicId: u.publicId, name: u.name, email: u.email, friendshipId: f.id };
  }) });
}));

router.get("/requests", asyncHandler(async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    prisma.friendRequest.findMany({ where: { receiverId: req.userId, status: "PENDING" }, include: { sender: true }, orderBy: { createdAt: "desc" } }),
    prisma.friendRequest.findMany({ where: { senderId: req.userId, status: "PENDING" }, include: { receiver: true }, orderBy: { createdAt: "desc" } })
  ]);
  res.json({
    incoming: incoming.map((r) => ({ id: r.id, user: { id: r.sender.id, publicId: r.sender.publicId, name: r.sender.name } })),
    outgoing: outgoing.map((r) => ({ id: r.id, user: { id: r.receiver.id, publicId: r.receiver.publicId, name: r.receiver.name } }))
  });
}));

router.post("/request", asyncHandler(async (req, res) => {
  const publicId = String(req.body.publicId || "").trim();
  if (!publicId) throw new AppError(400, "Enter your friend's user ID.");
  const target = await prisma.user.findUnique({ where: { publicId } });
  if (!target) throw new AppError(404, "No user found with that ID.");
  if (target.id === req.userId) throw new AppError(400, "You cannot add yourself.");
  const [a, b] = pair(req.userId, target.id);
  const existingFriendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
  if (existingFriendship) throw new AppError(409, "You are already friends.");
  const existing = await prisma.friendRequest.findFirst({
    where: { OR: [{ senderId: req.userId, receiverId: target.id }, { senderId: target.id, receiverId: req.userId }], status: "PENDING" }
  });
  if (existing) throw new AppError(409, "A pending friend request already exists.");
  await prisma.friendRequest.deleteMany({
    where: { OR: [{ senderId: req.userId, receiverId: target.id }, { senderId: target.id, receiverId: req.userId }], status: "REJECTED" }
  });
  const request = await prisma.friendRequest.create({ data: { senderId: req.userId, receiverId: target.id } });
  res.status(201).json({ message: "Friend request sent.", requestId: request.id });
}));

router.post("/requests/:id/respond", asyncHandler(async (req, res) => {
  const decision = req.body.decision;
  if (!["ACCEPTED", "REJECTED"].includes(decision)) throw new AppError(400, "Decision must be ACCEPTED or REJECTED.");
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.receiverId !== req.userId) throw new AppError(404, "Friend request not found.");
    if (request.status !== "PENDING") throw new AppError(409, "This request has already been handled.");
    const updated = await tx.friendRequest.update({ where: { id: request.id }, data: { status: decision } });
    if (decision === "ACCEPTED") {
      const [userAId, userBId] = pair(request.senderId, request.receiverId);
      await tx.friendship.create({ data: { userAId, userBId } });
    }
    return updated;
  });
  res.json({ message: decision === "ACCEPTED" ? "Friend request accepted." : "Friend request rejected.", request: result });
}));

export default router;
