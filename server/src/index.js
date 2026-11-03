import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.error("Missing DATABASE_URL or JWT_SECRET. Configure server/.env using server/.env.example.");
  process.exit(1);
}

const [{ default: express }, { default: cors }, { default: helmet }, { rateLimit }, { default: authRouter }, { default: friendsRouter }, { default: expensesRouter }, { default: settlementsRouter }, { errorHandler }] = await Promise.all([
  import("express"), import("cors"), import("helmet"), import("express-rate-limit"),
  import("./routes/auth.js"), import("./routes/friends.js"), import("./routes/expenses.js"),
  import("./routes/settlements.js"), import("./lib/errors.js")
]);

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }), authRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/settlements", settlementsRouter);
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "friends-expense-manager-api" }));
app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Expense Manager API running at http://localhost:${port}`));
