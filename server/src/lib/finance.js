import { AppError } from "./errors.js";

export function validateShares(totalPaise, participants) {
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new AppError(400, "Amount must be a positive number with at most two decimal places.");
  }
  if (!Array.isArray(participants) || participants.length < 1) {
    throw new AppError(400, "Select at least one participant.");
  }
  const ids = participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, "A participant can only be selected once.");
  const shares = participants.map((p) => p.sharePaise);
  if (shares.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new AppError(400, "Every share must be a non-negative amount in paise.");
  }
  if (shares.reduce((a, b) => a + b, 0) !== totalPaise) {
    throw new AppError(400, "Participant shares must add up exactly to the total amount.");
  }
}

export function equalShares(totalPaise, userIds) {
  const base = Math.floor(totalPaise / userIds.length);
  let remainder = totalPaise - base * userIds.length;
  return userIds.map((userId) => ({
    userId,
    sharePaise: base + (remainder-- > 0 ? 1 : 0)
  }));
}

// Positive ledger amount means the user is owed money by the counterparty.
// Negative means the user owes the counterparty.
export function expenseLedgerRows(expenseId, payerId, participants, totalPaise) {
  const rows = [];
  for (const p of participants) {
    if (p.userId === payerId) continue;
    const amountPaise = p.sharePaise;
    if (amountPaise === 0) continue;
    rows.push({
      userId: payerId,
      counterpartyId: p.userId,
      amountPaise,
      type: "EXPENSE",
      expenseId
    });
    rows.push({
      userId: p.userId,
      counterpartyId: payerId,
      amountPaise: -amountPaise,
      type: "EXPENSE",
      expenseId
    });
  }
  return rows;
}

export function moneyToPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || Math.round(n * 100) !== n * 100) {
    throw new AppError(400, "Enter a valid positive amount with up to two decimal places.");
  }
  const paise = Math.round(n * 100);
  if (!Number.isSafeInteger(paise)) throw new AppError(400, "Amount is too large.");
  return paise;
}
